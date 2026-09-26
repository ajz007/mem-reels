import type { VisionCompatibilityProvider } from "../src/domain/ports";
import type {
  CompatibilityValidationResult,
  ValidationReasonCode,
  ValidationRuleResult,
  VisionCompatibilityObservations,
} from "../src/domain/validation";
import { InputValidationError, validateImage, type ValidatedImage } from "./validation";
import type { ValidationPolicy } from "./validation-policy";

export interface CompatibilityValidationOutput {
  result: CompatibilityValidationResult;
  image?: ValidatedImage;
}

export async function validateTemplateCompatibility(
  bytes: Buffer,
  input: {
    templateId: string;
    templateVersion: number;
    policy: ValidationPolicy;
    visionProvider: VisionCompatibilityProvider;
  },
): Promise<CompatibilityValidationOutput> {
  let image: ValidatedImage;
  try {
    image = await validateImage(bytes, input.policy.deterministic);
  } catch (error) {
    const validationError =
      error instanceof InputValidationError
        ? error
        : new InputValidationError(
            "invalid_image_source",
            "This image could not be validated.",
            "full_decode_failed",
          );
    return {
      result: buildResult(input.policy, [failureRule(validationError)], {
        status: "unavailable",
        imageSentToExternalProvider: false,
      }),
    };
  }

  const rules: ValidationRuleResult[] = deterministicPassRules(image);
  let providerResult: Awaited<ReturnType<VisionCompatibilityProvider["analyze"]>>;
  try {
    providerResult = await input.visionProvider.analyze({
      image: image.normalized,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      validationPolicyVersion: input.policy.version,
    });
  } catch {
    providerResult = { status: "unavailable" };
  }

  if (providerResult.status === "unavailable") {
    rules.push({
      reasonCode: "vision_provider_unavailable",
      status: "warning",
      explanation:
        "The advanced subject and framing check was unavailable, but the file passed every technical safety check.",
      suggestedCorrection:
        "Review the template guidance carefully, or try the compatibility check again later.",
    });
  } else if (
    providerResult.status === "malformed" ||
    !isVisionObservations(providerResult.observations)
  ) {
    rules.push({
      reasonCode: "vision_provider_malformed",
      status: "warning",
      explanation:
        "The advanced check returned an incomplete result, so it was not allowed to approve or reject this photo.",
      suggestedCorrection: "Try the compatibility check again or review the guidance manually.",
    });
    providerResult = { status: "malformed" };
  } else {
    rules.push(...evaluateVisionRules(providerResult.observations, input.policy));
  }

  return {
    image,
    result: buildResult(input.policy, rules, {
      status: providerResult.status,
      imageSentToExternalProvider: input.visionProvider.sendsImageToExternalProvider,
    }),
  };
}

function buildResult(
  policy: ValidationPolicy,
  rules: readonly ValidationRuleResult[],
  visionAssessment: CompatibilityValidationResult["visionAssessment"],
): CompatibilityValidationResult {
  const outcome = rules.some((rule) => rule.status === "failure")
    ? "not_suitable"
    : rules.some((rule) => rule.status === "warning")
      ? "ready_with_warnings"
      : "ready";
  return {
    policyId: policy.id,
    policyVersion: policy.version,
    evaluatedAt: new Date().toISOString(),
    outcome,
    rules,
    visionAssessment,
    compatibleAlternativeTemplateIds: policy.compatibleAlternativeTemplateIds,
    creditOutcome: "not_used",
  };
}

function deterministicPassRules(image: ValidatedImage): ValidationRuleResult[] {
  return [
    pass(
      "file_signature_valid",
      `The file signature is a supported ${image.format.toUpperCase()} image.`,
    ),
    pass("full_decode_valid", "The complete image decoded successfully."),
    pass("file_size_valid", "The file is within the private upload size limit."),
    pass("dimensions_valid", `The ${image.width} × ${image.height} dimensions are large enough.`),
    pass("pixel_count_valid", "The image is within the safe pixel-count limit."),
  ];
}

function evaluateVisionRules(
  observation: VisionCompatibilityObservations,
  policy: ValidationPolicy,
): ValidationRuleResult[] {
  const rules: ValidationRuleResult[] = [];
  const subjectSuitable =
    observation.subjectCount >= policy.compatibility.minimumSubjects &&
    observation.subjectCount <= policy.compatibility.maximumSubjects;
  rules.push(
    subjectSuitable
      ? pass(
          "subject_count_suitable",
          `The detected subject count (${observation.subjectCount}) fits this template.`,
        )
      : fail(
          "subject_count_unsuitable",
          `This template needs ${policy.compatibility.minimumSubjects}–${policy.compatibility.maximumSubjects} clearly framed people; ${observation.subjectCount} were detected.`,
          "Choose a photo with the expected number of people, or select a better-matched template.",
        ),
  );

  const facesVisible =
    !policy.compatibility.requireVisibleFacePerSubject ||
    observation.visibleFaceCount >= observation.subjectCount;
  rules.push(
    facesVisible
      ? pass("faces_visible", "Each detected subject has a clearly visible face.")
      : fail(
          "faces_not_visible",
          "One or more faces may be hidden, turned away, or too small for reliable animation.",
          "Use a front-facing photo where every face is clear and unobstructed.",
        ),
  );

  rules.push(
    observation.edgeClipping === "none"
      ? pass("edge_clearance_good", "Subjects have comfortable space around the frame edges.")
      : observation.edgeClipping === "severe" && policy.compatibility.severeEdgeClippingFails
        ? fail(
            "edge_clipping_severe",
            "A subject is substantially cut off by the image edge.",
            "Choose a wider crop with the full head, shoulders, and clothing inside the frame.",
          )
        : warn(
            "edge_clipping_risk",
            "A subject is close to an image edge and motion may reveal missing detail.",
            "Use a slightly wider crop with more background around the subject.",
          ),
  );

  rules.push(
    observation.cropSuitability === "good"
      ? pass("crop_suitable", "The crop has enough room for the template’s camera movement.")
      : observation.cropSuitability === "poor" && policy.compatibility.poorCropFails
        ? fail(
            "crop_unsuitable",
            "The crop does not leave enough usable space for this template’s motion.",
            "Choose an uncropped or wider version of the photo.",
          )
        : warn(
            "crop_risk",
            "The crop may limit the intended camera movement.",
            "A wider image with more background will produce a more reliable result.",
          ),
  );

  rules.push(
    policy.compatibility.acceptedFraming.includes(observation.framing)
      ? pass("framing_suitable", "The subject framing matches this template.")
      : warn(
          "framing_risk",
          "The detected framing is not the preferred composition for this template.",
          "Use a posed portrait with the people centered and clearly visible.",
        ),
  );

  rules.push(
    observation.blur === "low"
      ? pass("blur_low", "The photo appears sharp enough for facial detail.")
      : observation.blur === "high" && policy.compatibility.highBlurFails
        ? fail(
            "blur_severe",
            "The photo is too blurred for reliable face and clothing preservation.",
            "Choose a sharper original or rescan the photo at higher quality.",
          )
        : warn(
            "blur_risk",
            "Some softness may reduce facial detail in the generated reel.",
            "Use the sharpest available version of this photo.",
          ),
  );

  rules.push(
    observation.exposure === "good"
      ? pass("exposure_good", "Faces and clothing have usable brightness and contrast.")
      : warn(
          "exposure_risk",
          "The photo appears underexposed or overexposed in important areas.",
          "Choose a more evenly lit photo or correct its brightness before uploading.",
        ),
  );

  rules.push(
    observation.occlusion === "none"
      ? pass("occlusion_clear", "Important face and body details are unobstructed.")
      : observation.occlusion === "major" && policy.compatibility.majorOcclusionFails
        ? fail(
            "occlusion_severe",
            "An important face or body area is substantially obstructed.",
            "Choose a photo without hands, objects, or other people covering the subjects.",
          )
        : warn(
            "occlusion_risk",
            "A small obstruction may create unstable detail during motion.",
            "Use a photo with clearer, unobstructed faces and clothing where possible.",
          ),
  );
  return rules;
}

function isVisionObservations(value: unknown): value is VisionCompatibilityObservations {
  if (!value || typeof value !== "object") return false;
  const observation = value as Record<string, unknown>;
  return (
    Number.isInteger(observation.subjectCount) &&
    Number(observation.subjectCount) >= 0 &&
    Number.isInteger(observation.visibleFaceCount) &&
    Number(observation.visibleFaceCount) >= 0 &&
    ["none", "minor", "severe"].includes(String(observation.edgeClipping)) &&
    ["good", "risky", "poor"].includes(String(observation.cropSuitability)) &&
    ["portrait", "full_body", "other"].includes(String(observation.framing)) &&
    ["low", "moderate", "high"].includes(String(observation.blur)) &&
    ["good", "underexposed", "overexposed"].includes(String(observation.exposure)) &&
    ["none", "minor", "major"].includes(String(observation.occlusion))
  );
}

function failureRule(error: InputValidationError): ValidationRuleResult {
  const reasonCode = error.reasonCode ?? "full_decode_failed";
  return fail(reasonCode, error.message, correctionFor(reasonCode));
}

function correctionFor(reasonCode: ValidationReasonCode): string {
  if (reasonCode === "file_too_large") return "Export a smaller image under 20 MB.";
  if (reasonCode === "dimensions_too_small")
    return "Choose an original that is at least 320 pixels on each side.";
  if (reasonCode === "pixel_count_too_large")
    return "Resize the image below 40 megapixels and upload the new copy.";
  if (reasonCode === "file_signature_invalid") return "Use a genuine JPEG, PNG, or WebP file.";
  return "Export or download a fresh copy of the original image and try again.";
}

function pass(reasonCode: ValidationReasonCode, explanation: string): ValidationRuleResult {
  return { reasonCode, status: "pass", explanation, suggestedCorrection: "No change needed." };
}

function warn(
  reasonCode: ValidationReasonCode,
  explanation: string,
  suggestedCorrection: string,
): ValidationRuleResult {
  return { reasonCode, status: "warning", explanation, suggestedCorrection };
}

function fail(
  reasonCode: ValidationReasonCode,
  explanation: string,
  suggestedCorrection: string,
): ValidationRuleResult {
  return { reasonCode, status: "failure", explanation, suggestedCorrection };
}
