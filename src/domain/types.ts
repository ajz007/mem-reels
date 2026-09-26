export const jobStatuses = [
  "draft",
  "uploaded",
  "validating",
  "validated",
  "awaiting_submit",
  "queued",
  "submitting",
  "generating",
  "storing",
  "completed",
  "failed",
  "rejected",
  "deletion_requested",
  "deleted",
] as const;

export type JobStatus = (typeof jobStatuses)[number];

import type { CompatibilityValidationResult } from "./validation";

export type SafeErrorCode =
  "invalid_image_source" | "unsupported_file" | "unsupported_photo" | "technical_failure";

export interface SafeError {
  code: SafeErrorCode;
  message: string;
  nextStep: string;
}

export type TemplateStatus = "draft" | "experimental" | "active" | "retired";

export interface TemplatePoster {
  url: string;
  alt: string;
}

export interface TemplateSampleVideo {
  url?: string;
  posterUrl: string;
  alt: string;
  label: string;
  availability: "available" | "preview_pending";
}

export interface TemplateOutputFormat {
  durationSeconds: number;
  aspectRatio: "9:16";
  resolution: { width: number; height: number; label: string };
}

export interface TemplateSummary {
  id: string;
  version: number;
  title: string;
  description: string;
  category: string;
  tags: readonly string[];
  collection: string;
  poster: TemplatePoster;
  sampleVideo: TemplateSampleVideo;
  requiredInputCount: number;
  output: TemplateOutputFormat;
  creditPrice: number;
  costDescription: string;
  status: TemplateStatus;
  generationAvailability: "paid_approved" | "fixture_only";
}

export interface TemplateDetail extends TemplateSummary {
  exampleSource: TemplatePoster;
  inputGuidance: {
    title: string;
    description: string;
    requirements: readonly string[];
  };
  eligibilityConditions: readonly string[];
  unsupportedConditions: readonly string[];
  privacyDescription: string;
}

export interface Consent {
  acknowledgedAt: string;
  permissionConfirmed: boolean;
}

export interface GenerationAttempt {
  id: string;
  jobId: string;
  attemptNumber: number;
  status:
    | "fixture_pending"
    | "queued"
    | "submitting"
    | "generating"
    | "storing"
    | "completed"
    | "failed"
    | "fixture_completed"
    | "fixture_failed";
  provider: "local-fixture" | "fal.ai" | string;
  promptTemplateVersion: string;
  providerRequestId?: string;
  proposalId?: string;
  idempotencyKey?: string;
  retryOfAttemptId?: string;
  retryable?: boolean;
  failureReasonCode?:
    | "provider_rejected"
    | "provider_failed"
    | "provider_timeout"
    | "provider_unavailable"
    | "payload_unavailable"
    | "invalid_provider_output";
  stateTransitions?: Array<{ status: GenerationAttempt["status"]; at: string }>;
}

export interface GenerationProposal {
  id: string;
  templateId: string;
  templateVersion: number;
  recipeVersion: string;
  expectedOutput: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution: { width: number; height: number; label: string };
  audioMode: "none" | "generated_optional" | "generated_required";
  creditCost: number;
  estimatedMaximumCostUsd: number;
  maximumApprovedPriceUsd: number;
  approvalRequired: true;
  providerConfigured: boolean;
  liveSubmissionEnabled: boolean;
  storageConfigured: boolean;
}

export interface CreditLedgerEntry {
  id: string;
  userId: string;
  jobId?: string;
  attemptId?: string;
  purchaseId?: string;
  entryType: "purchase" | "grant" | "reserve" | "release" | "consume" | "administrative_adjustment";
  credits: number;
  createdAt: string;
}

export type PurchaseStatus =
  "checkout_created" | "payment_pending" | "paid" | "failed" | "refunded";

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  amountPaise: number;
  currency: "INR";
  description: string;
}

export interface CreditPurchase {
  id: string;
  userId: string;
  provider: "razorpay";
  packId: string;
  credits: number;
  amountPaise: number;
  currency: "INR";
  status: PurchaseStatus;
  providerOrderId?: string;
  providerPaymentId?: string;
  receiptReference: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutSession {
  purchaseId: string;
  provider: "razorpay";
  providerOrderId: string;
  publicKeyId: string;
  amountPaise: number;
  currency: "INR";
  credits: number;
  productName: string;
}

export interface AccountSummary {
  balance: number;
  packs: CreditPack[];
  purchases: CreditPurchase[];
}

export interface Job {
  id: string;
  userId: string;
  templateId: string;
  templateVersion: number;
  status: JobStatus;
  consent: Consent;
  validationPolicyVersion?: number;
  validationResult?: CompatibilityValidationResult;
  error?: SafeError;
  attempt?: GenerationAttempt;
  outputLabel?: string;
  expiresAt?: string;
}

export interface UserIdentity {
  id: string;
  displayName: string;
}
