# Privacy-safe product measurement

Memory Reels records a versioned, allowlist-only funnel contract. Events contain identifiers and controlled enums, never user content. The local development adapter writes newline-delimited JSON to `.local-storage/analytics-events.jsonl`. No third-party analytics library or network service is used.

## Common properties

| Property                        | Meaning                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `schemaVersion`                 | Event contract version; currently `1`                                   |
| `eventId`                       | Unique event identifier                                                 |
| `name`                          | Stable event name from the table below                                  |
| `occurredAt`                    | Server-authored ISO timestamp                                           |
| `subjectKind`                   | `anonymous_session` or `user`                                           |
| `subjectReference`              | Session reference or salted, one-way user reference                     |
| `templateId`, `templateVersion` | Public template identity and version                                    |
| `jobId`                         | Present after a job exists                                              |
| `resultStatus`                  | `started`, `succeeded`, `failed`, `rejected`, or `cancelled`            |
| `reasonCode`                    | Controlled non-sensitive explanation code                               |
| `providerCostCeilingUsd`        | Maximum approved provider cost; zero for fixtures                       |
| `generationOutcome`             | Controlled fixture/provider outcome                                     |
| `creditOutcome`                 | `not_applicable`, `not_reserved`, `reserved`, `consumed`, or `restored` |

The serializer rejects unknown properties and prohibited key families, including image and signed URLs, prompts, provider credentials, display names, secrets, and access tokens. Values are restricted to enums, bounded numbers, timestamps, and identifier-safe strings.

## Event catalogue

| Event                          | Source                      | Definition                                                     |
| ------------------------------ | --------------------------- | -------------------------------------------------------------- |
| `template_catalogue_viewed`    | Client interaction endpoint | Catalogue first viewed in a browser session                    |
| `template_selected`            | Client interaction endpoint | User chooses a template and enters upload                      |
| `photo_upload_started`         | Server                      | Authenticated upload accepted for processing                   |
| `photo_upload_completed`       | Server                      | Upload bytes processed by the private upload flow              |
| `photo_validation_completed`   | Server                      | Hard image validation accepted or rejected the source          |
| `generation_proposal_reviewed` | Server                      | Exact provider proposal and cost ceiling prepared              |
| `generation_cost_approved`     | Server                      | Matching live proposal and ceiling explicitly approved         |
| `generation_submitted`         | Server                      | Fixture queued or provider accepted the live request           |
| `generation_completed`         | Server worker               | Fixture or provider result reached private delivery            |
| `generation_failed`            | Server worker               | Provider submission/generation failed; includes credit outcome |
| `reel_downloaded`              | Server                      | Completed delivery requested with download disposition         |
| `reel_shared`                  | Client interaction endpoint | Native share completed, was cancelled, or failed               |

Client events are intentionally limited to discovery and native-share interactions. Upload, cost, generation, credit, and delivery events are server-authored so the business funnel cannot be changed by browser payloads.

## Funnel definitions

- **Discovery to intent:** unique subjects with `template_selected / template_catalogue_viewed`.
- **Upload completion:** unique jobs with `photo_upload_completed / photo_upload_started`.
- **Validation acceptance:** jobs where `photo_validation_completed.resultStatus = succeeded / all photo_validation_completed`.
- **Proposal conversion:** jobs with `generation_proposal_reviewed / successful photo_validation_completed`.
- **Approved live conversion:** jobs with `generation_cost_approved / generation_proposal_reviewed`. Fixture submissions are excluded.
- **Submission success:** jobs with successful `generation_submitted / generation_cost_approved` for live generation, or by `reasonCode = fixture_mode` for fixtures.
- **Successful-result rate:** jobs with `generation_completed / generation_submitted`.
- **Cost ceiling per successful provider result:** sum of `providerCostCeilingUsd` on provider `generation_completed` events divided by successful provider results. This is a conservative ceiling metric, not final invoiced cost; actual billing reconciliation is outside Phase 0.
- **Credit protection:** failed provider jobs with `creditOutcome = restored / generation_failed`.
- **Delivery engagement:** unique completed jobs with `reel_downloaded` or successful `reel_shared / generation_completed`.

Use `eventId` for ingestion deduplication and `jobId` for job-level funnel analysis. A retry may create more than one lifecycle event in future phases, so count distinct jobs unless diagnosing attempts.

## Server feature flags

| Environment variable                  | Values                   | Default    | Purpose                                                            |
| ------------------------------------- | ------------------------ | ---------- | ------------------------------------------------------------------ |
| `MEMORY_REELS_EXPERIMENTAL_TEMPLATES` | `true` or unset          | `false`    | Controls whether server-declared experimental templates can appear |
| `MEMORY_REELS_VALIDATION_MODE`        | `blocking` or `advisory` | `blocking` | Reserves the behavior mode for future soft compatibility checks    |

Hard security and file-integrity validation always remains blocking. The advisory value is a foundation for future template-fit warnings and does not bypass corrupt-file, format, size, consent, or storage checks.
