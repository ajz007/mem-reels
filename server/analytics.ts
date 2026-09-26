import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  serializeAnalyticsEvent,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type AnalyticsReasonCode,
  type AnalyticsResultStatus,
  type CreditOutcome,
  type GenerationOutcome,
} from "../src/domain/analytics";
import type { AnalyticsPort } from "../src/domain/ports";
import type { TemplateSummary, UserIdentity } from "../src/domain/types";

export class LocalDevelopmentAnalyticsAdapter implements AnalyticsPort {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly eventPath = join(process.cwd(), ".local-storage", "analytics-events.jsonl"),
  ) {}

  async record(event: AnalyticsEvent): Promise<void> {
    const line = `${serializeAnalyticsEvent(event)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.eventPath), { recursive: true });
      await appendFile(this.eventPath, line, "utf8");
    });
    await this.writeQueue;
  }
}

export interface EventDetails {
  name: AnalyticsEventName;
  user?: UserIdentity | null;
  anonymousSessionReference?: string;
  template: Pick<TemplateSummary, "id" | "version">;
  jobId?: string;
  resultStatus: AnalyticsResultStatus;
  reasonCode?: AnalyticsReasonCode;
  providerCostCeilingUsd?: number;
  generationOutcome?: GenerationOutcome;
  creditOutcome?: CreditOutcome;
}

export function createAnalyticsEvent(details: EventDetails): AnalyticsEvent {
  const subject = details.user
    ? { kind: "user" as const, reference: userReference(details.user.id) }
    : {
        kind: "anonymous_session" as const,
        reference: normalizeAnonymousReference(details.anonymousSessionReference),
      };
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    name: details.name,
    occurredAt: new Date().toISOString(),
    subjectKind: subject.kind,
    subjectReference: subject.reference,
    templateId: details.template.id,
    templateVersion: details.template.version,
    ...(details.jobId ? { jobId: details.jobId } : {}),
    resultStatus: details.resultStatus,
    ...(details.reasonCode ? { reasonCode: details.reasonCode } : {}),
    ...(details.providerCostCeilingUsd !== undefined
      ? { providerCostCeilingUsd: details.providerCostCeilingUsd }
      : {}),
    ...(details.generationOutcome ? { generationOutcome: details.generationOutcome } : {}),
    ...(details.creditOutcome ? { creditOutcome: details.creditOutcome } : {}),
  };
}

function userReference(userId: string): string {
  const salt = process.env.ANALYTICS_REFERENCE_SALT ?? "memory-reels-local-development";
  return `usr_${createHash("sha256").update(`${salt}:${userId}`).digest("hex").slice(0, 24)}`;
}

function normalizeAnonymousReference(value: string | undefined): string {
  if (value && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value)) return `anon_${value}`;
  return `anon_${randomUUID()}`;
}
