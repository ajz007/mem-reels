import { describe, expect, it } from "vitest";

import { buildGenerationProposal } from "../server/generation-proposal";
import type { Job } from "../src/domain/types";

const job: Job = {
  id: "job-123",
  userId: "user-123",
  templateId: "wedding-portrait-comes-alive",
  status: "validated",
  consent: { acknowledgedAt: "2026-08-30T00:00:00.000Z", permissionConfirmed: true },
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
    expect(first.model).toBe("fal-ai/kling-video/v2.5-turbo/pro/image-to-video");
    expect(first.estimatedMaximumCostUsd).toBe(0.35);
    expect(first.input.duration).toBe("5");
    expect(first.input).not.toHaveProperty("aspect_ratio");
    expect(first.approvalRequired).toBe(true);
  });

  it("does not place a credential or signed URL in the review payload", () => {
    const proposal = buildGenerationProposal(job, {
      providerConfigured: true,
      liveSubmissionEnabled: true,
      storageConfigured: true,
    });

    expect(proposal.input.image_url).toContain("private S3 source");
    expect(JSON.stringify(proposal)).not.toContain("X-Amz-Credential");
  });
});
