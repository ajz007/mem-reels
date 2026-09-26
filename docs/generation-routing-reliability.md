# Generation routing and job reliability

Phase 3 keeps generation recipes, prompts, signed media URLs, provider endpoints and credentials on the server. Public proposals expose only the approved output format, audio mode, credit price and maximum provider-price ceiling.

## Routing

Each template version resolves to one immutable recipe version. The recipe names a versioned adapter key and one request shape: image-to-video, start/end-frame video, or reference-video motion control. Audio is declared as none, optional generated audio, or required generated audio. Only the wedding recipe is production-approved; the other shapes are deterministic fixtures.

The Kling 2.5 wedding builder preserves the existing endpoint and input fields. Adding a model requires a new recipe version and registered adapter, not a conditional in job logic.

## Approval integrity

The proposal hash covers the job ID, template ID/version, recipe version, validation policy version and result snapshot, credit cost, and maximum provider price. Any change requires a fresh user approval. Prompts, provider parameters and signed URLs are excluded from the public proposal.

## Idempotency and retries

- Concurrent submissions for one job share one in-process submission lock.
- A repeated submission using the accepted proposal returns the existing job and cannot reserve another credit or create another provider request.
- Provider request IDs and timestamped state transitions are persisted before background reconciliation.
- A failed attempt releases its own reservation at most once.
- Only a failure proven to happen before a provider request ID is issued is retryable, for at most three attempts.
- A timeout after provider acceptance is reconciled using the existing request ID. It is never automatically resubmitted.
- Completion callbacks are idempotent by provider request ID.
- Webhook and polling outcomes pass through one serialized terminal settlement path, including credit changes.
- Provider connectivity failures and successful webhooks with unavailable payloads remain queued for reconciliation rather than restoring credit prematurely.

## Webhooks

When `FAL_WEBHOOK_PUBLIC_URL` is configured, queue submission includes the final HTTPS callback URL. The callback verifies fal.ai's ED25519 signature against its JWKS, caches keys for no more than 24 hours, checks the required four headers, hashes the raw request bytes, and enforces the documented five-minute timestamp window. Polling remains the local-development and recovery fallback.

The webhook base must be a public HTTPS URL and is normalized to the final callback path. Polling uses a bounded 15-minute wait by default; `FAL_POLL_TIMEOUT_MS` may set a value from 30 seconds to 30 minutes. Exceeding the wait moves the job to reconciliation—it does not fail the generation or restore credit.

## Deferred production infrastructure

The deployment ADR still leaves the database, worker host and durable queue unresolved. Before production, the selected implementations must provide:

- transactional compare-and-set on job status and proposal ID;
- a unique constraint on `(job_id, proposal_id)` or the idempotency key;
- a unique credit-ledger operation per attempt and operation type;
- durable outbox/queue delivery after the job transaction commits;
- worker leases, retry counts, visibility timeouts and dead-letter handling;
- indexed lookup by provider adapter key and provider request ID;
- encrypted private media references with retention deletion;
- webhook replay protection and operational reconciliation for missed callbacks;
- audit retention for non-sensitive transitions and cost outcomes.

The current JSON adapter is deterministic local persistence, not a claim of multi-process transactional safety. These requirements remain behind repository, storage, queue and provider boundaries until hosting is selected.

As a guardrail, the server refuses to start paid generation in `NODE_ENV=production` while this JSON store is active, and the local live-submission switch enforces the same check.
