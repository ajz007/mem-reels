import { describe, expect, it } from "vitest";

import { GenerationAdapterRegistry } from "../server/generation-adapters";
import {
  buildGenerationRequest,
  futureReferenceMotionFixtureRecipe,
  futureStartEndFixtureRecipe,
} from "../server/template-recipes";
import type { GenerationAdapter } from "../src/domain/generation";

const adapter = (key: string): GenerationAdapter => ({
  key,
  configuration: { apiKeyPresent: true, submissionEnabled: true },
  async submit() {
    return { requestId: "fixture-request" };
  },
  async poll(_request, requestId) {
    return { state: "completed", requestId, videoUrl: "https://fixture.invalid/video.mp4" };
  },
});

describe("versioned generation routing", () => {
  it("builds future start/end-frame and reference-motion shapes without activating them", () => {
    const startEnd = buildGenerationRequest(futureStartEndFixtureRecipe, [
      { kind: "image", role: "start_frame", url: "https://private.invalid/start" },
      { kind: "image", role: "end_frame", url: "https://private.invalid/end" },
    ]);
    const reference = buildGenerationRequest(futureReferenceMotionFixtureRecipe, [
      { kind: "image", role: "source", url: "https://private.invalid/source" },
      { kind: "video", role: "motion_reference", url: "https://private.invalid/motion" },
    ]);
    expect(startEnd.requestKind).toBe("start_end_frame_video");
    expect(startEnd.audioMode).toBe("generated_optional");
    expect(reference.requestKind).toBe("reference_video_motion");
    expect(reference.audioMode).toBe("generated_required");
  });

  it("routes only through an explicitly registered versioned adapter", () => {
    const registry = new GenerationAdapterRegistry([adapter("fixture:start-end:v1")]);
    expect(registry.require("fixture:start-end:v1").key).toBe("fixture:start-end:v1");
    expect(() => registry.require("fixture:start-end:v2")).toThrow("not registered");
  });
});
