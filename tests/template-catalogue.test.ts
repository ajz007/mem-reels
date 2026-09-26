import { describe, expect, it } from "vitest";

import {
  allRegisteredTemplatesForTests,
  templateDetailForFlags,
  templatesForFlags,
} from "../server/catalogue";
import { recipeForTemplate } from "../server/template-recipes";
import { catalogueContent, templateDetailContent } from "../src/ui/app";

const defaults = { experimentalTemplatesEnabled: false, validationMode: "blocking" } as const;
const experiments = { ...defaults, experimentalTemplatesEnabled: true } as const;

describe("versioned template catalogue", () => {
  it("publishes active templates and safely gates experimental templates", () => {
    expect(templatesForFlags(defaults).map((template) => template.id)).toEqual([
      "wedding-portrait-comes-alive",
    ]);
    expect(templatesForFlags(experiments).map((template) => template.id)).toEqual([
      "wedding-portrait-comes-alive",
      "single-portrait-gentle-parallax",
    ]);
    expect(templateDetailForFlags("missing-template", experiments)).toBeNull();
  });

  it("keeps all private recipe properties out of public template data", () => {
    const serialized = JSON.stringify(
      templateDetailForFlags("wedding-portrait-comes-alive", defaults),
    );

    expect(serialized).not.toContain("providerEndpoint");
    expect(serialized).not.toContain("negativePrompt");
    expect(serialized).not.toContain("cfg_scale");
    expect(serialized).not.toContain("providerCostCeilingUsd");
    expect(serialized).not.toContain("Preserve the depicted");
  });

  it("registers and renders a second template without a production recipe", () => {
    const fixture = allRegisteredTemplatesForTests().find(
      (template) => template.id === "single-portrait-gentle-parallax",
    );
    expect(fixture).toBeDefined();
    expect(recipeForTemplate(fixture!.id, fixture!.version)).toBeNull();

    const catalogueHtml = catalogueContent(templatesForFlags(experiments), {
      id: "fixture-user",
      displayName: "Fixture user",
    });
    const detailHtml = templateDetailContent(fixture!, {
      id: "fixture-user",
      displayName: "Fixture user",
    });
    expect(catalogueHtml).toContain("Single portrait gentle parallax");
    expect(detailHtml).toContain("Development fixture only");
    expect(detailHtml).toContain("Try fixture upload");
  });
});
