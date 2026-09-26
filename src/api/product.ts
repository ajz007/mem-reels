import type {
  AccountSummary,
  CheckoutSession,
  GenerationProposal,
  Job,
  TemplateDetail,
  TemplateSummary,
  UserIdentity,
} from "../domain/types";
import type { AnalyticsReasonCode, AnalyticsResultStatus } from "../domain/analytics";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok)
    throw new Error(await responseError(response, `API request failed: ${response.status}`));
  return (await response.json()) as T;
}

export async function fetchSession(): Promise<UserIdentity | null> {
  return (await getJson<{ user: UserIdentity | null }>("/api/auth/me")).user;
}

export async function fetchAccount(): Promise<AccountSummary> {
  return (await getJson<{ account: AccountSummary }>("/api/account")).account;
}

export async function fetchReels(): Promise<Job[]> {
  return (await getJson<{ jobs: Job[] }>("/api/reels")).jobs;
}

export async function createCheckoutSession(packId: string): Promise<CheckoutSession> {
  const response = await fetch("/api/checkout-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ packId }),
  });
  if (!response.ok) throw new Error(await responseError(response, "Could not start checkout."));
  return ((await response.json()) as { checkout: CheckoutSession }).checkout;
}

export async function verifyCheckoutPayment(
  purchaseId: string,
  payment: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string },
): Promise<{ verified: boolean; creditsAdded: boolean }> {
  const response = await fetch("/api/verify-payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ purchaseId, ...payment }),
  });
  if (!response.ok)
    throw new Error(
      await responseError(
        response,
        "Payment could not be verified. Check purchase history before retrying.",
      ),
    );
  return response.json() as Promise<{ verified: boolean; creditsAdded: boolean }>;
}

export async function fetchTemplates(): Promise<readonly TemplateSummary[]> {
  return (await getJson<{ templates: TemplateSummary[] }>("/api/templates")).templates;
}

export async function fetchTemplateDetail(templateId: string): Promise<TemplateDetail> {
  return (
    await getJson<{ template: TemplateDetail }>(`/api/templates/${encodeURIComponent(templateId)}`)
  ).template;
}

export async function createDraft(templateId: string, permissionConfirmed: boolean): Promise<Job> {
  const response = await fetch("/api/jobs/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ templateId, permissionConfirmed }),
  });
  if (!response.ok)
    throw new Error(await responseError(response, "Could not prepare this private upload."));
  return ((await response.json()) as { job: Job }).job;
}

export async function uploadSource(jobId: string, file: File): Promise<Job> {
  const response = await fetch(`/api/jobs/${jobId}/source`, {
    method: "PUT",
    credentials: "same-origin",
    body: file,
  });
  if (!response.ok)
    throw new Error(await responseError(response, "Could not validate the selected photo."));
  return ((await response.json()) as { job: Job }).job;
}

export async function submitFixture(jobId: string): Promise<Job> {
  const response = await fetch(`/api/jobs/${jobId}/submit`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? "Could not submit the local fixture job.");
  }
  return ((await response.json()) as { job: Job }).job;
}

export async function fetchGenerationProposal(jobId: string): Promise<GenerationProposal> {
  return (await getJson<{ proposal: GenerationProposal }>(`/api/jobs/${jobId}/generation-proposal`))
    .proposal;
}

export async function submitLiveGeneration(
  jobId: string,
  proposal: GenerationProposal,
): Promise<Job> {
  const response = await fetch(`/api/jobs/${jobId}/live-submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      proposalId: proposal.id,
      approvedMaximumCostUsd: proposal.estimatedMaximumCostUsd,
    }),
  });
  if (!response.ok)
    throw new Error(await responseError(response, "Could not submit the live job."));
  return ((await response.json()) as { job: Job }).job;
}

export async function fetchStorageHealth(): Promise<{ configured: boolean; accessible: boolean }> {
  return getJson("/api/storage/health");
}

export async function enableLocalLiveSubmission(): Promise<void> {
  const response = await fetch("/api/dev/live-submission", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok)
    throw new Error(await responseError(response, "Could not enable local live testing."));
}

export async function fetchJob(jobId: string): Promise<Job> {
  return (await getJson<{ job: Job }>(`/api/jobs/${jobId}`)).job;
}

export async function resetLocalDemo(): Promise<void> {
  const response = await fetch("/api/dev/reset", { method: "POST", credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not reset the local demo.");
}

export async function deleteJob(jobId: string): Promise<void> {
  const response = await fetch(`/api/jobs/${jobId}?action=delete`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Could not delete this local fixture.");
}

export async function recordInteractionAnalytics(input: {
  name: "template_catalogue_viewed" | "template_selected" | "reel_shared";
  templateId: string;
  templateVersion: number;
  anonymousSessionReference: string;
  jobId?: string;
  resultStatus: AnalyticsResultStatus;
  reasonCode: AnalyticsReasonCode;
}): Promise<void> {
  const response = await fetch("/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Analytics event was not accepted.");
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}
