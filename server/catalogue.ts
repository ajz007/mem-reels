import type { TemplateDetail, TemplateSummary } from "../src/domain/types";
import {
  developmentParallaxTemplate,
  toTemplateSummary,
  weddingPortraitTemplate,
} from "../src/fixtures/template";
import type { ServerFeatureFlags } from "./feature-flags";

const registeredTemplates: readonly TemplateDetail[] = [
  weddingPortraitTemplate,
  developmentParallaxTemplate,
];

export function templatesForFlags(flags: ServerFeatureFlags): readonly TemplateSummary[] {
  return registeredTemplates
    .filter((template) => isPubliclyAvailable(template, flags))
    .map(toTemplateSummary);
}

export function templateDetailForFlags(
  templateId: string,
  flags: ServerFeatureFlags,
): TemplateDetail | null {
  const template = registeredTemplates.find((candidate) => candidate.id === templateId);
  return template && isPubliclyAvailable(template, flags) ? template : null;
}

export function registeredTemplate(
  templateId: string,
  templateVersion?: number,
): TemplateDetail | null {
  return (
    registeredTemplates.find(
      (candidate) =>
        candidate.id === templateId &&
        (templateVersion === undefined || candidate.version === templateVersion),
    ) ?? null
  );
}

export function allRegisteredTemplatesForTests(): readonly TemplateDetail[] {
  return registeredTemplates;
}

function isPubliclyAvailable(template: TemplateDetail, flags: ServerFeatureFlags): boolean {
  if (template.status === "active") return true;
  return template.status === "experimental" && flags.experimentalTemplatesEnabled;
}
