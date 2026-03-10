# Research: Static Blueprint Images

**Feature**: `009-static-blueprint-images`  
**Date**: 2026-03-10  
**Phase**: 0 - Outline & Research

## Research Task Queue

- Research authenticated image delivery pattern for browser rendering with abuse protection.
- Research missing-image UX fallback policy for blueprint list and narration contexts.
- Research image identity/uniqueness and storage key strategy.
- Research operator generation workflow shape and failure semantics.
- Research deployment extension behavior for blueprint + image publishing.
- Research API boundary updates needed for list/move/talk/image-access actions.
- Research test strategy updates across unit/integration/E2E tiers.
- Research source-control hygiene for generated binary assets.

## 1. Authenticated Image Delivery

**Decision**: Use a dedicated authenticated endpoint that issues short-lived signed URLs for image fetches.

**Rationale**: This keeps storage objects private by default, centralizes auth checks, limits abuse exposure, and avoids proxying image bytes through edge functions.

**Alternatives considered**:
- Public image URLs: rejected due abuse and unauthorized scraping risk.
- Full edge proxy stream endpoint: rejected due unnecessary latency/cost and operational load.
- Browser direct storage fetch without signed URL issuance: rejected because policy surface is harder to constrain and rotate.

## 2. Missing/Broken Image Fallback

**Decision**: Default to placeholder rendering when an image reference exists but image retrieval fails.

**Rationale**: Placeholder behavior preserves layout stability, communicates missing assets explicitly, and gives deterministic acceptance test outcomes.

**Alternatives considered**:
- Hide image region on failure: rejected because silent disappearance obscures content/QA issues.
- Context-dependent mixed behavior: rejected for first release due inconsistent UX and increased test complexity.

## 3. Image Identity & Uniqueness

**Decision**: Generate globally unique image IDs with `<blueprint-slug>-<uuid>` and maintain uniqueness validation at generation time.

**Rationale**: This prevents collisions across blueprints/environments while preserving human traceability to source blueprint.

**Alternatives considered**:
- Plain sequential IDs per blueprint: rejected due collision risk during merges/manual edits.
- Raw UUID only: rejected because operator debugging is harder without blueprint context.

## 4. Storage Key Strategy

**Decision**: Store images in an image-dedicated storage namespace keyed by blueprint and image ID, with file extension retained from generated output.

**Rationale**: Blueprint-scoped paths simplify deployment packaging, cleanup, and diagnostics while keeping image IDs stable.

**Alternatives considered**:
- Reuse `blueprints` bucket for JSON + images together: rejected to avoid mixed-content policy complexity.
- Flat global image folder: rejected because operational tracing/cleanup are harder.

## 5. Generation Workflow Scope & Prompting

**Decision**: Provide one local generation command supporting target subsets (`all`, `blueprint`, selected `characters`, selected `locations`), model selection, and prompt composition from blueprint descriptions plus art style.

**Rationale**: This matches operator needs for selective regeneration while preserving deterministic source-of-truth fields in blueprint JSON.

**Alternatives considered**:
- Always regenerate all images: rejected because it is slower and overwrites approved assets unnecessarily.
- Manual prompt-only mode without blueprint-derived context: rejected because output consistency degrades.

## 6. Generation Failure Semantics

**Decision**: Patch blueprint references only for successfully generated images; report per-target failures and keep prior references untouched for failed targets.

**Rationale**: This avoids corrupting working references and supports iterative retries.

**Alternatives considered**:
- Fail-fast and rollback everything: rejected because one failed target should not discard successful outputs.
- Blindly patch all targets regardless of generation success: rejected because it creates broken references.

## 7. Deployment Extension Behavior

**Decision**: Extend existing deployment utility to upload blueprint JSON and referenced images in one flow, with warning-level reporting for missing files while keeping blueprint deploy successful.

**Rationale**: This preserves backward compatibility and allows story publication even when optional images are incomplete.

**Alternatives considered**:
- Hard fail when any image missing: rejected because images are optional by requirement.
- Ignore image deployment entirely when partial failures occur: rejected because it hides operational problems.

## 8. API Boundary Contract Changes

**Decision**: Extend list/move/talk responses with optional image IDs and add an authenticated image-link issuance endpoint returning signed URL + expiry metadata.

**Rationale**: It keeps gameplay contracts explicit and decouples narration logic from storage access policy logic.

**Alternatives considered**:
- Return permanent image URLs in gameplay responses: rejected due security constraints.
- Encode binary image payloads directly in gameplay responses: rejected due payload bloat and latency.

## 9. Test Strategy

**Decision**: Add unit tests for schema/parser/tooling behavior, integration tests for auth/link issuance and failure modes, and E2E tests for blueprint/move/talk image rendering including placeholder behavior.

**Rationale**: The feature spans schema, API, script tooling, and UI rendering; single-tier testing is insufficient.

**Alternatives considered**:
- E2E-only verification: rejected due poor fault localization.
- Integration-only verification: rejected because UI fallback/placement behavior would be unproven.

## 10. Source-Control Hygiene

**Decision**: Keep generated image output directories ignored by default and document operator override only when intentionally versioning fixture assets.

**Rationale**: Binary artifacts are environment-specific and should not pollute repository history.

**Alternatives considered**:
- Commit generated images by default: rejected per feature constraint and repo hygiene.
- No default ignore guidance: rejected due high accidental-commit risk.
