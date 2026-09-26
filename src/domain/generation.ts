import type { CompatibilityValidationResult } from "./validation";

export type GenerationRequestKind =
  "image_to_video" | "start_end_frame_video" | "reference_video_motion";

export type GenerationAudioMode = "none" | "generated_optional" | "generated_required";

export interface GenerationMediaReference {
  kind: "image" | "video";
  role: "source" | "start_frame" | "end_frame" | "motion_reference";
  url: string;
}

export interface ProviderNeutralGenerationRequest {
  providerAdapterKey: string;
  providerEndpoint: string;
  recipeVersion: string;
  requestKind: GenerationRequestKind;
  media: readonly GenerationMediaReference[];
  prompt: string;
  negativePrompt?: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution: { width: number; height: number };
  audioMode: GenerationAudioMode;
  providerParameters: Readonly<Record<string, unknown>>;
}

export type ProviderGenerationState =
  "queued" | "running" | "reconciliation_required" | "completed" | "failed";

export interface ProviderGenerationResult {
  state: ProviderGenerationState;
  requestId: string;
  videoUrl?: string;
  nonSensitiveReasonCode?:
    | "provider_failed"
    | "provider_timeout"
    | "provider_unavailable"
    | "payload_unavailable"
    | "invalid_provider_output";
}

export interface GenerationAdapterConfiguration {
  apiKeyPresent: boolean;
  submissionEnabled: boolean;
}

export interface GenerationAdapter {
  readonly key: string;
  readonly configuration: GenerationAdapterConfiguration;
  submit(
    request: ProviderNeutralGenerationRequest,
    options: { webhookUrl?: string },
  ): Promise<{ requestId: string }>;
  poll(
    request: ProviderNeutralGenerationRequest,
    requestId: string,
  ): Promise<ProviderGenerationResult>;
}

export interface ProposalHashSnapshot {
  jobId: string;
  templateId: string;
  templateVersion: number;
  recipeVersion: string;
  validationPolicyVersion: number;
  validationResult: CompatibilityValidationResult;
  creditCost: number;
  maximumPriceUsd: number;
}
