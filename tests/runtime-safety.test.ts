import { describe, expect, it } from "vitest";

import { assertJsonStoreIsSafeForRuntime, falWebhookUrl } from "../server/runtime-safety";

describe("paid-generation runtime safety", () => {
  it("normalizes a final public webhook URL", () => {
    expect(falWebhookUrl({ FAL_WEBHOOK_PUBLIC_URL: "https://reels.example.com/hooks/" })).toBe(
      "https://reels.example.com/hooks/api/provider-webhooks/fal",
    );
  });

  it.each([
    "http://reels.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://192.168.1.2",
    "not a url",
  ])("rejects unsafe webhook base %s", (url) => {
    expect(() => falWebhookUrl({ FAL_WEBHOOK_PUBLIC_URL: url })).toThrow();
  });

  it("blocks paid production startup with the JSON job store", () => {
    expect(() => assertJsonStoreIsSafeForRuntime(true, { NODE_ENV: "production" })).toThrow(
      "durable transactional persistence",
    );
    expect(() => assertJsonStoreIsSafeForRuntime(false, { NODE_ENV: "production" })).not.toThrow();
    expect(() => assertJsonStoreIsSafeForRuntime(true, { NODE_ENV: "development" })).not.toThrow();
  });
});
