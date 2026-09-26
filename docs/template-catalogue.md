# Versioned template catalogue

Memory Reels separates public product content from private generation instructions.

## Public contracts

- `TemplateSummary` powers catalogue collections and contains identity, merchandising metadata, media previews, output format, price copy, status, and generation availability.
- `TemplateDetail` extends the summary with the example source, input requirements, compatibility guidance, and privacy explanation.
- `GET /api/templates` returns summaries for active templates plus experimental templates only when the server flag is enabled.
- `GET /api/templates/:id` returns one permitted detail. Missing, draft, retired, and flag-disabled experimental templates return a generic unavailable response.

Neither public response contains a provider endpoint, model identifier, prompt, negative prompt, provider parameters, validation policy, or provider cost ceiling.

## Private recipe

`server/template-recipes.ts` is the server-only recipe registry. A `TemplateRecipe` contains the provider endpoint, prompt and negative prompt, provider parameters, validation policy, recipe version, and provider cost ceiling.

The wedding recipe preserves the existing Kling 2.5 Turbo Pro request: five-second duration, `cfg_scale` 0.5, and the existing prompt/negative prompt. The proposal API exposes only user-reviewable output and cost information. At submission, the server combines the private recipe with a short-lived private source URL.

## Status and paid-generation rules

| Status         | Public catalogue      | Detail API            | Job creation                                       |
| -------------- | --------------------- | --------------------- | -------------------------------------------------- |
| `draft`        | Never                 | Never                 | Rejected                                           |
| `experimental` | Only with server flag | Only with server flag | Fixture path only unless an approved recipe exists |
| `active`       | Yes                   | Yes                   | Allowed                                            |
| `retired`      | Never                 | Never                 | New jobs rejected                                  |

`generationAvailability` is public user guidance. Actual paid eligibility is enforced by the presence of a matching server recipe for the exact template ID and version. A browser cannot enable paid generation by changing public metadata.

## Adding a template safely

1. Register versioned public metadata and assets.
2. Start as `draft` or `experimental` with `generationAvailability: fixture_only`.
3. Verify catalogue/detail rendering and the no-charge fixture flow.
4. Review validation requirements, cost, output quality, and rights for every sample asset.
5. Add a private recipe only after the prompt and provider configuration are approved.
6. Change public status and availability in a separate reviewed release.

The included `single-portrait-gentle-parallax` entry is a development fixture. It has no private provider recipe and cannot enter paid generation.

The wedding sample-video slot currently uses an explicitly labelled poster preview because no approved production sample video was supplied. Adding the approved MP4 requires metadata only; catalogue and detail rendering do not need code changes.
