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

export type SafeErrorCode =
  "invalid_image_source" | "unsupported_file" | "unsupported_photo" | "technical_failure";

export interface SafeError {
  code: SafeErrorCode;
  message: string;
  nextStep: string;
}

export interface Template {
  id: string;
  version: number;
  title: string;
  description: string;
  durationSeconds: 5;
  aspectRatio: "9:16";
  slotCount: 1 | 2;
  creditCost: 1;
  eligibilityRules: readonly string[];
  unsupportedRules: readonly string[];
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
  provider: "local-fixture" | "fal.ai";
  promptTemplateVersion: string;
  providerRequestId?: string;
  proposalId?: string;
}

export interface GenerationProposal {
  id: string;
  model: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
  input: {
    image_url: string;
    prompt: string;
    duration: "5";
    negative_prompt: string;
    cfg_scale: number;
  };
  expectedOutput: "5-second vertical MP4 based on the uploaded portrait";
  estimatedMaximumCostUsd: 0.35;
  approvalRequired: true;
  providerConfigured: boolean;
  liveSubmissionEnabled: boolean;
  storageConfigured: boolean;
}

export interface CreditLedgerEntry {
  id: string;
  userId: string;
  jobId?: string;
  entryType: "grant" | "reserve" | "release" | "consume";
  credits: number;
  createdAt: string;
}

export interface Job {
  id: string;
  userId: string;
  templateId: string;
  status: JobStatus;
  consent: Consent;
  error?: SafeError;
  attempt?: GenerationAttempt;
  outputLabel?: string;
  expiresAt?: string;
}

export interface UserIdentity {
  id: string;
  displayName: string;
}
