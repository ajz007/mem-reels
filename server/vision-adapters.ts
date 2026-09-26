import type { VisionCompatibilityProvider } from "../src/domain/ports";
import type { VisionCompatibilityObservations } from "../src/domain/validation";

export class UnavailableVisionCompatibilityAdapter implements VisionCompatibilityProvider {
  readonly sendsImageToExternalProvider = false;

  async analyze(): Promise<{ status: "unavailable" }> {
    return { status: "unavailable" };
  }
}

export class DeterministicVisionCompatibilityAdapter implements VisionCompatibilityProvider {
  readonly sendsImageToExternalProvider = false;

  constructor(
    private readonly response: VisionCompatibilityObservations | "unavailable" | "malformed" = {
      subjectCount: 1,
      visibleFaceCount: 1,
      edgeClipping: "none",
      cropSuitability: "good",
      framing: "portrait",
      blur: "low",
      exposure: "good",
      occlusion: "none",
    },
  ) {}

  async analyze(): Promise<
    | { status: "completed"; observations: VisionCompatibilityObservations }
    | { status: "unavailable" }
    | { status: "malformed" }
  > {
    if (this.response === "unavailable") return { status: "unavailable" };
    if (this.response === "malformed") return { status: "malformed" };
    return { status: "completed", observations: this.response };
  }
}
