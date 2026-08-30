import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { UserIdentity } from "../src/domain/types";

export type AuthMode = "local" | "google";

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

interface OAuthRequest {
  codeVerifier: string;
  createdAt: number;
}

export class AuthService {
  private readonly sessions = new Map<string, UserIdentity>();
  private readonly pending = new Map<string, OAuthRequest>();

  constructor(
    private readonly mode: AuthMode,
    private readonly google?: GoogleAuthConfig,
  ) {}

  currentUser(sessionId: string | undefined): UserIdentity | null {
    if (this.mode === "local") {
      return { id: "local:memory-reels-preview", displayName: "Local preview" };
    }

    return sessionId ? (this.sessions.get(sessionId) ?? null) : null;
  }

  startGoogleLogin(): string {
    if (this.mode !== "google" || !this.google) {
      throw new Error("Google authentication is not configured.");
    }

    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    this.pending.set(state, { codeVerifier, createdAt: Date.now() });
    this.removeExpiredRequests();

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.google.clientId,
      redirect_uri: this.google.redirectUrl,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return url.toString();
  }

  async completeGoogleLogin(
    code: string,
    state: string,
  ): Promise<{ sessionId: string; user: UserIdentity }> {
    if (this.mode !== "google" || !this.google) {
      throw new Error("Google authentication is not configured.");
    }

    const request = this.pending.get(state);
    this.pending.delete(state);
    if (!request || Date.now() - request.createdAt > 10 * 60 * 1000) {
      throw new Error("This sign-in request expired. Please try again.");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.google.clientId,
        client_secret: this.google.clientSecret,
        redirect_uri: this.google.redirectUrl,
        grant_type: "authorization_code",
        code_verifier: request.codeVerifier,
      }),
    });
    if (!tokenResponse.ok) {
      throw new Error("Google could not complete sign-in. Please try again.");
    }
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) {
      throw new Error("Google did not return an access token.");
    }

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!profileResponse.ok) {
      throw new Error("Google profile lookup failed. Please try again.");
    }
    const profile = (await profileResponse.json()) as {
      sub?: string;
      name?: string;
      email?: string;
    };
    if (!profile.sub) {
      throw new Error("Google did not return a stable user identity.");
    }

    const user = {
      id: `google:${profile.sub}`,
      displayName: profile.name ?? profile.email ?? "Memory Reels user",
    };
    const sessionId = randomUUID();
    this.sessions.set(sessionId, user);
    return { sessionId, user };
  }

  logout(sessionId: string | undefined): void {
    if (sessionId) this.sessions.delete(sessionId);
  }

  private removeExpiredRequests(): void {
    const expiry = Date.now() - 10 * 60 * 1000;
    for (const [state, request] of this.pending) {
      if (request.createdAt < expiry) this.pending.delete(state);
    }
  }
}

export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  return cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
