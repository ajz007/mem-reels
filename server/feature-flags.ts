export interface ServerFeatureFlags {
  experimentalTemplatesEnabled: boolean;
  validationMode: "blocking" | "advisory";
}

export function loadFeatureFlags(environment: NodeJS.ProcessEnv = process.env): ServerFeatureFlags {
  return {
    experimentalTemplatesEnabled: environment.MEMORY_REELS_EXPERIMENTAL_TEMPLATES === "true",
    validationMode:
      environment.MEMORY_REELS_VALIDATION_MODE === "advisory" ? "advisory" : "blocking",
  };
}
