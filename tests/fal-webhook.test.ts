import { createHash, generateKeyPairSync, sign, type JsonWebKey } from "node:crypto";

import { describe, expect, it } from "vitest";

import { FalWebhookVerifier, parseFalWebhook } from "../server/fal-webhook";

describe("fal webhook handling", () => {
  it("verifies the official ED25519 message shape and rejects stale timestamps", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey & {
      kty: "OKP";
      crv: "Ed25519";
      x: string;
    };
    const body = Buffer.from(
      JSON.stringify({
        request_id: "request-1",
        status: "OK",
        payload: { video: { url: "https://fixture.invalid/out.mp4" } },
      }),
    );
    const timestamp = "1788300000";
    const message = Buffer.from(
      ["request-1", "user-1", timestamp, createHash("sha256").update(body).digest("hex")].join(
        "\n",
      ),
    );
    const signature = sign(null, message, privateKey).toString("hex");
    const verifier = new FalWebhookVerifier(
      async () => [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x }],
      () => Number(timestamp) * 1000,
    );
    await expect(
      verifier.verify({ requestId: "request-1", userId: "user-1", timestamp, signature }, body),
    ).resolves.toBe(true);
    const stale = new FalWebhookVerifier(
      async () => [jwk],
      () => (Number(timestamp) + 301) * 1000,
    );
    await expect(
      stale.verify({ requestId: "request-1", userId: "user-1", timestamp, signature }, body),
    ).resolves.toBe(false);
  });

  it("parses success, provider errors and malformed output without exposing payload internals", () => {
    expect(
      parseFalWebhook(
        Buffer.from(
          JSON.stringify({
            request_id: "one",
            status: "OK",
            payload: { video: { url: "https://fixture.invalid/out.mp4" } },
          }),
        ),
      ),
    ).toMatchObject({ state: "completed", requestId: "one" });
    expect(
      parseFalWebhook(
        Buffer.from(
          JSON.stringify({ request_id: "two", status: "ERROR", error: "secret provider detail" }),
        ),
      ),
    ).toEqual({ state: "failed", requestId: "two", nonSensitiveReasonCode: "provider_failed" });
    expect(parseFalWebhook(Buffer.from("not-json"))).toBeNull();
    expect(
      parseFalWebhook(
        Buffer.from(
          JSON.stringify({
            request_id: "three",
            status: "OK",
            payload: null,
            payload_error: "provider serialization detail",
          }),
        ),
      ),
    ).toEqual({
      state: "reconciliation_required",
      requestId: "three",
      nonSensitiveReasonCode: "payload_unavailable",
    });
  });
});
