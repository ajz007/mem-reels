export const analyticsEventNames = [
  "template_catalogue_viewed",
  "template_selected",
  "photo_upload_started",
  "photo_upload_completed",
  "photo_validation_completed",
  "generation_proposal_reviewed",
  "generation_cost_approved",
  "generation_submitted",
  "generation_completed",
  "generation_failed",
  "reel_downloaded",
  "reel_shared",
] as const;

export type AnalyticsEventName = (typeof analyticsEventNames)[number];

export const analyticsResultStatuses = [
  "started",
  "succeeded",
  "failed",
  "rejected",
  "cancelled",
] as const;

export type AnalyticsResultStatus = (typeof analyticsResultStatuses)[number];

export const analyticsReasonCodes = [
  "catalogue_opened",
  "template_chosen",
  "upload_received",
  "validation_passed",
  "invalid_image_source",
  "unsupported_file",
  "unsupported_photo",
  "proposal_ready",
  "cost_approved",
  "fixture_mode",
  "provider_accepted",
  "provider_rejected",
  "technical_failure",
  "delivery_ready",
  "download_requested",
  "share_completed",
  "share_cancelled",
  "share_failed",
] as const;

export type AnalyticsReasonCode = (typeof analyticsReasonCodes)[number];

export type GenerationOutcome =
  | "not_started"
  | "fixture_succeeded"
  | "provider_submitted"
  | "provider_succeeded"
  | "provider_failed";

export type CreditOutcome =
  "not_applicable" | "not_reserved" | "reserved" | "consumed" | "restored";

export interface AnalyticsEvent {
  schemaVersion: 1;
  eventId: string;
  name: AnalyticsEventName;
  occurredAt: string;
  subjectKind: "anonymous_session" | "user";
  subjectReference: string;
  templateId: string;
  templateVersion: number;
  jobId?: string;
  resultStatus: AnalyticsResultStatus;
  reasonCode?: AnalyticsReasonCode;
  providerCostCeilingUsd?: number;
  generationOutcome?: GenerationOutcome;
  creditOutcome?: CreditOutcome;
}

const allowedKeys = new Set<keyof AnalyticsEvent>([
  "schemaVersion",
  "eventId",
  "name",
  "occurredAt",
  "subjectKind",
  "subjectReference",
  "templateId",
  "templateVersion",
  "jobId",
  "resultStatus",
  "reasonCode",
  "providerCostCeilingUsd",
  "generationOutcome",
  "creditOutcome",
]);

const prohibitedKeyFragments = [
  "imageurl",
  "signedurl",
  "downloadurl",
  "uploadurl",
  "prompt",
  "credential",
  "displayname",
  "providerkey",
  "secret",
  "accesstoken",
  "refreshtoken",
] as const;

const generationOutcomes: readonly GenerationOutcome[] = [
  "not_started",
  "fixture_succeeded",
  "provider_submitted",
  "provider_succeeded",
  "provider_failed",
];
const creditOutcomes: readonly CreditOutcome[] = [
  "not_applicable",
  "not_reserved",
  "reserved",
  "consumed",
  "restored",
];

/** Runtime privacy boundary: only this function may serialize an analytics event. */
export function serializeAnalyticsEvent(candidate: unknown): string {
  if (!isPlainObject(candidate)) throw new Error("Analytics event must be an object.");
  assertNoProhibitedKeys(candidate);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key as keyof AnalyticsEvent))
      throw new Error(`Analytics property is not allowed: ${key}`);
  }

  assertEqual(candidate.schemaVersion, 1, "schemaVersion");
  assertSafeIdentifier(candidate.eventId, "eventId");
  assertMember(candidate.name, analyticsEventNames, "name");
  assertIsoTimestamp(candidate.occurredAt);
  assertMember(candidate.subjectKind, ["anonymous_session", "user"] as const, "subjectKind");
  assertSafeIdentifier(candidate.subjectReference, "subjectReference");
  assertSafeIdentifier(candidate.templateId, "templateId");
  if (!Number.isSafeInteger(candidate.templateVersion) || Number(candidate.templateVersion) < 1)
    throw new Error("Analytics templateVersion must be a positive integer.");
  if (candidate.jobId !== undefined) assertSafeIdentifier(candidate.jobId, "jobId");
  assertMember(candidate.resultStatus, analyticsResultStatuses, "resultStatus");
  if (candidate.reasonCode !== undefined)
    assertMember(candidate.reasonCode, analyticsReasonCodes, "reasonCode");
  if (candidate.providerCostCeilingUsd !== undefined) {
    if (
      typeof candidate.providerCostCeilingUsd !== "number" ||
      !Number.isFinite(candidate.providerCostCeilingUsd) ||
      candidate.providerCostCeilingUsd < 0 ||
      candidate.providerCostCeilingUsd > 100
    )
      throw new Error("Analytics provider cost ceiling is invalid.");
  }
  if (candidate.generationOutcome !== undefined)
    assertMember(candidate.generationOutcome, generationOutcomes, "generationOutcome");
  if (candidate.creditOutcome !== undefined)
    assertMember(candidate.creditOutcome, creditOutcomes, "creditOutcome");

  return JSON.stringify(candidate);
}

function assertNoProhibitedKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoProhibitedKeys);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (prohibitedKeyFragments.some((fragment) => normalized.includes(fragment)))
      throw new Error(`Prohibited analytics property: ${key}`);
    assertNoProhibitedKeys(child);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafeIdentifier(value: unknown, property: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new Error(`Analytics ${property} is invalid.`);
}

function assertIsoTimestamp(value: unknown): asserts value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    throw new Error("Analytics occurredAt must be an ISO timestamp.");
}

function assertEqual(value: unknown, expected: unknown, property: string): void {
  if (value !== expected) throw new Error(`Analytics ${property} is invalid.`);
}

function assertMember<T extends string>(
  value: unknown,
  options: readonly T[],
  property: string,
): asserts value is T {
  if (typeof value !== "string" || !options.includes(value as T))
    throw new Error(`Analytics ${property} is invalid.`);
}
