import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { AuthService, readCookie, type AuthMode } from "./auth";
import { liveTemplates } from "./catalogue";
import { FalAdapter } from "./fal-adapter";
import { LocalJobService } from "./jobs";
import { InputValidationError } from "./validation";

const port = Number(process.env.API_PORT ?? "8787");
const mode: AuthMode = process.env.AUTH_MODE === "google" ? "google" : "local";
const auth = new AuthService(
  mode,
  mode === "google"
    ? {
        clientId: requireEnvironment("GOOGLE_CLIENT_ID"),
        clientSecret: requireEnvironment("GOOGLE_CLIENT_SECRET"),
        redirectUrl: requireEnvironment("GOOGLE_REDIRECT_URL"),
      }
    : undefined,
);
const fal = new FalAdapter();
const jobs = new LocalJobService(fal);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  try {
    await route(request, response, url);
  } catch (error) {
    if (error instanceof InputValidationError) {
      sendJson(response, 409, { error: { code: error.code, message: error.message } });
      return;
    }
    sendJson(response, 500, {
      error: { code: "server_error", message: "The request could not be completed. Try again." },
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Memory Reels local API listening on http://127.0.0.1:${port} (${mode} auth)`);
});

await jobs.initialize();

async function route(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const sessionId = readCookie(request.headers.cookie, "memory_reels_session");
  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    sendJson(response, 200, { user: auth.currentUser(sessionId) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/auth/google/start") {
    if (mode !== "google") {
      sendJson(response, 409, {
        error: { code: "auth_mode_local", message: "Google login is not enabled locally." },
      });
      return;
    }
    response.writeHead(302, { location: auth.startGoogleLogin() }).end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/auth/google/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      sendJson(response, 400, {
        error: { code: "invalid_callback", message: "Missing sign-in response." },
      });
      return;
    }
    const result = await auth.completeGoogleLogin(code, state);
    response
      .writeHead(302, {
        location: "/#catalogue",
        "set-cookie": sessionCookie(result.sessionId),
      })
      .end();
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    auth.logout(sessionId);
    response.writeHead(204, { "set-cookie": clearSessionCookie() }).end();
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/dev/reset") {
    const user = auth.currentUser(sessionId);
    if (mode !== "local" || !user)
      return sendJson(response, 404, { error: { code: "not_found", message: "Route not found." } });
    await jobs.resetLocalDemo(user);
    response.writeHead(204).end();
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/dev/live-submission") {
    const user = auth.currentUser(sessionId);
    if (mode !== "local" || !user)
      return sendJson(response, 404, {
        error: { code: "not_found", message: "Route not found." },
      });
    fal.enableLocalTestSubmission();
    sendJson(response, 200, { enabled: true });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/templates") {
    sendJson(response, 200, { templates: liveTemplates });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/storage/health") {
    const user = auth.currentUser(sessionId);
    if (!user)
      return sendJson(response, 401, {
        error: { code: "authentication_required", message: "Sign in before checking storage." },
      });
    const status = jobs.storageStatus();
    if (!status.configured)
      return sendJson(response, 200, { configured: false, accessible: false });
    try {
      await jobs.verifyStorage();
      sendJson(response, 200, { configured: true, accessible: true });
    } catch {
      sendJson(response, 200, { configured: true, accessible: false });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/jobs/draft") {
    const user = auth.currentUser(sessionId);
    if (!user)
      return sendJson(response, 401, {
        error: { code: "authentication_required", message: "Sign in before creating a reel." },
      });
    const body = await readJsonBody(request);
    const templateId = typeof body.templateId === "string" ? body.templateId : "";
    const permissionConfirmed = body.permissionConfirmed === true;
    if (!liveTemplates.some((template) => template.id === templateId))
      return sendJson(response, 400, {
        error: { code: "invalid_template", message: "Choose a live template." },
      });
    const job = await jobs.createDraft(user, templateId, permissionConfirmed);
    sendJson(response, 201, { job });
    return;
  }
  const uploadMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/source$/);
  if (request.method === "PUT" && uploadMatch) {
    const user = auth.currentUser(sessionId);
    if (!user)
      return sendJson(response, 401, {
        error: { code: "authentication_required", message: "Sign in before uploading." },
      });
    const job = await jobs.uploadAndValidate(user, uploadMatch[1], await readRawBody(request));
    sendJson(response, 200, { job });
    return;
  }
  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  const proposalMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/generation-proposal$/);
  if (request.method === "GET" && proposalMatch) {
    const user = auth.currentUser(sessionId);
    if (!user)
      return sendJson(response, 401, {
        error: { code: "authentication_required", message: "Sign in before viewing a proposal." },
      });
    sendJson(response, 200, { proposal: await jobs.reviewLive(user, proposalMatch[1]) });
    return;
  }
  const liveSubmitMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/live-submit$/);
  if (request.method === "POST" && liveSubmitMatch) {
    const user = auth.currentUser(sessionId);
    if (!user)
      return sendJson(response, 401, {
        error: { code: "authentication_required", message: "Sign in before submitting." },
      });
    const body = await readJsonBody(request);
    const proposalId = typeof body.proposalId === "string" ? body.proposalId : "";
    const approvedMaximumCostUsd =
      typeof body.approvedMaximumCostUsd === "number" ? body.approvedMaximumCostUsd : Number.NaN;
    sendJson(response, 202, {
      job: await jobs.submitLive(user, liveSubmitMatch[1], proposalId, approvedMaximumCostUsd),
    });
    return;
  }
  const deliveryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/delivery$/);
  if (request.method === "GET" && deliveryMatch) {
    const user = auth.currentUser(sessionId);
    if (!user)
      return sendJson(response, 401, {
        error: { code: "authentication_required", message: "Sign in before downloading." },
      });
    const delivery = await jobs.delivery(user, deliveryMatch[1]);
    const extension = delivery.contentType === "video/mp4" ? "mp4" : "txt";
    const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
    response
      .writeHead(200, {
        "content-type": delivery.contentType,
        "content-disposition": `${disposition}; filename=memory-reel.${extension}`,
        "cache-control": "no-store",
      })
      .end(delivery.body);
    return;
  }
  if (request.method === "GET" && jobMatch) {
    const user = auth.currentUser(sessionId);
    if (!user)
      return sendJson(response, 401, {
        error: { code: "authentication_required", message: "Sign in before viewing a job." },
      });
    sendJson(response, 200, { job: jobs.get(user, jobMatch[1]) });
    return;
  }
  if (request.method === "POST" && jobMatch && url.searchParams.get("action") === "delete") {
    const user = auth.currentUser(sessionId);
    if (!user)
      return sendJson(response, 401, {
        error: { code: "authentication_required", message: "Sign in before deleting." },
      });
    sendJson(response, 200, { job: await jobs.delete(user, jobMatch[1]) });
    return;
  }
  const submitMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/submit$/);
  if (request.method === "POST" && submitMatch) {
    const user = auth.currentUser(sessionId);
    if (!user)
      return sendJson(response, 401, {
        error: { code: "authentication_required", message: "Sign in before submitting." },
      });
    sendJson(response, 202, { job: await jobs.submitFixture(user, submitMatch[1]) });
    return;
  }
  sendJson(response, 404, { error: { code: "not_found", message: "Route not found." } });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sessionCookie(sessionId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `memory_reels_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/${secure}`;
}

function clearSessionCookie(): string {
  return "memory_reels_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when AUTH_MODE=google.`);
  return value;
}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 21 * 1024 * 1024) throw new Error("Upload is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const bytes = await readRawBody(request);
  try {
    return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JSON request body.");
  }
}
