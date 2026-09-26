import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  AccountSummary,
  CheckoutSession,
  CreditLedgerEntry,
  CreditPurchase,
  GenerationProposal,
  Job,
  UserIdentity,
} from "../src/domain/types";
import type { AnalyticsPort, VisionCompatibilityProvider } from "../src/domain/ports";
import type { ProviderGenerationResult } from "../src/domain/generation";
import type {
  AnalyticsReasonCode,
  AnalyticsResultStatus,
  CreditOutcome,
  GenerationOutcome,
} from "../src/domain/analytics";
import type { FalAdapter } from "./fal-adapter";
import { createAnalyticsEvent } from "./analytics";
import { registeredTemplate } from "./catalogue";
import { validateTemplateCompatibility } from "./compatibility-validation";
import { isS3Configured, S3Storage } from "./s3-storage";
import { InputValidationError } from "./validation";
import { recipeForTemplate } from "./template-recipes";
import { buildGenerationRequest } from "./template-recipes";
import { GenerationAdapterRegistry } from "./generation-adapters";
import { buildGenerationProposal } from "./generation-proposal";
import { validationPolicyForTemplate } from "./validation-policy";
import { UnavailableVisionCompatibilityAdapter } from "./vision-adapters";
import { falWebhookUrl } from "./runtime-safety";
import {
  creditPacks,
  type CapturedPaymentEvent,
  type PaymentGateway,
  RazorpayGateway,
  verifyRazorpayPaymentSignature,
} from "./razorpay";

interface MediaRecord {
  sourceKind: "local" | "s3";
  sourceKey: string;
  reelKind?: "local" | "s3";
  reelKey?: string;
}

interface State {
  jobs: Job[];
  ledger: CreditLedgerEntry[];
  purchases?: CreditPurchase[];
  processedPaymentEventIds?: string[];
  media?: Record<string, MediaRecord>;
}

export interface PrivateMediaStorage {
  verifyAccess(): Promise<void>;
  putNormalized(jobId: string, body: Buffer): Promise<string>;
  createSourceUrl(key: string): Promise<string>;
  putReel(jobId: string, body: Buffer): Promise<string>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
}

export class LocalJobService {
  private readonly jobs = new Map<string, Job>();
  private readonly media = new Map<string, MediaRecord>();
  private ledger: CreditLedgerEntry[] = [];
  private purchases: CreditPurchase[] = [];
  private readonly processedPaymentEventIds = new Set<string>();
  private readonly storageRoot: string;
  private readonly s3: PrivateMediaStorage | null;
  private readonly adapters: GenerationAdapterRegistry;
  private readonly submissionLocks = new Map<string, Promise<Job>>();
  private readonly settlementLocks = new Map<string, Promise<void>>();

  constructor(
    fal: FalAdapter,
    private readonly analytics: AnalyticsPort,
    private readonly visionProvider: VisionCompatibilityProvider = new UnavailableVisionCompatibilityAdapter(),
    private readonly statePath = join(process.cwd(), ".local-storage", "state.json"),
    storage: PrivateMediaStorage | null = isS3Configured() ? new S3Storage() : null,
    adapters: GenerationAdapterRegistry = new GenerationAdapterRegistry([fal]),
    private readonly videoDownloader: (url: string) => Promise<Buffer> = downloadVideo,
    private readonly payments: PaymentGateway = new RazorpayGateway(),
  ) {
    this.storageRoot = dirname(this.statePath);
    this.s3 = storage;
    this.adapters = adapters;
  }

  async initialize(): Promise<void> {
    try {
      const state = JSON.parse(await readFile(this.statePath, "utf8")) as State;
      state.jobs.forEach((job) => {
        const templateVersion =
          job.templateVersion ?? registeredTemplate(job.templateId)?.version ?? 1;
        this.jobs.set(job.id, { ...job, templateVersion });
      });
      Object.entries(state.media ?? {}).forEach(([jobId, media]) => this.media.set(jobId, media));
      this.ledger = state.ledger;
      this.purchases = state.purchases ?? [];
      (state.processedPaymentEventIds ?? []).forEach((id) => this.processedPaymentEventIds.add(id));
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
          job.attempt.provider !== "local-fixture" &&
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
    templateVersion: number,
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
      templateVersion,
      status: "draft",
      consent: { acknowledgedAt: new Date().toISOString(), permissionConfirmed },
    };
    this.jobs.set(job.id, job);
    await this.persist();
    return job;
  }

  account(user: UserIdentity): AccountSummary {
    return {
      balance: this.balance(user.id),
      packs: [...creditPacks],
      purchases: this.purchases
        .filter((purchase) => purchase.userId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  list(user: UserIdentity): Job[] {
    return [...this.jobs.values()]
      .filter((job) => job.userId === user.id)
      .sort((a, b) => b.consent.acknowledgedAt.localeCompare(a.consent.acknowledgedAt));
  }

  async createCheckout(user: UserIdentity, packId: string): Promise<CheckoutSession> {
    const pack = creditPacks.find((candidate) => candidate.id === packId);
    if (!pack) throw new InputValidationError("unsupported_file", "Choose a valid credit pack.");
    if (process.env.NODE_ENV === "production")
      throw new Error("Production checkout requires a durable transactional credit repository.");
    if (!this.payments.publicKeyId.startsWith("rzp_test_"))
      throw new Error("The local JSON prototype accepts Razorpay test credentials only.");
    const now = new Date().toISOString();
    const purchase: CreditPurchase = {
      id: randomUUID(),
      userId: user.id,
      provider: "razorpay",
      packId: pack.id,
      credits: pack.credits,
      amountPaise: pack.amountPaise,
      currency: pack.currency,
      status: "checkout_created",
      receiptReference: `mr-${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      createdAt: now,
      updatedAt: now,
    };
    const order = await this.payments.createOrder({
      amountPaise: pack.amountPaise,
      currency: pack.currency,
      receipt: purchase.receiptReference,
      purchaseId: purchase.id,
    });
    purchase.providerOrderId = order.id;
    purchase.status = "payment_pending";
    purchase.updatedAt = new Date().toISOString();
    this.purchases.push(purchase);
    await this.persist();
    return {
      purchaseId: purchase.id,
      provider: "razorpay",
      providerOrderId: order.id,
      publicKeyId: this.payments.publicKeyId,
      amountPaise: pack.amountPaise,
      currency: pack.currency,
      credits: pack.credits,
      productName: `Memory Reels — ${pack.name}`,
    };
  }

  async applyCapturedPayment(event: CapturedPaymentEvent): Promise<boolean> {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "Production payment grants require a durable transactional credit repository.",
      );
    if (this.processedPaymentEventIds.has(event.eventId)) return false;
    const purchase = this.purchases.find(
      (candidate) => candidate.providerOrderId === event.providerOrderId,
    );
    if (!purchase) return false;
    if (
      purchase.amountPaise !== event.amountPaise ||
      purchase.currency !== event.currency ||
      (purchase.providerPaymentId && purchase.providerPaymentId !== event.providerPaymentId)
    )
      throw new Error("Captured payment does not match the server-created purchase.");
    if (purchase.status !== "paid") {
      purchase.status = "paid";
      purchase.providerPaymentId = event.providerPaymentId;
      purchase.updatedAt = new Date().toISOString();
      this.addLedger(
        purchase.userId,
        "purchase",
        purchase.credits,
        undefined,
        undefined,
        purchase.id,
      );
    }
    this.processedPaymentEventIds.add(event.eventId);
    await this.persist();
    return true;
  }

  verifyCheckoutPayment(
    user: UserIdentity,
    purchaseId: string,
    paymentId: string,
    orderId: string,
    signature: string,
  ): { verified: boolean; creditsAdded: boolean } {
    const purchase = this.purchases.find(
      (candidate) => candidate.id === purchaseId && candidate.userId === user.id,
    );
    if (!purchase?.providerOrderId || purchase.providerOrderId !== orderId)
      return { verified: false, creditsAdded: false };
    const verified = verifyRazorpayPaymentSignature(purchase.providerOrderId, paymentId, signature);
    return { verified, creditsAdded: verified && purchase.status === "paid" };
  }

  async uploadAndValidate(user: UserIdentity, jobId: string, bytes: Buffer): Promise<Job> {
    const job = this.requireOwnedJob(user, jobId);
    if (job.status !== "draft")
      throw new InputValidationError("unsupported_file", "This upload has already been processed.");
    await this.track(job, user, {
      name: "photo_upload_started",
      resultStatus: "started",
      reasonCode: "upload_received",
    });
    job.status = "validating";
    try {
      const policy = validationPolicyForTemplate(job.templateId, job.templateVersion);
      if (!policy)
        throw new InputValidationError(
          "unsupported_file",
          "This template does not have an approved validation policy.",
        );
      const validation = await validateTemplateCompatibility(bytes, {
        templateId: job.templateId,
        templateVersion: job.templateVersion,
        policy,
        visionProvider: this.visionProvider,
      });
      job.validationPolicyVersion = policy.version;
      job.validationResult = validation.result;
      if (validation.image) await this.persistPrivateSource(job.id, validation.image.normalized);
      if (validation.result.outcome === "not_suitable") {
        const failure = validation.result.rules.find((rule) => rule.status === "failure");
        job.status = "rejected";
        job.error = {
          code: "unsupported_photo",
          message: failure?.explanation ?? "This photo is not suitable for the selected template.",
          nextStep: failure?.suggestedCorrection ?? "Choose another photo and try again.",
        };
      } else {
        job.status = "validated";
        delete job.error;
      }
    } catch (error) {
      if (job.validationResult?.outcome !== "not_suitable") {
        delete job.validationResult;
        delete job.validationPolicyVersion;
      }
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
    await this.track(job, user, {
      name: "photo_upload_completed",
      resultStatus: "succeeded",
      reasonCode: "upload_received",
    });
    await this.track(job, user, {
      name: "photo_validation_completed",
      resultStatus: job.status === "validated" ? "succeeded" : "rejected",
      reasonCode:
        job.status === "validated" ? "validation_passed" : (job.error?.code ?? "technical_failure"),
      generationOutcome: "not_started",
      creditOutcome: "not_reserved",
    });
    return job;
  }

  async reviewLive(user: UserIdentity, jobId: string): Promise<GenerationProposal> {
    const job = this.requireOwnedJob(user, jobId);
    this.requireSuitableValidation(job);
    if (!recipeForTemplate(job.templateId, job.templateVersion))
      throw new InputValidationError(
        "unsupported_file",
        "Paid generation is unavailable for this development template.",
      );
    if (job.status !== "validated" && job.status !== "awaiting_submit")
      throw new InputValidationError(
        "unsupported_file",
        "Validate the photo before reviewing a live request.",
      );
    job.status = "awaiting_submit";
    await this.persist();
    const proposal = this.proposal(job);
    await this.track(job, user, {
      name: "generation_proposal_reviewed",
      resultStatus: "succeeded",
      reasonCode: "proposal_ready",
      providerCostCeilingUsd: proposal.estimatedMaximumCostUsd,
      generationOutcome: "not_started",
      creditOutcome: "not_reserved",
    });
    return proposal;
  }

  async submitLive(
    user: UserIdentity,
    jobId: string,
    proposalId: string,
    approvedMaximumCostUsd: number,
  ): Promise<Job> {
    const active = this.submissionLocks.get(jobId);
    if (active) return active;
    const submission = this.submitLiveOnce(user, jobId, proposalId, approvedMaximumCostUsd).finally(
      () => this.submissionLocks.delete(jobId),
    );
    this.submissionLocks.set(jobId, submission);
    return submission;
  }

  private async submitLiveOnce(
    user: UserIdentity,
    jobId: string,
    proposalId: string,
    approvedMaximumCostUsd: number,
  ): Promise<Job> {
    const job = this.requireOwnedJob(user, jobId);
    this.requireSuitableValidation(job);
    const proposal = this.proposal(job);
    if (job.attempt?.proposalId === proposalId) return job;
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
    await this.track(job, user, {
      name: "generation_cost_approved",
      resultStatus: "succeeded",
      reasonCode: "cost_approved",
      providerCostCeilingUsd: proposal.estimatedMaximumCostUsd,
      generationOutcome: "not_started",
      creditOutcome: "not_reserved",
    });

    const media = this.requireMedia(job.id);
    if (media.sourceKind !== "s3")
      throw new InputValidationError(
        "unsupported_file",
        "This photo is stored only in the local fixture. Upload it again after S3 is configured.",
      );

    const recipe = recipeForTemplate(job.templateId, job.templateVersion);
    if (!recipe)
      throw new InputValidationError(
        "unsupported_file",
        "Paid generation is unavailable for this development template.",
      );
    if (this.balance(user.id) < recipe.creditCost)
      throw new InputValidationError("unsupported_file", "You need more reel credits to continue.");
    const attemptId = randomUUID();
    const adapter = this.adapters.require(recipe.providerAdapterKey);
    this.addLedger(user.id, "reserve", -recipe.creditCost, job.id, attemptId);
    job.attempt = {
      id: attemptId,
      jobId: job.id,
      attemptNumber: 1,
      status: "submitting",
      provider: "fal.ai",
      promptTemplateVersion: recipe.recipeVersion,
      proposalId,
      idempotencyKey: `${job.id}:${proposalId}`,
      stateTransitions: [{ status: "submitting", at: new Date().toISOString() }],
    };
    job.status = "submitting";
    await this.persist();

    try {
      const imageUrl = await this.s3.createSourceUrl(media.sourceKey);
      const request = buildGenerationRequest(recipe, [
        { kind: "image", role: "source", url: imageUrl },
      ]);
      const webhookUrl = falWebhookUrl();
      const submitted = await adapter.submit(request, {
        ...(webhookUrl ? { webhookUrl } : {}),
      });
      const providerRequestId = submitted.requestId;
      job.attempt.providerRequestId = providerRequestId;
      job.attempt.status = "queued";
      job.attempt.stateTransitions?.push({ status: "queued", at: new Date().toISOString() });
      job.status = "queued";
      await this.persist();
      await this.track(job, user, {
        name: "generation_submitted",
        resultStatus: "succeeded",
        reasonCode: "provider_accepted",
        providerCostCeilingUsd: proposal.estimatedMaximumCostUsd,
        generationOutcome: "provider_submitted",
        creditOutcome: "reserved",
      });
      void this.runLive(job.id, providerRequestId);
      return job;
    } catch {
      await this.failLive(
        job,
        "The video provider could not accept this request. Try again later.",
        "provider_rejected",
      );
      return job;
    }
  }

  async submitFixture(user: UserIdentity, jobId: string): Promise<Job> {
    const job = this.requireOwnedJob(user, jobId);
    this.requireSuitableValidation(job);
    if (!(["validated", "awaiting_submit"] as string[]).includes(job.status) || job.attempt)
      throw new InputValidationError("unsupported_file", "This job cannot be submitted.");
    job.attempt = {
      id: randomUUID(),
      jobId: job.id,
      attemptNumber: 1,
      status: "queued",
      provider: "local-fixture",
      promptTemplateVersion: `fixture-${job.templateId}-v${job.templateVersion}`,
    };
    job.status = "queued";
    await this.persist();
    await this.track(job, user, {
      name: "generation_submitted",
      resultStatus: "succeeded",
      reasonCode: "fixture_mode",
      providerCostCeilingUsd: 0,
      generationOutcome: "not_started",
      creditOutcome: "not_reserved",
    });
    void this.runFixture(job.id);
    return job;
  }

  async retryLive(user: UserIdentity, jobId: string): Promise<Job> {
    const job = this.requireOwnedJob(user, jobId);
    const previous = job.attempt;
    if (
      job.status !== "failed" ||
      !previous?.retryable ||
      previous.providerRequestId ||
      !previous.proposalId ||
      previous.attemptNumber >= 3
    )
      throw new InputValidationError(
        "unsupported_file",
        "This request cannot be retried safely. Reconcile the existing provider request or start again.",
      );
    const proposal = this.proposal(job);
    if (proposal.id !== previous.proposalId)
      throw new InputValidationError("unsupported_file", "The generation proposal has changed.");
    job.attempt = undefined;
    job.status = "awaiting_submit";
    await this.persist();
    const retried = await this.submitLive(
      user,
      jobId,
      proposal.id,
      proposal.maximumApprovedPriceUsd,
    );
    if (retried.attempt) {
      retried.attempt.attemptNumber = previous.attemptNumber + 1;
      retried.attempt.retryOfAttemptId = previous.id;
      await this.persist();
    }
    return retried;
  }

  async handleProviderCompletion(result: ProviderGenerationResult): Promise<void> {
    const job = [...this.jobs.values()].find(
      (candidate) => candidate.attempt?.providerRequestId === result.requestId,
    );
    if (!job?.attempt) return;
    await this.settleProviderResult(job, result);
    if (requiresReconciliation(result) && job.attempt.providerRequestId)
      void this.runLive(job.id, job.attempt.providerRequestId);
  }

  get(user: UserIdentity, jobId: string): Job {
    return this.requireOwnedJob(user, jobId);
  }
  creditBalance(user: UserIdentity): number {
    return this.balance(user.id);
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
    if (!job?.attempt || job.attempt.provider === "local-fixture" || job.status === "completed")
      return;
    try {
      job.status = "generating";
      job.attempt.status = "generating";
      job.attempt.stateTransitions?.push({ status: "generating", at: new Date().toISOString() });
      await this.persist();
      const recipe = recipeForTemplate(job.templateId, job.templateVersion);
      if (!recipe || !this.s3) throw new Error("Generation recipe or storage is unavailable.");
      const media = this.requireMedia(job.id);
      const imageUrl = await this.s3.createSourceUrl(media.sourceKey);
      const request = buildGenerationRequest(recipe, [
        { kind: "image", role: "source", url: imageUrl },
      ]);
      const result = await this.adapters
        .require(recipe.providerAdapterKey)
        .poll(request, requestId);
      await this.settleProviderResult(job, result);
    } catch {
      await this.settleProviderResult(job, {
        state: "reconciliation_required",
        requestId,
        nonSensitiveReasonCode: "provider_unavailable",
      });
    }
  }

  private async settleProviderResult(job: Job, result: ProviderGenerationResult): Promise<void> {
    const previous = this.settlementLocks.get(job.id) ?? Promise.resolve();
    const settlement = previous
      .then(() => this.applyProviderResult(job, result))
      .finally(() => {
        if (this.settlementLocks.get(job.id) === settlement) this.settlementLocks.delete(job.id);
      });
    this.settlementLocks.set(job.id, settlement);
    return settlement;
  }

  private async applyProviderResult(job: Job, result: ProviderGenerationResult): Promise<void> {
    if (!job.attempt || ["completed", "failed"].includes(job.status)) return;
    if (requiresReconciliation(result)) {
      job.status = "queued";
      job.attempt.status = "queued";
      job.attempt.failureReasonCode = result.nonSensitiveReasonCode ?? "provider_unavailable";
      job.attempt.retryable = false;
      job.attempt.stateTransitions?.push({ status: "queued", at: new Date().toISOString() });
      await this.persist();
      return;
    }
    if (result.state === "failed" || !result.videoUrl) {
      job.attempt.failureReasonCode = result.nonSensitiveReasonCode ?? "invalid_provider_output";
      await this.failLive(
        job,
        "Video generation did not complete. Your reel credit was restored.",
        "technical_failure",
      );
      return;
    }
    await this.storeCompletedVideo(job, result.videoUrl);
  }

  private async storeCompletedVideo(job: Job, videoUrl: string): Promise<void> {
    if (!job.attempt || ["completed", "failed"].includes(job.status)) return;
    job.status = "storing";
    job.attempt.status = "storing";
    job.attempt.stateTransitions?.push({ status: "storing", at: new Date().toISOString() });
    await this.persist();
    const video = await this.videoDownloader(videoUrl);
    if (!this.s3) throw new Error("Private storage is unavailable.");
    const media = this.requireMedia(job.id);
    media.reelKey = await this.s3.putReel(job.id, video);
    media.reelKind = "s3";
    job.status = "completed";
    job.attempt.status = "completed";
    job.attempt.stateTransitions?.push({ status: "completed", at: new Date().toISOString() });
    job.outputLabel = "AI-generated video · Kling 2.5 Turbo Pro";
    job.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    this.addLedger(
      job.userId,
      "consume",
      recipeForTemplate(job.templateId, job.templateVersion)?.creditCost ?? 0,
      job.id,
      job.attempt.id,
    );
    await this.persist();
    await this.track(
      job,
      { id: job.userId, displayName: "analytics" },
      {
        name: "generation_completed",
        resultStatus: "succeeded",
        reasonCode: "delivery_ready",
        providerCostCeilingUsd:
          recipeForTemplate(job.templateId, job.templateVersion)?.providerCostCeilingUsd ?? 0,
        generationOutcome: "provider_succeeded",
        creditOutcome: "consumed",
      },
    );
  }

  private async failLive(
    job: Job,
    message: string,
    reasonCode: "provider_rejected" | "technical_failure",
  ): Promise<void> {
    if (["completed", "failed"].includes(job.status)) return;
    job.status = "failed";
    if (job.attempt) {
      job.attempt.status = "failed";
      job.attempt.failureReasonCode =
        job.attempt.failureReasonCode ??
        (reasonCode === "provider_rejected" ? "provider_rejected" : "provider_timeout");
      job.attempt.retryable = reasonCode === "provider_rejected" && !job.attempt.providerRequestId;
      job.attempt.stateTransitions?.push({ status: "failed", at: new Date().toISOString() });
    }
    job.error = {
      code: "technical_failure",
      message,
      nextStep: "Delete this job and retry with the same or another supported photo.",
    };
    const attemptId = job.attempt?.id;
    const reserve = this.ledger.find(
      (entry) => entry.attemptId === attemptId && entry.entryType === "reserve",
    );
    if (
      reserve &&
      !this.ledger.some((entry) => entry.attemptId === attemptId && entry.entryType === "release")
    )
      this.addLedger(job.userId, "release", -reserve.credits, job.id, attemptId);
    await this.persist();
    await this.track(
      job,
      { id: job.userId, displayName: "analytics" },
      {
        name: "generation_failed",
        resultStatus: "failed",
        reasonCode,
        providerCostCeilingUsd:
          recipeForTemplate(job.templateId, job.templateVersion)?.providerCostCeilingUsd ?? 0,
        generationOutcome: "provider_failed",
        creditOutcome: "restored",
      },
    );
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
    const reelDirectory = join(this.storageRoot, "reels");
    const reelPath = join(reelDirectory, `${job.id}.txt`);
    await mkdir(reelDirectory, { recursive: true });
    await writeFile(reelPath, "Private fixture delivery. No AI video was generated.", "utf8");
    const media = this.requireMedia(job.id);
    media.reelKind = "local";
    media.reelKey = reelPath;
    await this.persist();
    await this.track(
      job,
      { id: job.userId, displayName: "analytics" },
      {
        name: "generation_completed",
        resultStatus: "succeeded",
        reasonCode: "delivery_ready",
        providerCostCeilingUsd: 0,
        generationOutcome: "fixture_succeeded",
        creditOutcome: "not_reserved",
      },
    );
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
    if (process.env.NODE_ENV === "production") return;
    if (!this.ledger.some((entry) => entry.userId === userId && entry.entryType === "grant"))
      this.addLedger(userId, "grant", 1);
  }
  private balance(userId: string): number {
    return this.ledger
      .filter((entry) => entry.userId === userId)
      .filter((entry) => entry.entryType !== "consume")
      .reduce((total, entry) => total + entry.credits, 0);
  }
  private addLedger(
    userId: string,
    entryType: CreditLedgerEntry["entryType"],
    credits: number,
    jobId?: string,
    attemptId?: string,
    purchaseId?: string,
  ): void {
    this.ledger.push({
      id: randomUUID(),
      userId,
      jobId,
      attemptId,
      purchaseId,
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
  private proposal(job: Job): GenerationProposal {
    const recipe = recipeForTemplate(job.templateId, job.templateVersion);
    if (!recipe) throw new Error("Paid generation is unavailable for this template.");
    const configuration = this.adapters.require(recipe.providerAdapterKey).configuration;
    return buildGenerationProposal(job, {
      providerConfigured: configuration.apiKeyPresent,
      liveSubmissionEnabled: configuration.submissionEnabled,
      storageConfigured: Boolean(this.s3),
    });
  }
  private requireSuitableValidation(job: Job): void {
    const currentPolicy = validationPolicyForTemplate(job.templateId, job.templateVersion);
    if (
      !currentPolicy ||
      !job.validationResult ||
      job.validationPolicyVersion !== currentPolicy.version ||
      job.validationResult.policyVersion !== currentPolicy.version ||
      job.validationResult.outcome === "not_suitable"
    )
      throw new InputValidationError(
        "unsupported_photo",
        "Run the current template compatibility check before creating this reel.",
      );
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
    const directory = join(this.storageRoot, "normalized");
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
    await mkdir(this.storageRoot, { recursive: true });
    await writeFile(
      this.statePath,
      JSON.stringify({
        jobs: [...this.jobs.values()],
        ledger: this.ledger,
        purchases: this.purchases,
        processedPaymentEventIds: [...this.processedPaymentEventIds],
        media: Object.fromEntries(this.media),
      }),
      "utf8",
    );
  }
  private async track(
    job: Job,
    user: UserIdentity,
    details: {
      name:
        | "photo_upload_started"
        | "photo_upload_completed"
        | "photo_validation_completed"
        | "generation_proposal_reviewed"
        | "generation_cost_approved"
        | "generation_submitted"
        | "generation_completed"
        | "generation_failed";
      resultStatus: AnalyticsResultStatus;
      reasonCode: AnalyticsReasonCode;
      providerCostCeilingUsd?: number;
      generationOutcome?: GenerationOutcome;
      creditOutcome?: CreditOutcome;
    },
  ): Promise<void> {
    const template = registeredTemplate(job.templateId, job.templateVersion);
    if (!template) return;
    try {
      await this.analytics.record(
        createAnalyticsEvent({ ...details, user, template, jobId: job.id }),
      );
    } catch (error) {
      console.warn(
        "Analytics event was not recorded.",
        error instanceof Error ? error.message : "unknown",
      );
    }
  }
  private async cleanupExpired(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.status === "completed" && job.expiresAt && new Date(job.expiresAt) <= new Date())
        await this.delete({ id: job.userId, displayName: "retention" }, job.id);
    }
  }
}

function requiresReconciliation(result: ProviderGenerationResult): boolean {
  return (
    result.state === "reconciliation_required" ||
    result.nonSensitiveReasonCode === "provider_timeout" ||
    result.nonSensitiveReasonCode === "provider_unavailable" ||
    result.nonSensitiveReasonCode === "payload_unavailable"
  );
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
