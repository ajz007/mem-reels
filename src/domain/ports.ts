import type { GenerationAttempt, Job, SafeError, UserIdentity } from "./types";
import type { AnalyticsEvent } from "./analytics";
import type { VisionCompatibilityObservations, VisionCompatibilityRequest } from "./validation";

export interface AnalyticsPort {
  record(event: AnalyticsEvent): Promise<void>;
}

export interface VisionCompatibilityProvider {
  readonly sendsImageToExternalProvider: boolean;
  analyze(
    request: VisionCompatibilityRequest,
  ): Promise<
    | { status: "completed"; observations: VisionCompatibilityObservations }
    | { status: "unavailable" }
    | { status: "malformed" }
  >;
}

export interface AuthProvider {
  getCurrentUser(): Promise<UserIdentity | null>;
}

export interface ObjectStorage {
  createUploadTarget(jobId: string): Promise<{ objectKey: string; uploadUrl: string }>;
  createDownloadTarget(jobId: string): Promise<{ downloadUrl: string }>;
}

export interface JobRepository {
  getById(jobId: string): Promise<Job | null>;
  save(job: Job): Promise<Job>;
}

export interface JobQueue {
  enqueue(jobId: string): Promise<void>;
}

export interface GenerationProvider {
  generateFixture(job: Job): Promise<GenerationAttempt | SafeError>;
}
