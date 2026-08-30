import type { Template } from "../src/domain/types";

export const liveTemplates: readonly Template[] = [
  {
    id: "wedding-portrait-comes-alive",
    version: 1,
    title: "Wedding portrait comes alive",
    description: "A warm expression, subtle fabric movement, and a gentle cinematic push-in.",
    durationSeconds: 5,
    aspectRatio: "9:16",
    slotCount: 2,
    creditCost: 1,
    eligibilityRules: [
      "One or two adults with clearly visible faces",
      "A clear posed wedding or anniversary portrait",
      "Enough room around both people for a vertical frame",
    ],
    unsupportedRules: [
      "Group photos or people at the edge of the frame",
      "Damaged or partially decoded scans",
      "Kissing, dancing, speaking, or large movements",
    ],
  },
];
