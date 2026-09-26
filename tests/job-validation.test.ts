import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { FalAdapter } from "../server/fal-adapter";
import { LocalJobService } from "../server/jobs";
import { DeterministicVisionCompatibilityAdapter } from "../server/vision-adapters";
import type { AnalyticsPort } from "../src/domain/ports";
import type { UserIdentity } from "../src/domain/types";

const temporaryDirectories: string[] = [];
const analytics: AnalyticsPort = { async record() {} };
const user: UserIdentity = { id: "validation-test-user", displayName: "Validation test" };

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function source(): Promise<Buffer> {
  return sharp({
    create: {
      width: 640,
      height: 800,
      channels: 3,
      background: { r: 130, g: 90, b: 110 },
    },
  })
    .png()
    .toBuffer();
}

describe("job validation snapshot and credits", () => {
  it("persists the policy snapshot without consuming or reserving a credit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memory-reels-validation-"));
    temporaryDirectories.push(directory);
    const statePath = join(directory, "state.json");
    const jobs = new LocalJobService(
      new FalAdapter(),
      analytics,
      new DeterministicVisionCompatibilityAdapter(),
      statePath,
      null,
    );

    const draft = await jobs.createDraft(user, "wedding-portrait-comes-alive", 1, true);
    expect(jobs.creditBalance(user)).toBe(1);

    const validated = await jobs.uploadAndValidate(user, draft.id, await source());
    expect(validated.status).toBe("validated");
    expect(validated.validationPolicyVersion).toBe(1);
    expect(validated.validationResult?.outcome).toBe("ready");
    expect(validated.validationResult?.creditOutcome).toBe("not_used");
    expect(jobs.creditBalance(user)).toBe(1);

    const persisted = JSON.parse(await readFile(statePath, "utf8")) as {
      jobs: Array<{ validationPolicyVersion?: number; validationResult?: { outcome: string } }>;
      ledger: Array<{ entryType: string }>;
    };
    expect(persisted.jobs[0]).toMatchObject({
      validationPolicyVersion: 1,
      validationResult: { outcome: "ready" },
    });
    expect(persisted.ledger.map((entry) => entry.entryType)).toEqual(["grant"]);
  });

  it("blocks proposal review and preserves credit after a hard compatibility failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memory-reels-validation-failure-"));
    temporaryDirectories.push(directory);
    const jobs = new LocalJobService(
      new FalAdapter(),
      analytics,
      new DeterministicVisionCompatibilityAdapter({
        subjectCount: 4,
        visibleFaceCount: 4,
        edgeClipping: "none",
        cropSuitability: "good",
        framing: "portrait",
        blur: "low",
        exposure: "good",
        occlusion: "none",
      }),
      join(directory, "state.json"),
      null,
    );
    const draft = await jobs.createDraft(user, "wedding-portrait-comes-alive", 1, true);
    const rejected = await jobs.uploadAndValidate(user, draft.id, await source());

    expect(rejected.status).toBe("rejected");
    expect(rejected.validationResult?.outcome).toBe("not_suitable");
    await expect(jobs.reviewLive(user, draft.id)).rejects.toThrow(
      "Run the current template compatibility check",
    );
    expect(jobs.creditBalance(user)).toBe(1);
  });
});
