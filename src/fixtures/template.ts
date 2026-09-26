import type { TemplateDetail, TemplateSummary } from "../domain/types";

export const weddingPortraitTemplate: TemplateDetail = {
  id: "wedding-portrait-comes-alive",
  version: 1,
  title: "Wedding portrait comes alive",
  description: "A warm expression, subtle fabric movement, and a gentle cinematic push-in.",
  category: "Wedding memories",
  tags: ["wedding", "couples", "portrait"],
  collection: "Celebrate together",
  poster: {
    url: "/wedding-portrait-preview.webp",
    alt: "Fictional couple shown as an example wedding portrait",
  },
  sampleVideo: {
    posterUrl: "/wedding-portrait-preview.webp",
    alt: "Preview poster for the wedding portrait reel",
    label: "Approved sample video coming soon",
    availability: "preview_pending",
  },
  exampleSource: {
    url: "/wedding-portrait-preview.webp",
    alt: "Fictional example of a clear wedding portrait source",
  },
  requiredInputCount: 1,
  inputGuidance: {
    title: "One clear wedding portrait",
    description: "Choose a posed photo with one or two adults and enough room around them.",
    requirements: [
      "JPEG, PNG or WebP up to 20 MB",
      "At least 320 pixels on each side",
      "Permission from everyone shown",
    ],
  },
  output: {
    durationSeconds: 5,
    aspectRatio: "9:16",
    resolution: { width: 1080, height: 1920, label: "1080 × 1920 vertical" },
  },
  creditPrice: 1,
  costDescription: "1 beta credit · exact live cost shown before approval",
  eligibilityConditions: [
    "One or two adults with clearly visible faces",
    "A clear posed wedding or anniversary portrait",
    "Enough room around both people for a vertical frame",
  ],
  unsupportedConditions: [
    "Group photos or people at the edge of the frame",
    "Damaged or partially decoded scans",
    "Kissing, dancing, speaking, or large movements",
  ],
  privacyDescription:
    "Your source and finished reel stay private. Nothing is sent for paid generation until you review the request and approve its maximum cost.",
  status: "active",
  generationAvailability: "paid_approved",
};

export const developmentParallaxTemplate: TemplateDetail = {
  ...weddingPortraitTemplate,
  id: "single-portrait-gentle-parallax",
  version: 1,
  title: "Single portrait gentle parallax",
  description: "A development fixture used to prove the catalogue can grow safely.",
  category: "Portrait memories",
  tags: ["portrait", "fixture"],
  collection: "Development previews",
  costDescription: "Free development fixture · paid generation unavailable",
  inputGuidance: {
    ...weddingPortraitTemplate.inputGuidance,
    title: "One clear individual portrait",
    description: "This fixture validates catalogue and upload behavior only.",
  },
  status: "experimental",
  generationAvailability: "fixture_only",
};

export function toTemplateSummary(template: TemplateDetail): TemplateSummary {
  return {
    id: template.id,
    version: template.version,
    title: template.title,
    description: template.description,
    category: template.category,
    tags: template.tags,
    collection: template.collection,
    poster: template.poster,
    sampleVideo: template.sampleVideo,
    requiredInputCount: template.requiredInputCount,
    output: template.output,
    creditPrice: template.creditPrice,
    costDescription: template.costDescription,
    status: template.status,
    generationAvailability: template.generationAvailability,
  };
}
