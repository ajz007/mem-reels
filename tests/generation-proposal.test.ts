import { describe, expect, it } from "vitest";

import { buildGenerationProposal, buildProviderInput } from "../server/generation-proposal";
import { recipeForTemplate } from "../server/template-recipes";
import type { Job } from "../src/domain/types";

const job: Job = {
  id: "job-123",
  userId: "user-123",
  templateId: "wedding-portrait-comes-alive",
  templateVersion: 1,
  status: "validated",
  consent: { acknowledgedAt: "2026-08-30T00:00:00.000Z", permissionConfirmed: true },
  validationPolicyVersion: 1,
  validationResult: {
    policyId: "wedding-portrait-compatibility",
    policyVersion: 1,
    evaluatedAt: "2026-08-30T00:00:00.000Z",
    outcome: "ready",
    rules: [],
    visionAssessment: { status: "completed", imageSentToExternalProvider: false },
    compatibleAlternativeTemplateIds: [],
    creditOutcome: "not_used",
  },
};

describe("live generation proposal", () => {
  it("is stable, capped, and uses the current Kling image-to-video schema", () => {
    const configuration = {
      providerConfigured: true,
      liveSubmissionEnabled: false,
      storageConfigured: true,
    };
    const first = buildGenerationProposal(job, configuration);
    const second = buildGenerationProposal(job, configuration);

    expect(first.id).toBe(second.id);
    expect(first.templateId).toBe("wedding-portrait-comes-alive");
    expect(first.templateVersion).toBe(1);
    expect(first.recipeVersion).toBe("wedding-portrait-v1");
    expect(first.durationSeconds).toBe(5);
    expect(first.aspectRatio).toBe("9:16");
    expect(first.resolution.label).toBe("1080 × 1920");
    expect(first.audioMode).toBe("none");
    expect(first.creditCost).toBe(1);
    expect(first.estimatedMaximumCostUsd).toBe(0.35);
    expect(first.approvalRequired).toBe(true);
  });

  it("changes the approval hash when the validation snapshot changes", () => {
    const first = buildGenerationProposal(job, {
      providerConfigured: true,
      liveSubmissionEnabled: true,
      storageConfigured: true,
    });
    const changed = buildGenerationProposal(
      {
        ...job,
        validationResult: { ...job.validationResult!, outcome: "ready_with_warnings" },
      },
      { providerConfigured: true, liveSubmissionEnabled: true, storageConfigured: true },
    );
    expect(changed.id).not.toBe(first.id);
  });

  it("does not expose the private recipe in the review payload", () => {
    const proposal = buildGenerationProposal(job, {
      providerConfigured: true,
      liveSubmissionEnabled: true,
      storageConfigured: true,
    });

    const serialized = JSON.stringify(proposal);
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("image_url");
    expect(serialized).not.toContain("kling-video");
    expect(serialized).not.toContain("X-Amz-Credential");
  });

  it("preserves the approved wedding provider request on the server", () => {
    const request = buildProviderInput(job, "https://signed.example/source.png");

    expect(request.endpoint).toBe("fal-ai/kling-video/v2.5-turbo/pro/image-to-video");
    expect(request.input).toMatchObject({
      image_url: "https://signed.example/source.png",
      duration: "5",
      cfg_scale: 0.5,
    });
    expect(request.input.prompt).toContain("slow stable cinematic push-in");
    expect(request.input.negative_prompt).toContain("identity change");
    expect(recipeForTemplate(job.templateId, job.templateVersion)?.validationPolicy).toMatchObject({
      id: "wedding-portrait-compatibility",
      version: 1,
    });
  });
});
