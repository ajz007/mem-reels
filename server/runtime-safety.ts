const falWebhookPath = "/api/provider-webhooks/fal";

export function falWebhookUrl(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = environment.FAL_WEBHOOK_PUBLIC_URL?.trim();
  if (!configured) return undefined;
  let base: URL;
  try {
    base = new URL(configured);
  } catch {
    throw new Error("FAL_WEBHOOK_PUBLIC_URL must be a valid public HTTPS URL.");
  }
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    isPrivateHost(base.hostname)
  )
    throw new Error("FAL_WEBHOOK_PUBLIC_URL must be a final public HTTPS origin or path.");
  base.pathname = `${base.pathname.replace(/\/+$/, "")}${falWebhookPath}`;
  return base.toString();
}

export function assertJsonStoreIsSafeForRuntime(
  liveSubmissionEnabled: boolean,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV === "production" && liveSubmissionEnabled)
    throw new Error(
      "Paid generation cannot run in production with the local JSON job store. Configure durable transactional persistence first.",
    );
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1" || normalized.startsWith("127."))
    return true;
  if (normalized.startsWith("10.") || normalized.startsWith("192.168.")) return true;
  const match = normalized.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}
