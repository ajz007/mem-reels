import type { VisionCompatibilityObservations } from "../src/domain/validation";

export interface ValidationPolicy {
  id: string;
  version: number;
  deterministic: {
    maximumBytes: number;
    maximumPixels: number;
    minimumWidth: number;
    minimumHeight: number;
    acceptedFormats: readonly ["jpeg", "png", "webp"];
  };
  compatibility: {
    minimumSubjects: number;
    maximumSubjects: number;
    requireVisibleFacePerSubject: boolean;
    acceptedFraming: readonly VisionCompatibilityObservations["framing"][];
    severeEdgeClippingFails: boolean;
    poorCropFails: boolean;
    highBlurFails: boolean;
    majorOcclusionFails: boolean;
  };
  compatibleAlternativeTemplateIds: readonly string[];
}

export const weddingPortraitValidationPolicy: ValidationPolicy = {
  id: "wedding-portrait-compatibility",
  version: 1,
  deterministic: {
    maximumBytes: 20 * 1024 * 1024,
    maximumPixels: 40_000_000,
    minimumWidth: 320,
    minimumHeight: 320,
    acceptedFormats: ["jpeg", "png", "webp"],
  },
  compatibility: {
    minimumSubjects: 1,
    maximumSubjects: 2,
    requireVisibleFacePerSubject: true,
    acceptedFraming: ["portrait"],
    severeEdgeClippingFails: true,
    poorCropFails: true,
    highBlurFails: true,
    majorOcclusionFails: true,
  },
  compatibleAlternativeTemplateIds: [],
};

export const developmentParallaxValidationPolicy: ValidationPolicy = {
  ...weddingPortraitValidationPolicy,
  id: "single-portrait-parallax-compatibility",
  compatibility: {
    ...weddingPortraitValidationPolicy.compatibility,
    maximumSubjects: 1,
    acceptedFraming: ["portrait", "full_body"],
  },
  compatibleAlternativeTemplateIds: ["wedding-portrait-comes-alive"],
};

export function validationPolicyForTemplate(
  templateId: string,
  templateVersion: number,
): ValidationPolicy | null {
  if (templateVersion !== 1) return null;
  if (templateId === "wedding-portrait-comes-alive") return weddingPortraitValidationPolicy;
  if (templateId === "single-portrait-gentle-parallax") return developmentParallaxValidationPolicy;
  return null;
}
