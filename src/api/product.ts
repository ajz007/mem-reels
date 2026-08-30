import type { GenerationProposal, Job, Template, UserIdentity } from "../domain/types";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok)
    throw new Error(await responseError(response, `API request failed: ${response.status}`));
  return (await response.json()) as T;
}

export async function fetchSession(): Promise<UserIdentity | null> {
  return (await getJson<{ user: UserIdentity | null }>("/api/auth/me")).user;
}

export async function fetchTemplates(): Promise<readonly Template[]> {
  return (await getJson<{ templates: Template[] }>("/api/templates")).templates;
}

export async function createDraft(templateId: string, permissionConfirmed: boolean): Promise<Job> {
  const response = await fetch("/api/jobs/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ templateId, permissionConfirmed }),
  });
  if (!response.ok) throw new Error("Could not create the local upload draft.");
  return ((await response.json()) as { job: Job }).job;
}

export async function uploadSource(jobId: string, file: File): Promise<Job> {
  const response = await fetch(`/api/jobs/${jobId}/source`, {
    method: "PUT",
    credentials: "same-origin",
    body: file,
  });
  if (!response.ok) throw new Error("Could not validate the selected file.");
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

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}
