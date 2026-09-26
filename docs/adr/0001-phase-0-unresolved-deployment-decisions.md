# Unresolved deployment decisions for the Phase 0 local prototype

- **Status:** proposed
- **Date:** 2026-08-28
- **Decision owner:** product owner

## Context

Phase 0 is a local fixture-only prototype. Choosing production vendors now would add configuration and operational work without validating the controlled user flow. The application uses ports/adapters so these choices remain reversible.

## Decisions deferred

| Area                             | Current candidate                                                                                                  | Decision needed before |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| Web/API/worker deployment host   | One managed host capable of separate API and worker processes                                                      | Phase 2                |
| Relational database              | Neon Postgres is the leading candidate; another managed Postgres remains possible                                  | Phase 2                |
| Private media storage and region | AWS S3, private bucket, India-friendly latency to be evaluated                                                     | Phase 2                |
| Durable queue                    | SQS, Cloudflare Queues, or equivalent                                                                              | Phase 3                |
| Shared cross-app authentication  | Keep current-app Google OAuth behind `AuthProvider`; extract `auth.yourdomain.com` only when a second app needs it | Phase 1 / second app   |
| Media retention period           | Not set; it must be disclosed before uploads are accepted                                                          | Phase 2                |
| Closed-beta total spend cap      | Must fit inside the INR 25,000 validation budget and reserve a defined amount for model tests                      | Phase 5                |
| Payment provider                 | Razorpay Standard Checkout for one-time INR credit packs                                                           | Selected in Phase 4    |

## Consequences

The local app must not use cloud SDKs, credentials, or real URLs. Later integration should implement a production adapter at each port, rather than change UI/domain code. No paid fal.ai request is permitted until the exact request and maximum cost are shown and explicitly approved.

## Phase 3 reliability addendum

The production datastore and durable queue remain unresolved. Phase 3 therefore does not select Neon, SQS, Cloudflare Queues, or another vendor. The required transactional, uniqueness, outbox, worker-lease, reconciliation, retention and audit guarantees are documented in `docs/generation-routing-reliability.md` and remain behind repository, queue and provider ports.

## Phase 4 payment addendum

Razorpay is selected as the payment provider. This does not resolve the production datastore. Checkout and credit entitlement require the atomic guarantees described in `docs/phase-4-credits-payments-library.md`; production checkout remains disabled until a durable implementation exists.
