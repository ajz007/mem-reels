import type { JobStatus } from "./types";

const transitions: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  draft: ["uploaded"],
  uploaded: ["validating", "rejected"],
  validating: ["validated", "rejected"],
  validated: ["awaiting_submit", "rejected"],
  awaiting_submit: ["queued"],
  queued: ["submitting", "failed"],
  submitting: ["generating", "failed"],
  generating: ["storing", "failed"],
  storing: ["completed", "failed"],
  completed: ["deletion_requested"],
  failed: ["deletion_requested"],
  rejected: ["deletion_requested"],
  deletion_requested: ["deleted"],
  deleted: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return transitions[from].includes(to);
}

export function transition(from: JobStatus, to: JobStatus): JobStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid job transition: ${from} -> ${to}`);
  }

  return to;
}
