import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CreditLedgerEntry, GenerationProposal, Job, UserIdentity } from "../src/domain/types";
import type { FalAdapter } from "./fal-adapter";
import { isS3Configured, S3Storage } from "./s3-storage";
import { InputValidationError, validateImage } from "./validation";

interface MediaRecord {
  sourceKind: "local" | "s3";
  sourceKey: string;
  reelKind?: "local" | "s3";
  reelKey?: string;
}

interface State {
  jobs: Job[];
  ledger: CreditLedgerEntry[];
  media?: Record<string, MediaRecord>;
}

export class LocalJobService {
  private readonly jobs = new Map<string, Job>();
  private readonly media = new Map<string, MediaRecord>();
  private ledger: CreditLedgerEntry[] = [];
  private readonly statePath = join(process.cwd(), ".local-storage", "state.json");
  private readonly s3 = isS3Configured() ? new S3Storage() : null;

  constructor(private readonly fal: FalAdapter) {}

  async initialize(): Promise<void> {
    try {
      const state = JSON.parse(await readFile(this.statePath, "utf8")) as State;
      state.jobs.forEach((job) => this.jobs.set(job.id, job));
      Object.entries(state.media ?? {}).forEach(([jobId, media]) => this.media.set(jobId, media));
      this.ledger = state.ledger;
      const repairedFixtureCredit = this.repairFixtureCredits();
      await this.cleanupExpired();
      if (repairedFixtureCredit) await this.persist();
      for (const job of this.jobs.values()) {
        if (!job.attempt) continue;
        if (
          job.attempt.provider === "local-fixture" &&
          ["queued", "generating"].includes(job.status)
        )
          void this.runFixture(job.id);
        if (
          job.attempt.provider === "fal.ai" &&
          job.attempt.providerRequestId &&
          ["queued", "submitting", "generating", "storing"].includes(job.status)
        )
          void this.runLive(job.id, job.attempt.providerRequestId);
      }
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("ENOENT")) throw error;
    }
  }

  async createDraft(
    user: UserIdentity,
    templateId: string,
    permissionConfirmed: boolean,
  ): Promise<Job> {
    if (!permissionConfirmed)
      throw new InputValidationError(
        "unsupported_photo",
        "Confirm you have permission before uploading.",
      );
    this.ensureGrant(user.id);
    const job: Job = {
      id: randomUUID(),
      userId: user.id,
      templateId,
      status: "draft",
      consent: { acknowledgedAt: new Date().toISOString(), permissionConfirmed },
    };
    this.jobs.set(job.id, job);
    await this.persist();
    return job;
  }

  async uploadAndValidate(user: UserIdentity, jobId: string, bytes: Buffer): Promise<Job> {
    const job = this.requireOwnedJob(user, jobId);
    if (job.status !== "draft")
      throw new InputValidationError("unsupported_file", "This upload has already been processed.");
    job.status = "validating";
    try {
      const image = await validateImage(bytes);
      await this.persistPrivateSource(job.id, image.normalized);
      job.status = "validated";
    } catch (error) {
      const e =
        error instanceof InputValidationError
          ? error
          : new InputValidationError(
              "invalid_image_source",
              "This image could not be validated or stored privately.",
            );
      job.status = "rejected";
      job.error = {
        code: e.code,
        message: e.message,
        nextStep: "Choose another supported photo or check private storage configuration.",
      };
    }
    await this.persist();
    return job;
  }

  async reviewLive(user: UserIdentity, jobId: string): Promise<GenerationProposal> {
    const job = this.requireOwnedJob(user, jobId);
    if (job.status !== "validated" && job.status !== "awaiting_submit")
      throw new InputValidationError(
        "unsupported_file",
        "Validate the photo before reviewing a live request.",
      );
    job.status = "awaiting_submit";
    await this.persist();
    return this.fal.proposal(job);
  }

  async submitLive(
    user: UserIdentity,
    jobId: string,
    proposalId: string,
    approvedMaximumCostUsd: number,
  ): Promise<Job> {
    const job = this.requireOwnedJob(user, jobId);
    const proposal = this.fal.proposal(job);
    if (job.status !== "awaiting_submit" || job.attempt)
      throw new InputValidationError("unsupported_file", "This job cannot be submitted.");
    if (proposal.id !== proposalId || approvedMaximumCostUsd !== proposal.estimatedMaximumCostUsd)
      throw new InputValidationError(
        "unsupported_file",
        "The approved request does not match the current proposal.",
      );
    if (!proposal.providerConfigured)
      throw new InputValidationError(
        "unsupported_file",
        "fal.ai is not configured. Add FAL_KEY to the server environment and restart.",
      );
    if (!proposal.storageConfigured || !this.s3)
      throw new InputValidationError(
        "unsupported_file",
        "Private S3 storage is not configured. Add AWS_REGION and MEMORY_REELS_S3_BUCKET and restart.",
      );
    if (!proposal.liveSubmissionEnabled)
      throw new InputValidationError(
        "unsupported_file",
        "Live generation is locked. Set FAL_LIVE_SUBMISSION_ENABLED=true after reviewing this request, then restart.",
      );
    if (this.balance(user.id) < 1)
      throw new InputValidationError("unsupported_file", "No beta credit is available.");

    const media = this.requireMedia(job.id);
    if (media.sourceKind !== "s3")
      throw new InputValidationError(
        "unsupported_file",
        "This photo is stored only in the local fixture. Upload it again after S3 is configured.",
      );

    this.addLedger(user.id, "reserve", -1, job.id);
    job.attempt = {
      id: randomUUID(),
      jobId: job.id,
      attemptNumber: 1,
      status: "submitting",
      provider: "fal.ai",
      promptTemplateVersion: "wedding-portrait-v1",
      proposalId,
    };
    job.status = "submitting";
    await this.persist();

    try {
      const imageUrl = await this.s3.createSourceUrl(media.sourceKey);
      const providerRequestId = await this.fal.submit({ ...proposal.input, image_url: imageUrl });
      job.attempt.providerRequestId = providerRequestId;
      job.attempt.status = "queued";
      job.status = "queued";
      await this.persist();
      void this.runLive(job.id, providerRequestId);
      return job;
    } catch {
      await this.failLive(
        job,
        "The video provider could not accept this request. Try again later.",
      );
      return job;
    }
  }

  async submitFixture(user: UserIdentity, jobId: string): Promise<Job> {
    const job = this.requireOwnedJob(user, jobId);
    if (!(["validated", "awaiting_submit"] as string[]).includes(job.status) || job.attempt)
      throw new InputValidationError("unsupported_file", "This job cannot be submitted.");
    job.attempt = {
      id: randomUUID(),
      jobId: job.id,
      attemptNumber: 1,
      status: "queued",
      provider: "local-fixture",
      promptTemplateVersion: "phase-4-fixture",
    };
    job.status = "queued";
    await this.persist();
    void this.runFixture(job.id);
    return job;
  }

  get(user: UserIdentity, jobId: string): Job {
    return this.requireOwnedJob(user, jobId);
  }
  storageStatus(): { configured: boolean } {
    return { configured: Boolean(this.s3) };
  }
  async verifyStorage(): Promise<void> {
    if (!this.s3) throw new Error("S3 storage is not configured.");
    await this.s3.verifyAccess();
  }

  async resetLocalDemo(user: UserIdentity): Promise<void> {
    const owned = [...this.jobs.values()].filter((job) => job.userId === user.id);
    for (const job of owned) await this.removeMedia(job.id);
    for (const job of owned) this.jobs.delete(job.id);
    this.ledger = this.ledger.filter((entry) => entry.userId !== user.id);
    await this.persist();
  }

  async delete(user: UserIdentity, jobId: string): Promise<Job> {
    const job = this.requireOwnedJob(user, jobId);
    job.status = "deletion_requested";
    await this.persist();
    await this.removeMedia(job.id);
    job.status = "deleted";
    await this.persist();
    return job;
  }

  async delivery(
    user: UserIdentity,
    jobId: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const job = this.requireOwnedJob(user, jobId);
    if (job.status !== "completed") throw new Error("Delivery is not ready.");
    const media = this.requireMedia(job.id);
    if (!media.reelKey || !media.reelKind) throw new Error("Stored delivery is unavailable.");
    if (media.reelKind === "s3") {
      if (!this.s3) throw new Error("Private storage is unavailable.");
      return { body: await this.s3.getObject(media.reelKey), contentType: "video/mp4" };
    }
    return { body: await readFile(media.reelKey), contentType: "text/plain; charset=utf-8" };
  }

  private async runLive(jobId: string, requestId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job?.attempt || job.attempt.provider !== "fal.ai" || job.status === "completed") return;
    try {
      job.status = "generating";
      job.attempt.status = "generating";
      await this.persist();
      const videoUrl = await this.fal.result(requestId);
      job.status = "storing";
      job.attempt.status = "storing";
      await this.persist();
      const video = await downloadVideo(videoUrl);
      if (!this.s3) throw new Error("Private storage is unavailable.");
      const media = this.requireMedia(job.id);
      media.reelKey = await this.s3.putReel(job.id, video);
      media.reelKind = "s3";
      job.status = "completed";
      job.attempt.status = "completed";
      job.outputLabel = "AI-generated video · Kling 2.5 Turbo Pro";
      job.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      this.addLedger(job.userId, "consume", 0, job.id);
      await this.persist();
    } catch {
      await this.failLive(job, "Video generation did not complete. Your beta credit was restored.");
    }
  }

  private async failLive(job: Job, message: string): Promise<void> {
    job.status = "failed";
    if (job.attempt) job.attempt.status = "failed";
    job.error = {
      code: "technical_failure",
      message,
      nextStep: "Delete this job and retry with the same or another supported photo.",
    };
    if (!this.ledger.some((entry) => entry.jobId === job.id && entry.entryType === "release"))
      this.addLedger(job.userId, "release", 1, job.id);
    await this.persist();
  }

  private async runFixture(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job?.attempt || (job.status !== "queued" && job.status !== "generating")) return;
    job.status = "generating";
    job.attempt.status = "generating";
    await this.persist();
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (job.status !== "generating" || !job.attempt) return;
    job.status = "completed";
    job.attempt.status = "fixture_completed";
    job.outputLabel = "Local fixture delivery — no AI video was generated";
    job.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const reelDirectory = join(process.cwd(), ".local-storage", "reels");
    const reelPath = join(reelDirectory, `${job.id}.txt`);
    await mkdir(reelDirectory, { recursive: true });
    await writeFile(reelPath, "Private fixture delivery. No AI video was generated.", "utf8");
    const media = this.requireMedia(job.id);
    media.reelKind = "local";
    media.reelKey = reelPath;
    await this.persist();
  }

  private repairFixtureCredits(): boolean {
    let repaired = false;
    for (const job of this.jobs.values()) {
      if (job.attempt?.provider !== "local-fixture") continue;
      const reserved = this.ledger.some(
        (entry) => entry.jobId === job.id && entry.entryType === "reserve",
      );
      const released = this.ledger.some(
        (entry) => entry.jobId === job.id && entry.entryType === "release",
      );
      if (reserved && !released) {
        this.addLedger(job.userId, "release", 1, job.id);
        repaired = true;
      }
    }
    return repaired;
  }

  private ensureGrant(userId: string): void {
    if (!this.ledger.some((entry) => entry.userId === userId && entry.entryType === "grant"))
      this.addLedger(userId, "grant", 1);
  }
  private balance(userId: string): number {
    return this.ledger
      .filter((entry) => entry.userId === userId)
      .reduce((total, entry) => total + entry.credits, 0);
  }
  private addLedger(
    userId: string,
    entryType: CreditLedgerEntry["entryType"],
    credits: number,
    jobId?: string,
  ): void {
    this.ledger.push({
      id: randomUUID(),
      userId,
      jobId,
      entryType,
      credits,
      createdAt: new Date().toISOString(),
    });
  }
  private requireOwnedJob(user: UserIdentity, jobId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== user.id) throw new Error("Job not found.");
    return job;
  }
  private requireMedia(jobId: string): MediaRecord {
    const media = this.media.get(jobId);
    if (!media) throw new Error("Private job media is unavailable.");
    return media;
  }

  private async persistPrivateSource(jobId: string, normalized: Buffer): Promise<void> {
    if (this.s3) {
      const sourceKey = await this.s3.putNormalized(jobId, normalized);
      this.media.set(jobId, { sourceKind: "s3", sourceKey });
      return;
    }
    const directory = join(process.cwd(), ".local-storage", "normalized");
    const sourcePath = join(directory, `${jobId}.png`);
    await mkdir(directory, { recursive: true });
    await writeFile(sourcePath, normalized);
    this.media.set(jobId, { sourceKind: "local", sourceKey: sourcePath });
  }

  private async removeMedia(jobId: string): Promise<void> {
    const media = this.media.get(jobId);
    if (!media) return;
    if (media.sourceKind === "s3" && this.s3) await this.s3.deleteObject(media.sourceKey);
    if (media.sourceKind === "local") await rm(media.sourceKey, { force: true });
    if (media.reelKind === "s3" && media.reelKey && this.s3)
      await this.s3.deleteObject(media.reelKey);
    if (media.reelKind === "local" && media.reelKey) await rm(media.reelKey, { force: true });
    this.media.delete(jobId);
  }

  private async persist(): Promise<void> {
    await mkdir(join(process.cwd(), ".local-storage"), { recursive: true });
    await writeFile(
      this.statePath,
      JSON.stringify({
        jobs: [...this.jobs.values()],
        ledger: this.ledger,
        media: Object.fromEntries(this.media),
      }),
      "utf8",
    );
  }
  private async cleanupExpired(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.status === "completed" && job.expiresAt && new Date(job.expiresAt) <= new Date())
        await this.delete({ id: job.userId, displayName: "retention" }, job.id);
    }
  }
}

async function downloadVideo(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error("Generated video could not be downloaded.");
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 100 * 1024 * 1024) throw new Error("Generated video is unexpectedly large.");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0 || body.length > 100 * 1024 * 1024)
    throw new Error("Generated video failed storage validation.");
  if (body.length < 12 || body.subarray(4, 8).toString("ascii") !== "ftyp")
    throw new Error("Generated output is not a valid MP4 file.");
  return body;
}
