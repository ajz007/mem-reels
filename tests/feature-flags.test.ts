import { describe, expect, it } from "vitest";

import { loadFeatureFlags } from "../server/feature-flags";

describe("server-owned feature flags", () => {
  it("uses safe production defaults", () => {
    expect(loadFeatureFlags({})).toEqual({
      experimentalTemplatesEnabled: false,
      validationMode: "blocking",
    });
  });

  it("accepts only explicit supported values", () => {
    expect(
      loadFeatureFlags({
        MEMORY_REELS_EXPERIMENTAL_TEMPLATES: "true",
        MEMORY_REELS_VALIDATION_MODE: "advisory",
      }),
    ).toEqual({ experimentalTemplatesEnabled: true, validationMode: "advisory" });

    expect(
      loadFeatureFlags({
        MEMORY_REELS_EXPERIMENTAL_TEMPLATES: "yes",
        MEMORY_REELS_VALIDATION_MODE: "disabled",
      }),
    ).toEqual({ experimentalTemplatesEnabled: false, validationMode: "blocking" });
  });
});
