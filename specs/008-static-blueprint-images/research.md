# Phase 0 Research: Static Blueprint Images

## Decision 1: `ImageID` format is storage object path (filename-stable)

- **Decision**: Use `ImageID` as the canonical storage object path in the image bucket (for example: `<blueprint-id>/characters/<character-slug>.webp`).
- **Rationale**: Supports direct lookup, stable patching, and the reviewed requirement that operators can recover mappings using known filenames.
- **Alternatives considered**:
  - Opaque UUID-only IDs: rejected because operator filename-based recovery becomes difficult.
  - Full public URL as ID: rejected because auth and URL rotation become harder to manage safely.

## Decision 2: Serve images through authenticated resolver endpoint + short-lived signed URL

- **Decision**: Add an authenticated Edge Function endpoint (`image-resolve`) that validates JWT and returns a short-lived signed URL for a requested `ImageID`.
- **Rationale**: Prevents anonymous abuse, keeps bucket private, and still gives frontend a renderable URL with minimal latency.
- **Alternatives considered**:
  - Public bucket direct URLs: rejected due to abuse risk and no auth enforcement.
  - Streaming bytes through function for every render: rejected due to higher latency and function load.

## Decision 3: Keep image fields optional across blueprint, character, and location levels

- **Decision**: All new image references remain optional; image-free blueprints are valid and playable.
- **Rationale**: Matches approved scope feedback and avoids breaking existing blueprint inventory.
- **Alternatives considered**:
  - Requiring all image mappings before publish: rejected because it blocks valid text-first gameplay and migration.

## Decision 4: Add structured art-style profile in blueprint metadata

- **Decision**: Add optional style metadata fields grouped under blueprint metadata (style direction, mood, lighting, palette).
- **Rationale**: Keeps style directives close to blueprint authoring and supports deterministic static generation prompts.
- **Alternatives considered**:
  - Style defined outside blueprint in deploy config: rejected because style intent should travel with blueprint content.
  - Single free-text style string only: rejected because it weakens consistency and validation.

## Decision 5: Generation utility is operator-run CLI with single/all modes and overwrite support

- **Decision**: Implement a script utility that generates one target or all targets, patches IDs, supports duplicate regeneration (`--overwrite`), and can recover from patch failures via filename mapping.
- **Rationale**: Fits existing script-driven workflows and keeps generation outside gameplay request path.
- **Alternatives considered**:
  - Interactive UI-only admin flow: rejected because no admin UI exists and script approach is already established.
  - Generation inside runtime gameplay endpoints: rejected because static generation is offline/prep work.

## Decision 6: Deployment utility publishes blueprint JSON and image assets as one validated bundle

- **Decision**: Add a deployment utility that uploads blueprint + referenced images together, supports an explicit out-of-repo image source directory flag, and fails only when explicitly referenced images are invalid/missing; blueprints with no image references still pass.
- **Rationale**: Keeps large/generated assets out of git while preserving referential integrity for image-enabled blueprints and preserving image-free compatibility.
- **Alternatives considered**:
  - Manual two-step deploy (blueprint then images): rejected due to drift and mismatch risk.
  - Hard-fail when any image fields are absent: rejected because optional image scope is required.
  - Require all images to live under repository paths: rejected because image assets may be generated/stored outside repo and should remain deployable.

## Decision 7: Frontend caches resolved URLs in-session by `ImageID`

- **Decision**: Cache image resolver responses in memory for the active browser session and refresh only when URL is expired.
- **Rationale**: Reduces duplicate resolver calls and helps meet latency goals without adding persistent cache complexity.
- **Alternatives considered**:
  - No caching: rejected due to unnecessary repeated signed URL generation.
  - Long-term localStorage cache: rejected due to stale URL/security expiration issues.

## Decision 8: Contract-first and test-first coverage across all tiers

- **Decision**: Update shared API contracts first, then implementation; add unit + integration + API E2E + browser E2E coverage for image rendering/auth/fallback/utility paths.
- **Rationale**: Aligns with constitution, backend conventions, and existing quality gates.
- **Alternatives considered**:
  - Integration-only testing: rejected because browser rendering/fallback expectations require E2E checks.
  - Browser-only testing: rejected because auth/policy/utility error branches need lower-level coverage.
