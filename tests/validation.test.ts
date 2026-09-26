import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { validateImage } from "../server/validation";
import { validateTemplateCompatibility } from "../server/compatibility-validation";
import { weddingPortraitValidationPolicy } from "../server/validation-policy";
import {
  DeterministicVisionCompatibilityAdapter,
  UnavailableVisionCompatibilityAdapter,
} from "../server/vision-adapters";
import type { VisionCompatibilityProvider } from "../src/domain/ports";
import type { VisionCompatibilityObservations } from "../src/domain/validation";

async function validPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 320,
      height: 320,
      channels: 3,
      background: { r: 176, g: 116, b: 133 },
    },
  })
    .png()
    .toBuffer();
}

describe("image preflight validation", () => {
  it("fully decodes a valid supported source", async () => {
    const result = await validateImage(await validPng());
    expect(result.width).toBeGreaterThanOrEqual(320);
    expect(result.height).toBeGreaterThanOrEqual(320);
  });

  it("rejects a truncated image before a provider attempt", async () => {
    const truncated = (await validPng()).subarray(0, 20);
    await expect(validateImage(truncated)).rejects.toMatchObject({ code: "invalid_image_source" });
  });
});

const readyObservations: VisionCompatibilityObservations = {
  subjectCount: 2,
  visibleFaceCount: 2,
  edgeClipping: "none",
  cropSuitability: "good",
  framing: "portrait",
  blur: "low",
  exposure: "good",
  occlusion: "none",
};

async function compatibility(provider: VisionCompatibilityProvider) {
  return validateTemplateCompatibility(await validPng(), {
    templateId: "wedding-portrait-comes-alive",
    templateVersion: 1,
    policy: weddingPortraitValidationPolicy,
    visionProvider: provider,
  });
}

describe("template compatibility validation", () => {
  it("returns ready when deterministic and template observations pass", async () => {
    const output = await compatibility(
      new DeterministicVisionCompatibilityAdapter(readyObservations),
    );

    expect(output.result.outcome).toBe("ready");
    expect(output.result.rules.every((rule) => rule.status === "pass")).toBe(true);
    expect(output.result.policyVersion).toBe(1);
  });

  it("returns ready_with_warnings for a correctable visual risk", async () => {
    const output = await compatibility(
      new DeterministicVisionCompatibilityAdapter({
        ...readyObservations,
        edgeClipping: "minor",
        blur: "moderate",
      }),
    );

    expect(output.result.outcome).toBe("ready_with_warnings");
    expect(output.result.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reasonCode: "edge_clipping_risk", status: "warning" }),
        expect.objectContaining({ reasonCode: "blur_risk", status: "warning" }),
      ]),
    );
  });

  it("returns not_suitable when a deterministic template rule hard-fails", async () => {
    const output = await compatibility(
      new DeterministicVisionCompatibilityAdapter({
        ...readyObservations,
        subjectCount: 4,
        visibleFaceCount: 4,
      }),
    );

    expect(output.result.outcome).toBe("not_suitable");
    expect(output.result.rules).toContainEqual(
      expect.objectContaining({ reasonCode: "subject_count_unsuitable", status: "failure" }),
    );
  });

  it("warns instead of inventing a decision when the provider is unavailable", async () => {
    const output = await compatibility(new UnavailableVisionCompatibilityAdapter());

    expect(output.result.outcome).toBe("ready_with_warnings");
    expect(output.result.visionAssessment).toEqual({
      status: "unavailable",
      imageSentToExternalProvider: false,
    });
    expect(output.result.rules).toContainEqual(
      expect.objectContaining({ reasonCode: "vision_provider_unavailable", status: "warning" }),
    );
  });

  it("ignores malformed provider observations and returns a warning", async () => {
    const malformedProvider: VisionCompatibilityProvider = {
      sendsImageToExternalProvider: false,
      async analyze() {
        return {
          status: "completed",
          observations: { subjectCount: "two" },
        } as never;
      },
    };
    const output = await compatibility(malformedProvider);

    expect(output.result.outcome).toBe("ready_with_warnings");
    expect(output.result.visionAssessment.status).toBe("malformed");
    expect(output.result.rules).toContainEqual(
      expect.objectContaining({ reasonCode: "vision_provider_malformed", status: "warning" }),
    );
  });

  it("returns a structured hard failure for a corrupt image without calling vision", async () => {
    let providerCalled = false;
    const provider: VisionCompatibilityProvider = {
      sendsImageToExternalProvider: false,
      async analyze() {
        providerCalled = true;
        return { status: "completed", observations: readyObservations };
      },
    };
    const output = await validateTemplateCompatibility(Buffer.from("not an image"), {
      templateId: "wedding-portrait-comes-alive",
      templateVersion: 1,
      policy: weddingPortraitValidationPolicy,
      visionProvider: provider,
    });

    expect(output.result.outcome).toBe("not_suitable");
    expect(output.result.rules[0]).toMatchObject({
      reasonCode: "file_signature_invalid",
      status: "failure",
    });
    expect(providerCalled).toBe(false);
  });
});
