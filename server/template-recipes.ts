import type {
  GenerationAudioMode,
  GenerationMediaReference,
  GenerationRequestKind,
  ProviderNeutralGenerationRequest,
} from "../src/domain/generation";
import type { ValidationPolicy } from "./validation-policy";
import { weddingPortraitValidationPolicy } from "./validation-policy";

interface GenerationRecipeBase {
  templateId: string;
  templateVersion: number;
  recipeVersion: string;
  provider: "fal.ai" | "fixture";
  providerAdapterKey: string;
  providerEndpoint: string;
  requestKind: GenerationRequestKind;
  prompt: string;
  negativePrompt?: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution: { width: number; height: number; label: string };
  audioMode: GenerationAudioMode;
  creditCost: number;
  providerCostCeilingUsd: number;
  validationPolicy: ValidationPolicy;
}

export interface ImageToVideoRecipe extends GenerationRecipeBase {
  requestKind: "image_to_video";
  providerParameters: Readonly<Record<string, unknown>> & { duration: string };
}

export interface StartEndFrameRecipe extends GenerationRecipeBase {
  requestKind: "start_end_frame_video";
  providerParameters: Readonly<Record<string, unknown>>;
}

export interface ReferenceMotionRecipe extends GenerationRecipeBase {
  requestKind: "reference_video_motion";
  providerParameters: Readonly<Record<string, unknown>>;
}

export type TemplateRecipe = ImageToVideoRecipe | StartEndFrameRecipe | ReferenceMotionRecipe;

export const weddingPortraitPrompt =
  "Preserve the depicted person or couple’s identity, clothing, jewelry, body proportions, and setting. Apply a warm expression, subtle fabric movement, and a slow stable cinematic push-in. No speaking, large gestures, pose changes, new people, or scene transition.";

export const weddingPortraitNegativePrompt =
  "identity change, face distortion, warped hands, extra fingers, extra limbs, body deformation, speaking, lip sync, large gesture, camera shake, scene change, blur, low quality";

export const weddingPortraitRecipe: ImageToVideoRecipe = {
  templateId: "wedding-portrait-comes-alive",
  templateVersion: 1,
  recipeVersion: "wedding-portrait-v1",
  provider: "fal.ai",
  providerAdapterKey: "fal:kling-2.5-turbo-pro:v1",
  providerEndpoint: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  requestKind: "image_to_video",
  prompt: weddingPortraitPrompt,
  negativePrompt: weddingPortraitNegativePrompt,
  providerParameters: { duration: "5", cfg_scale: 0.5 },
  durationSeconds: 5,
  aspectRatio: "9:16",
  resolution: { width: 1080, height: 1920, label: "1080 × 1920" },
  audioMode: "none",
  creditCost: 1,
  validationPolicy: weddingPortraitValidationPolicy,
  providerCostCeilingUsd: 0.35,
};

const recipes: readonly TemplateRecipe[] = [weddingPortraitRecipe];

export function recipeForTemplate(
  templateId: string,
  templateVersion: number,
): TemplateRecipe | null {
  return (
    recipes.find(
      (recipe) => recipe.templateId === templateId && recipe.templateVersion === templateVersion,
    ) ?? null
  );
}

export function buildGenerationRequest(
  recipe: TemplateRecipe,
  media: readonly GenerationMediaReference[],
): ProviderNeutralGenerationRequest {
  assertRequiredMedia(recipe.requestKind, media);
  return {
    providerAdapterKey: recipe.providerAdapterKey,
    providerEndpoint: recipe.providerEndpoint,
    recipeVersion: recipe.recipeVersion,
    requestKind: recipe.requestKind,
    media,
    prompt: recipe.prompt,
    ...(recipe.negativePrompt ? { negativePrompt: recipe.negativePrompt } : {}),
    durationSeconds: recipe.durationSeconds,
    aspectRatio: recipe.aspectRatio,
    resolution: recipe.resolution,
    audioMode: recipe.audioMode,
    providerParameters: recipe.providerParameters,
  };
}

function assertRequiredMedia(
  kind: GenerationRequestKind,
  media: readonly GenerationMediaReference[],
): void {
  const roles = new Set(media.map((item) => item.role));
  const valid =
    (kind === "image_to_video" && roles.has("source")) ||
    (kind === "start_end_frame_video" && roles.has("start_frame") && roles.has("end_frame")) ||
    (kind === "reference_video_motion" && roles.has("source") && roles.has("motion_reference"));
  if (!valid) throw new Error(`Generation recipe is missing media for ${kind}.`);
}

// Fixture-only recipe shapes prove future routing without activating paid templates.
export const futureStartEndFixtureRecipe: StartEndFrameRecipe = {
  ...weddingPortraitRecipe,
  templateId: "fixture-start-end",
  recipeVersion: "fixture-start-end-v1",
  provider: "fixture",
  providerAdapterKey: "fixture:start-end:v1",
  providerEndpoint: "fixture://start-end",
  requestKind: "start_end_frame_video",
  audioMode: "generated_optional",
  providerParameters: { interpolate: true },
  creditCost: 0,
  providerCostCeilingUsd: 0,
};

export const futureReferenceMotionFixtureRecipe: ReferenceMotionRecipe = {
  ...weddingPortraitRecipe,
  templateId: "fixture-reference-motion",
  recipeVersion: "fixture-reference-motion-v1",
  provider: "fixture",
  providerAdapterKey: "fixture:reference-motion:v1",
  providerEndpoint: "fixture://reference-motion",
  requestKind: "reference_video_motion",
  audioMode: "generated_required",
  providerParameters: { motionStrength: 0.5 },
  creditCost: 0,
  providerCostCeilingUsd: 0,
};
