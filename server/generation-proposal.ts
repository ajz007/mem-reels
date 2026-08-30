import { createHash } from "node:crypto";

import type { GenerationProposal, Job } from "../src/domain/types";

export const klingBaseline = {
  provider: "fal.ai",
  model: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  maximumCostUsd: 0.35,
  durationSeconds: 5,
  aspectRatio: "9:16",
} as const;

export const weddingPortraitPrompt =
  "Preserve the depicted person or couple’s identity, clothing, jewelry, body proportions, and setting. Apply a warm expression, subtle fabric movement, and a slow stable cinematic push-in. No speaking, large gestures, pose changes, new people, or scene transition.";

export const weddingPortraitNegativePrompt =
  "identity change, face distortion, warped hands, extra fingers, extra limbs, body deformation, speaking, lip sync, large gesture, camera shake, scene change, blur, low quality";

export function buildGenerationProposal(
  job: Job,
  configuration: Pick<
    GenerationProposal,
    "providerConfigured" | "liveSubmissionEnabled" | "storageConfigured"
  >,
): GenerationProposal {
  if (job.templateId !== "wedding-portrait-comes-alive") throw new Error("Unsupported template.");
  const input = {
    image_url: `<private S3 source for job ${job.id}; signed URL created at submission>`,
    prompt: weddingPortraitPrompt,
    duration: "5" as const,
    negative_prompt: weddingPortraitNegativePrompt,
    cfg_scale: 0.5,
  };
  const id = createHash("sha256")
    .update(JSON.stringify({ jobId: job.id, model: klingBaseline.model, input }))
    .digest("hex")
    .slice(0, 24);
  return {
    id,
    model: klingBaseline.model,
    input,
    expectedOutput: "5-second vertical MP4 based on the uploaded portrait",
    estimatedMaximumCostUsd: klingBaseline.maximumCostUsd,
    approvalRequired: true,
    ...configuration,
  };
}
