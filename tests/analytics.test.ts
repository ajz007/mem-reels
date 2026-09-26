import { describe, expect, it } from "vitest";

import { createAnalyticsEvent } from "../server/analytics";
import { serializeAnalyticsEvent, type AnalyticsEvent } from "../src/domain/analytics";

const safeEvent: AnalyticsEvent = {
  schemaVersion: 1,
  eventId: "event-123",
  name: "generation_completed",
  occurredAt: "2026-08-31T10:00:00.000Z",
  subjectKind: "user",
  subjectReference: "usr_123456789",
  templateId: "wedding-portrait-comes-alive",
  templateVersion: 1,
  jobId: "job-123",
  resultStatus: "succeeded",
  reasonCode: "delivery_ready",
  providerCostCeilingUsd: 0.35,
  generationOutcome: "provider_succeeded",
  creditOutcome: "consumed",
};

describe("privacy-safe analytics", () => {
  it("serializes the allowlisted event contract", () => {
    expect(JSON.parse(serializeAnalyticsEvent(safeEvent))).toEqual(safeEvent);
  });

  it.each([
    ["imageUrl", "https://private.example/source.png"],
    ["signed_url", "https://private.example/?X-Amz-Credential=secret"],
    ["prompt", "private provider prompt"],
    ["providerCredentials", "secret"],
    ["displayName", "Private Person"],
  ])("rejects prohibited property %s", (property, value) => {
    expect(() => serializeAnalyticsEvent({ ...safeEvent, [property]: value })).toThrow(
      /Prohibited|not allowed/,
    );
  });

  it("rejects unknown fields instead of silently serializing them", () => {
    expect(() =>
      serializeAnalyticsEvent({ ...safeEvent, metadata: { campaign: "unreviewed" } }),
    ).toThrow("not allowed");
  });

  it("uses a pseudonymous user reference and never includes the display name", () => {
    const event = createAnalyticsEvent({
      name: "template_selected",
      user: { id: "user-123", displayName: "Private Person" },
      template: { id: "wedding-portrait-comes-alive", version: 1 },
      resultStatus: "succeeded",
      reasonCode: "template_chosen",
    });
    const serialized = serializeAnalyticsEvent(event);

    expect(event.subjectReference).toMatch(/^usr_[a-f0-9]{24}$/);
    expect(serialized).not.toContain("user-123");
    expect(serialized).not.toContain("Private Person");
  });
});
