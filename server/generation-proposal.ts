import { createHash } from "node:crypto";

import type { GenerationProposal, Job } from "../src/domain/types";
import { buildGenerationRequest, recipeForTemplate, type TemplateRecipe } from "./template-recipes";

export interface ProviderGenerationInput {
  image_url: string;
  prompt: string;
  duration: "5";
  negative_prompt: string;
  cfg_scale: number;
}

export const klingBaseline = {
  provider: "fal.ai",
  model: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  maximumCostUsd: 0.35,
  durationSeconds: 5,
  aspectRatio: "9:16",
} as const;

export function buildGenerationProposal(
  job: Job,
  configuration: Pick<
    GenerationProposal,
    "providerConfigured" | "liveSubmissionEnabled" | "storageConfigured"
  >,
): GenerationProposal {
  const recipe = requireRecipe(job);
  const id = createHash("sha256")
    .update(
      JSON.stringify({
        jobId: job.id,
        templateId: job.templateId,
        templateVersion: job.templateVersion,
        recipeVersion: recipe.recipeVersion,
        validationPolicyVersion: job.validationPolicyVersion,
        validationResult: job.validationResult,
        creditCost: recipe.creditCost,
        providerCostCeilingUsd: recipe.providerCostCeilingUsd,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return {
    id,
    templateId: job.templateId,
    templateVersion: job.templateVersion,
    recipeVersion: recipe.recipeVersion,
    expectedOutput: `${recipe.durationSeconds}-second ${recipe.aspectRatio} MP4 based on the approved source media`,
    durationSeconds: recipe.durationSeconds,
    aspectRatio: recipe.aspectRatio,
    resolution: recipe.resolution,
    audioMode: recipe.audioMode,
    creditCost: recipe.creditCost,
    estimatedMaximumCostUsd: recipe.providerCostCeilingUsd,
    maximumApprovedPriceUsd: recipe.providerCostCeilingUsd,
    approvalRequired: true,
    ...configuration,
  };
}

export function buildProviderInput(
  job: Job,
  imageUrl: string,
): { endpoint: TemplateRecipe["providerEndpoint"]; input: ProviderGenerationInput } {
  const recipe = requireRecipe(job);
  const request = buildGenerationRequest(recipe, [
    { kind: "image", role: "source", url: imageUrl },
  ]);
  return {
    endpoint: recipe.providerEndpoint,
    input: {
      image_url: imageUrl,
      prompt: request.prompt,
      duration: String(request.providerParameters.duration) as "5",
      negative_prompt: request.negativePrompt ?? "",
      cfg_scale: Number(request.providerParameters.cfg_scale),
    },
  };
}

function requireRecipe(job: Job): TemplateRecipe {
  const recipe = recipeForTemplate(job.templateId, job.templateVersion);
  if (!recipe) throw new Error("Paid generation is unavailable for this template.");
  return recipe;
}
