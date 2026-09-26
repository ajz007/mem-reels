export const validationOutcomes = ["ready", "ready_with_warnings", "not_suitable"] as const;

export type ValidationOutcome = (typeof validationOutcomes)[number];
export type ValidationRuleStatus = "pass" | "warning" | "failure";

export const validationReasonCodes = [
  "file_signature_valid",
  "file_signature_invalid",
  "full_decode_valid",
  "full_decode_failed",
  "file_size_valid",
  "file_too_large",
  "dimensions_valid",
  "dimensions_too_small",
  "pixel_count_valid",
  "pixel_count_too_large",
  "subject_count_suitable",
  "subject_count_unsuitable",
  "faces_visible",
  "faces_not_visible",
  "edge_clearance_good",
  "edge_clipping_risk",
  "edge_clipping_severe",
  "crop_suitable",
  "crop_risk",
  "crop_unsuitable",
  "framing_suitable",
  "framing_risk",
  "blur_low",
  "blur_risk",
  "blur_severe",
  "exposure_good",
  "exposure_risk",
  "occlusion_clear",
  "occlusion_risk",
  "occlusion_severe",
  "vision_provider_unavailable",
  "vision_provider_malformed",
] as const;

export type ValidationReasonCode = (typeof validationReasonCodes)[number];

export interface ValidationRuleResult {
  reasonCode: ValidationReasonCode;
  status: ValidationRuleStatus;
  explanation: string;
  suggestedCorrection: string;
}

export interface CompatibilityValidationResult {
  policyId: string;
  policyVersion: number;
  evaluatedAt: string;
  outcome: ValidationOutcome;
  rules: readonly ValidationRuleResult[];
  visionAssessment: {
    status: "completed" | "unavailable" | "malformed";
    imageSentToExternalProvider: boolean;
  };
  compatibleAlternativeTemplateIds: readonly string[];
  creditOutcome: "not_used";
}

export interface VisionCompatibilityObservations {
  subjectCount: number;
  visibleFaceCount: number;
  edgeClipping: "none" | "minor" | "severe";
  cropSuitability: "good" | "risky" | "poor";
  framing: "portrait" | "full_body" | "other";
  blur: "low" | "moderate" | "high";
  exposure: "good" | "underexposed" | "overexposed";
  occlusion: "none" | "minor" | "major";
}

export interface VisionCompatibilityRequest {
  image: Uint8Array;
  templateId: string;
  templateVersion: number;
  validationPolicyVersion: number;
}
