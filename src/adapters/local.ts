import type {
  AuthProvider,
  GenerationProvider,
  JobQueue,
  JobRepository,
  ObjectStorage,
} from "../domain/ports";
import type { GenerationAttempt, Job, SafeError, UserIdentity } from "../domain/types";

export class LocalAuthProvider implements AuthProvider {
  async getCurrentUser(): Promise<UserIdentity> {
    return { id: "local-fixture-user", displayName: "Local preview" };
  }
}

export class LocalObjectStorage implements ObjectStorage {
  async createUploadTarget(jobId: string): Promise<{ objectKey: string; uploadUrl: string }> {
    return { objectKey: `local/${jobId}/source`, uploadUrl: "local://fixture-upload" };
  }

  async createDownloadTarget(): Promise<{ downloadUrl: string }> {
    return { downloadUrl: "#fixture-download" };
  }
}

export class LocalJobRepository implements JobRepository {
  private readonly jobs = new Map<string, Job>();

  async getById(jobId: string): Promise<Job | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async save(job: Job): Promise<Job> {
    this.jobs.set(job.id, job);
    return job;
  }
}

export class LocalJobQueue implements JobQueue {
  readonly enqueuedJobIds: string[] = [];

  async enqueue(jobId: string): Promise<void> {
    this.enqueuedJobIds.push(jobId);
  }
}

export class LocalGenerationProvider implements GenerationProvider {
  async generateFixture(job: Job): Promise<GenerationAttempt | SafeError> {
    return {
      id: `fixture-attempt-${job.id}`,
      jobId: job.id,
      attemptNumber: 1,
      status: "fixture_completed",
      provider: "local-fixture",
      promptTemplateVersion: "not-configured-in-phase-0",
    };
  }
}
