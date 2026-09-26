import { createFalClient, type FalClient } from "@fal-ai/client";

import type { GenerationProposal, Job } from "../src/domain/types";
import type {
  GenerationAdapter,
  ProviderNeutralGenerationRequest,
  ProviderGenerationResult,
} from "../src/domain/generation";
import { buildGenerationProposal, buildProviderInput } from "./generation-proposal";
import { isS3Configured } from "./s3-storage";

interface ProviderGenerationInput {
  image_url: string;
  prompt: string;
  duration: "5";
  negative_prompt: string;
  cfg_scale: number;
}

export interface FalConfiguration {
  apiKeyPresent: boolean;
  submissionEnabled: boolean;
}

export class FalAdapter implements GenerationAdapter {
  readonly key = "fal:kling-2.5-turbo-pro:v1";
  readonly configuration: FalConfiguration;
  private readonly client: FalClient | null;

  constructor() {
    this.configuration = {
      apiKeyPresent: Boolean(process.env.FAL_KEY),
      submissionEnabled: process.env.FAL_LIVE_SUBMISSION_ENABLED === "true",
    };
    this.client = this.configuration.apiKeyPresent
      ? createFalClient({ credentials: () => process.env.FAL_KEY })
      : null;
  }

  proposal(job: Job): GenerationProposal {
    return buildGenerationProposal(job, {
      providerConfigured: this.configuration.apiKeyPresent,
      liveSubmissionEnabled: this.configuration.submissionEnabled,
      storageConfigured: isS3Configured(),
    });
  }

  enableLocalTestSubmission(): void {
    this.configuration.submissionEnabled = true;
  }

  async submitLegacy(job: Job, imageUrl: string): Promise<string> {
    if (!this.client || !this.configuration.apiKeyPresent)
      throw new Error("fal.ai is not configured on the server.");
    if (!this.configuration.submissionEnabled)
      throw new Error("Live fal.ai submission is disabled on the server.");
    const request = buildProviderInput(job, imageUrl);
    const queued = await this.client.queue.submit(request.endpoint, { input: request.input });
    return queued.request_id;
  }

  async submit(
    request: ProviderNeutralGenerationRequest,
    options: { webhookUrl?: string } = {},
  ): Promise<{ requestId: string }> {
    if (!this.client || !this.configuration.apiKeyPresent)
      throw new Error("fal.ai is not configured on the server.");
    if (!this.configuration.submissionEnabled)
      throw new Error("Live fal.ai submission is disabled on the server.");
    const input = toKlingInput(request);
    const queued = await this.client.queue.submit(request.providerEndpoint, {
      input,
      ...(options.webhookUrl ? { webhookUrl: options.webhookUrl } : {}),
    });
    return { requestId: queued.request_id };
  }

  async poll(
    request: ProviderNeutralGenerationRequest,
    requestId: string,
  ): Promise<ProviderGenerationResult> {
    if (!this.client)
      return {
        state: "reconciliation_required",
        requestId,
        nonSensitiveReasonCode: "provider_unavailable",
      };
    try {
      const abortSignal = AbortSignal.timeout(pollTimeoutMs());
      await this.client.queue.subscribeToStatus(request.providerEndpoint, {
        requestId,
        logs: false,
        mode: "polling",
        pollInterval: 2_000,
        abortSignal,
      });
      const result = await this.client.queue.result(request.providerEndpoint, {
        requestId,
        abortSignal,
      });
      const data = result.data as { video?: { url?: unknown } };
      const videoUrl = data.video?.url;
      if (typeof videoUrl !== "string" || !videoUrl.startsWith("https://"))
        return {
          state: "reconciliation_required",
          requestId,
          nonSensitiveReasonCode: "payload_unavailable",
        };
      return { state: "completed", requestId, videoUrl };
    } catch {
      return {
        state: "reconciliation_required",
        requestId,
        nonSensitiveReasonCode: "provider_unavailable",
      };
    }
  }

  async result(job: Job, requestId: string): Promise<string> {
    if (!this.client) throw new Error("fal.ai is not configured on the server.");
    const endpoint = buildProviderInput(job, "https://private.invalid/source").endpoint;
    await this.client.queue.subscribeToStatus(endpoint, {
      requestId,
      logs: false,
      mode: "polling",
      pollInterval: 2_000,
    });
    const result = await this.client.queue.result(endpoint, { requestId });
    const videoUrl = result.data.video.url;
    if (!videoUrl || !videoUrl.startsWith("https://"))
      throw new Error("fal.ai returned an invalid video result.");
    return videoUrl;
  }
}

function pollTimeoutMs(): number {
  const configured = Number(process.env.FAL_POLL_TIMEOUT_MS ?? 15 * 60 * 1000);
  return Number.isSafeInteger(configured) && configured >= 30_000
    ? Math.min(configured, 30 * 60 * 1000)
    : 15 * 60 * 1000;
}

function toKlingInput(request: ProviderNeutralGenerationRequest): ProviderGenerationInput {
  const imageUrl = request.media.find((item) => item.role === "source")?.url;
  if (!imageUrl) throw new Error("Kling image-to-video requires a source image.");
  return {
    image_url: imageUrl,
    prompt: request.prompt,
    duration: String(request.providerParameters.duration) as "5",
    negative_prompt: request.negativePrompt ?? "",
    cfg_scale: Number(request.providerParameters.cfg_scale),
  };
}
