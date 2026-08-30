import { createFalClient, type FalClient } from "@fal-ai/client";

import type { GenerationProposal, Job } from "../src/domain/types";
import { buildGenerationProposal } from "./generation-proposal";
import { isS3Configured } from "./s3-storage";

export interface FalConfiguration {
  apiKeyPresent: boolean;
  submissionEnabled: boolean;
}

export class FalAdapter {
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

  async submit(input: GenerationProposal["input"]): Promise<string> {
    if (!this.client || !this.configuration.apiKeyPresent)
      throw new Error("fal.ai is not configured on the server.");
    if (!this.configuration.submissionEnabled)
      throw new Error("Live fal.ai submission is disabled on the server.");
    const queued = await this.client.queue.submit(
      "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
      { input },
    );
    return queued.request_id;
  }

  async result(requestId: string): Promise<string> {
    if (!this.client) throw new Error("fal.ai is not configured on the server.");
    await this.client.queue.subscribeToStatus("fal-ai/kling-video/v2.5-turbo/pro/image-to-video", {
      requestId,
      logs: false,
      mode: "polling",
      pollInterval: 2_000,
    });
    const result = await this.client.queue.result(
      "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
      { requestId },
    );
    const videoUrl = result.data.video.url;
    if (!videoUrl || !videoUrl.startsWith("https://"))
      throw new Error("fal.ai returned an invalid video result.");
    return videoUrl;
  }
}
