# Memory Reels web prototype

This is the local mobile PWA implementation. It is separate from the `phase0/` benchmark harness. It has a same-origin API, private S3 media storage, a server-owned template catalogue, and a review-gated fal.ai generation path.

## Local commands

From `apps/web`:

```powershell
npm install
npm run dev
npm run lint
npm run format
npm test
npm run build
```

Open `http://127.0.0.1:5173`. The demo flow is:

1. Choose **Wedding portrait comes alive**.
2. Review upload guidance.
3. Upload and validate a supported photo.
4. Review the exact live request and its US$0.35 maximum provider cost.
5. Explicitly approve the live request, or run the no-charge fixture path.
6. Follow persisted progress to private MP4 delivery.

`npm run dev` starts both the PWA and its local API. `AUTH_MODE=local` is the default and supplies a deterministic developer identity. To enable a real Google sign-in, first complete [Google OAuth setup](docs/google-oauth-setup.md), then run the API with `AUTH_MODE=google` and the required secrets supplied by your shell or deployment secret manager.

The local API loads server-only configuration from `apps/web/.env`. For a live run, configure `FAL_KEY`, `AWS_REGION`, and `MEMORY_REELS_S3_BUCKET`. Keep `FAL_LIVE_SUBMISSION_ENABLED=false` while reviewing a proposal; setting it to `true` allows the separately confirmed UI action to submit one paid request. Never prefix secrets with `VITE_`.

The application uses typed contracts in `src/domain/ports.ts`. Google OAuth uses state and PKCE, but its in-memory session store remains local-development-only.

Phase 0 product measurement uses a local, privacy-safe event adapter with no external analytics dependency. See [the event catalogue and funnel definitions](docs/product-analytics.md).

Template summaries, detail metadata, lifecycle rules, and server-private generation recipes are documented in [the versioned catalogue guide](docs/template-catalogue.md).

Template-specific compatibility outcomes, deterministic safeguards, provider boundaries, and the no-credit invariant are documented in [the photo validation guide](docs/photo-compatibility-validation.md).

Provider-neutral requests, adapter routing, idempotency, retries, webhook verification, and deferred production persistence requirements are documented in [the generation reliability guide](docs/generation-routing-reliability.md).

Razorpay one-time checkout, append-only credit entitlement, purchase history, and the owner-only My Reels library are documented in [the Phase 4 guide](docs/phase-4-credits-payments-library.md). Tests and fixtures do not execute live payments or paid generation.
