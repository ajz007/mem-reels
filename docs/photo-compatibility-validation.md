# Explainable photo compatibility validation

Memory Reels validates every source before proposal review, generation submission, or credit reservation. The stored result is tied to the selected template ID/version and the exact validation policy version.

## Decision model

The engine returns one of three outcomes:

- `ready`: every deterministic and available template-specific rule passed.
- `ready_with_warnings`: technical safety checks passed, but one or more correctable risks exist or advanced observations were unavailable or malformed.
- `not_suitable`: a hard technical or template-specific requirement failed.

Every evaluated rule contains a stable reason code, `pass`, `warning`, or `failure`, a user-facing explanation, and a suggested correction. The client renders these stored rule results and does not recreate the decision.

## Deterministic safety checks

The existing checks remain authoritative and blocking:

1. File size is non-zero and at most the policy limit.
2. The byte signature is a genuine JPEG, PNG, or WebP signature.
3. Sharp fully decodes the image and confirms the decoded format matches the signature.
4. Width and height meet the policy minimum.
5. Total pixel count stays below the decompression-safety ceiling.

The normalized image is persisted privately only after it decodes safely. A technical hard failure never calls a vision provider.

## Template-specific observations

`VisionCompatibilityProvider` supplies structured observations for subject count, visible faces, edge clipping, crop suitability, framing, blur, exposure, and occlusion. The validation engine runtime-validates the complete response and then applies deterministic thresholds from the versioned template policy.

The provider cannot return `ready` or `not_suitable`. It supplies observations only; Memory Reels owns the final rule evaluation. Unavailable, thrown, or malformed provider results become explicit warnings and cannot approve or reject a photo by themselves.

## Provider and privacy behavior

Phase 2 includes:

- `DeterministicVisionCompatibilityAdapter` for fixtures and tests.
- `UnavailableVisionCompatibilityAdapter` as the application default.

No fal.ai or other external vision adapter is enabled. No image leaves private application storage for compatibility analysis in this phase. The UI states when advanced checks were unavailable and confirms that no external provider received the image.

If an external adapter is added later, it must:

1. remain disabled by default;
2. use server-only credentials;
3. expose an explicit `sendsImageToExternalProvider` capability;
4. be disclosed before upload or transmission;
5. return the structured observation contract; and
6. remain subordinate to deterministic policy rules.

## Snapshot and credit invariant

Jobs persist `validationPolicyVersion` and the complete safe `validationResult` snapshot. Proposal review, fixture submission, and live submission reject jobs when:

- no snapshot exists;
- the policy version differs from the current template policy; or
- the outcome is `not_suitable`.

Draft creation may grant the local beta balance, but validation creates no `reserve`, `consume`, or `release` ledger entry. Credit reservation still occurs only inside the separately approved live submission path after the snapshot is rechecked.
