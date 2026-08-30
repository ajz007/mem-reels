import type { GenerationAttempt, Job, SafeError, UserIdentity } from "./types";

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
