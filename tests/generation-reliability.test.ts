import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { FalAdapter } from "../server/fal-adapter";
import { GenerationAdapterRegistry } from "../server/generation-adapters";
import { LocalJobService, type PrivateMediaStorage } from "../server/jobs";
import { DeterministicVisionCompatibilityAdapter } from "../server/vision-adapters";
import type {
  GenerationAdapter,
  ProviderGenerationResult,
  ProviderNeutralGenerationRequest,
} from "../src/domain/generation";
import type { AnalyticsPort } from "../src/domain/ports";
import type { UserIdentity } from "../src/domain/types";

const directories: string[] = [];
const analytics: AnalyticsPort = { async record() {} };
const user: UserIdentity = { id: "reliability-user", displayName: "Reliability" };

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

class FakeStorage implements PrivateMediaStorage {
  readonly objects = new Map<string, Buffer>();
  async verifyAccess() {}
  async putNormalized(jobId: string, body: Buffer) {
    const key = `normalized/${jobId}`;
    this.objects.set(key, body);
    return key;
  }
  async createSourceUrl(key: string) {
    return `https://signed.invalid/${key}`;
  }
  async putReel(jobId: string, body: Buffer) {
    const key = `reels/${jobId}`;
    this.objects.set(key, body);
    return key;
  }
  async getObject(key: string) {
    return this.objects.get(key) ?? Buffer.alloc(0);
  }
  async deleteObject(key: string) {
    this.objects.delete(key);
  }
}

class FakeAdapter implements GenerationAdapter {
  readonly key = "fal:kling-2.5-turbo-pro:v1";
  readonly configuration = { apiKeyPresent: true, submissionEnabled: true };
  submitCalls = 0;
  submitFailures = 0;
  pollResult: ProviderGenerationResult = {
    state: "failed",
    requestId: "request-1",
    nonSensitiveReasonCode: "invalid_provider_output",
  };
  async submit(request: ProviderNeutralGenerationRequest) {
    void request;
    this.submitCalls += 1;
    if (this.submitFailures-- > 0) throw new Error("fixture transport failure");
    return { requestId: `request-${this.submitCalls}` };
  }
  async poll(request: ProviderNeutralGenerationRequest, requestId: string) {
    void request;
    return { ...this.pollResult, requestId };
  }
}

async function prepare(adapter: FakeAdapter) {
  const directory = await mkdtemp(join(tmpdir(), "memory-reels-reliability-"));
  directories.push(directory);
  const storage = new FakeStorage();
  const jobs = new LocalJobService(
    new FalAdapter(),
    analytics,
    new DeterministicVisionCompatibilityAdapter(),
    join(directory, "state.json"),
    storage,
    new GenerationAdapterRegistry([adapter]),
    async () => Buffer.from("fixture mp4"),
  );
  const image = await sharp({
    create: { width: 640, height: 800, channels: 3, background: "#775566" },
  })
    .png()
    .toBuffer();
  const draft = await jobs.createDraft(user, "wedding-portrait-comes-alive", 1, true);
  await jobs.uploadAndValidate(user, draft.id, image);
  const proposal = await jobs.reviewLive(user, draft.id);
  return { jobs, proposal, job: draft, statePath: join(directory, "state.json") };
}

async function waitForStatus(jobs: LocalJobService, jobId: string, status: string) {
  for (let index = 0; index < 50; index += 1) {
    if (jobs.get(user, jobId).status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Job did not reach ${status}.`);
}

describe("production job reliability", () => {
  it("deduplicates concurrent submissions and reserves credit once", async () => {
    const adapter = new FakeAdapter();
    const { jobs, proposal, job, statePath } = await prepare(adapter);
    await Promise.all([
      jobs.submitLive(user, job.id, proposal.id, proposal.maximumApprovedPriceUsd),
      jobs.submitLive(user, job.id, proposal.id, proposal.maximumApprovedPriceUsd),
    ]);
    await waitForStatus(jobs, job.id, "failed");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      ledger: Array<{ entryType: string }>;
      jobs: Array<{ attempt: { providerRequestId?: string } }>;
    };
    expect(adapter.submitCalls).toBe(1);
    expect(state.ledger.filter((entry) => entry.entryType === "reserve")).toHaveLength(1);
    expect(state.ledger.filter((entry) => entry.entryType === "release")).toHaveLength(1);
    expect(state.jobs[0].attempt.providerRequestId).toBe("request-1");
    expect(jobs.creditBalance(user)).toBe(1);
  });

  it("rejects stale proposals and changed template versions before reserving credit", async () => {
    const adapter = new FakeAdapter();
    const { jobs, proposal, job } = await prepare(adapter);
    jobs.get(user, job.id).validationResult!.evaluatedAt = "changed";
    await expect(
      jobs.submitLive(user, job.id, proposal.id, proposal.maximumApprovedPriceUsd),
    ).rejects.toThrow("does not match");
    expect(jobs.creditBalance(user)).toBe(1);

    jobs.get(user, job.id).templateVersion = 2;
    await expect(
      jobs.submitLive(user, job.id, proposal.id, proposal.maximumApprovedPriceUsd),
    ).rejects.toThrow("compatibility check");
    expect(adapter.submitCalls).toBe(0);
  });

  it("keeps an accepted request reconcilable after a provider timeout", async () => {
    const adapter = new FakeAdapter();
    adapter.pollResult = {
      state: "failed",
      requestId: "request-1",
      nonSensitiveReasonCode: "provider_timeout",
    };
    const { jobs, proposal, job, statePath } = await prepare(adapter);
    await jobs.submitLive(user, job.id, proposal.id, proposal.maximumApprovedPriceUsd);
    await waitForStatus(jobs, job.id, "queued");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      ledger: Array<{ entryType: string }>;
    };
    expect(jobs.get(user, job.id).attempt).toMatchObject({
      providerRequestId: "request-1",
      retryable: false,
      failureReasonCode: "provider_timeout",
    });
    expect(state.ledger.filter((entry) => entry.entryType === "release")).toHaveLength(0);
    expect(jobs.creditBalance(user)).toBe(0);
    const completion: ProviderGenerationResult = {
      state: "completed",
      requestId: "request-1",
      videoUrl: "https://fixture.invalid/output.mp4",
    };
    await Promise.all([
      jobs.handleProviderCompletion(completion),
      jobs.handleProviderCompletion(completion),
    ]);
    expect(jobs.get(user, job.id).status).toBe("completed");
    const completedState = JSON.parse(await readFile(statePath, "utf8")) as {
      ledger: Array<{ entryType: string }>;
    };
    expect(completedState.ledger.filter((entry) => entry.entryType === "consume")).toHaveLength(1);
    await jobs.handleProviderCompletion({
      state: "failed",
      requestId: "request-1",
      nonSensitiveReasonCode: "provider_failed",
    });
    expect(jobs.get(user, job.id).status).toBe("completed");
    const afterLateFailure = JSON.parse(await readFile(statePath, "utf8")) as {
      ledger: Array<{ entryType: string }>;
    };
    expect(afterLateFailure.ledger.filter((entry) => entry.entryType === "release")).toHaveLength(
      0,
    );
  });

  it("restores credit exactly once after invalid provider output", async () => {
    const adapter = new FakeAdapter();
    const { jobs, proposal, job, statePath } = await prepare(adapter);
    await jobs.submitLive(user, job.id, proposal.id, proposal.maximumApprovedPriceUsd);
    await waitForStatus(jobs, job.id, "failed");
    await jobs.handleProviderCompletion(adapter.pollResult);
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      ledger: Array<{ entryType: string }>;
    };
    expect(state.ledger.filter((entry) => entry.entryType === "release")).toHaveLength(1);
    expect(jobs.creditBalance(user)).toBe(1);
    await jobs.handleProviderCompletion({
      state: "completed",
      requestId: "request-1",
      videoUrl: "https://fixture.invalid/late.mp4",
    });
    expect(jobs.get(user, job.id).status).toBe("failed");
  });

  it("retries only a pre-acceptance failure and completes the second attempt", async () => {
    const adapter = new FakeAdapter();
    adapter.submitFailures = 1;
    adapter.pollResult = {
      state: "completed",
      requestId: "request-2",
      videoUrl: "https://fixture.invalid/output.mp4",
    };
    const { jobs, proposal, job, statePath } = await prepare(adapter);
    await jobs.submitLive(user, job.id, proposal.id, proposal.maximumApprovedPriceUsd);
    expect(jobs.get(user, job.id).attempt?.retryable).toBe(true);
    await jobs.retryLive(user, job.id);
    await waitForStatus(jobs, job.id, "completed");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      ledger: Array<{ entryType: string }>;
      jobs: Array<{ attempt: { attemptNumber: number; retryOfAttemptId?: string } }>;
    };
    expect(adapter.submitCalls).toBe(2);
    expect(state.jobs[0].attempt).toMatchObject({ attemptNumber: 2 });
    expect(state.jobs[0].attempt.retryOfAttemptId).toBeTruthy();
    expect(state.ledger.filter((entry) => entry.entryType === "reserve")).toHaveLength(2);
    expect(state.ledger.filter((entry) => entry.entryType === "release")).toHaveLength(1);
    expect(jobs.creditBalance(user)).toBe(0);
  });
});
