import { createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto";

import type { ProviderGenerationResult } from "../src/domain/generation";

interface FalJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
}

export interface FalWebhookHeaders {
  requestId: string;
  userId: string;
  timestamp: string;
  signature: string;
}

export class FalWebhookVerifier {
  private cache: { keys: FalJwk[]; expiresAt: number } | null = null;

  constructor(
    private readonly loadKeys: () => Promise<FalJwk[]> = loadFalJwks,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async verify(headers: FalWebhookHeaders, rawBody: Buffer): Promise<boolean> {
    const timestamp = Number(headers.timestamp);
    if (!Number.isSafeInteger(timestamp) || Math.abs(this.now() / 1000 - timestamp) > 300)
      return false;
    if (!/^[0-9a-f]+$/i.test(headers.signature) || headers.signature.length % 2 !== 0) return false;
    const bodyHash = createHash("sha256").update(rawBody).digest("hex");
    const message = Buffer.from(
      [headers.requestId, headers.userId, headers.timestamp, bodyHash].join("\n"),
      "utf8",
    );
    const keys = await this.keys();
    return keys.some((jwk) => {
      try {
        return verify(
          null,
          message,
          createPublicKey({ key: jwk as JsonWebKey, format: "jwk" }),
          Buffer.from(headers.signature, "hex"),
        );
      } catch {
        return false;
      }
    });
  }

  private async keys(): Promise<FalJwk[]> {
    if (this.cache && this.cache.expiresAt > this.now()) return this.cache.keys;
    const keys = await this.loadKeys();
    this.cache = { keys, expiresAt: this.now() + 24 * 60 * 60 * 1000 };
    return keys;
  }
}

export function parseFalWebhook(rawBody: Buffer): ProviderGenerationResult | null {
  try {
    const body = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    if (typeof body.request_id !== "string") return null;
    if (body.status === "ERROR")
      return {
        state: "failed",
        requestId: body.request_id,
        nonSensitiveReasonCode: "provider_failed",
      };
    if (body.status === "OK" && body.payload === null && typeof body.payload_error === "string")
      return {
        state: "reconciliation_required",
        requestId: body.request_id,
        nonSensitiveReasonCode: "payload_unavailable",
      };
    const payload = body.payload as { video?: { url?: unknown } } | null;
    const videoUrl = payload?.video?.url;
    if (body.status !== "OK" || typeof videoUrl !== "string" || !videoUrl.startsWith("https://"))
      return {
        state: "failed",
        requestId: body.request_id,
        nonSensitiveReasonCode: "invalid_provider_output",
      };
    return { state: "completed", requestId: body.request_id, videoUrl };
  } catch {
    return null;
  }
}

async function loadFalJwks(): Promise<FalJwk[]> {
  const response = await fetch("https://rest.fal.ai/.well-known/jwks.json", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("fal.ai webhook keys are unavailable.");
  const body = (await response.json()) as { keys?: FalJwk[] };
  return (body.keys ?? []).filter(
    (key) => key.kty === "OKP" && key.crv === "Ed25519" && typeof key.x === "string",
  );
}
