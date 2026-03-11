# Research: Sessions Navigation, Resume, and Completed Logs

**Feature**: `007-sessions`  
**Date**: 2026-03-10  
**Phase**: 0 - Outline & Research

## Research Task Queue

- Research session summary retrieval contract for landing/list views.
- Research best practice for API boundary ownership between web and Supabase Edge Functions.
- Research deterministic sort rules for session recency lists.
- Research handling for sessions whose blueprint file no longer exists.
- Research navigation pattern for list routes with browser back and keyboard `b`.
- Research resumed-session behavior when `mode='ended'`.
- Research test strategy for unit/integration/API E2E/browser E2E coverage.

## 1. Session Catalog Contract Shape

**Decision**: Add a new authenticated endpoint `GET /game-sessions-list` that returns grouped session summaries:

- `in_progress[]`
- `completed[]`
- `counts` for both categories

Each summary includes `game_id`, `blueprint_id`, `mystery_title`, `mystery_available`, `can_open`, `mode`, `time_remaining`, `outcome`, `last_played_at`, and `created_at`.

**Rationale**: Landing needs counts to drive disabled menu options, and list screens need display-ready rows. A grouped response avoids duplicate requests and keeps sorting/eligibility centralized.

**Alternatives considered**:

- Query `game_sessions` directly from the browser: rejected because title resolution and missing-blueprint handling would duplicate backend logic in UI.
- Two endpoints (`/in-progress` and `/completed`): rejected due unnecessary surface-area expansion and duplicated query logic.

## 2. API Boundary Ownership

**Decision**: Keep the session-list behavior behind Edge Functions and define schema updates in `packages/shared/src/mystery-api-contracts.ts` first.

**Rationale**: `docs/backend-conventions.md` requires shared-boundary contracts in shared Zod schemas and favors explicit server-side boundary control.

**Alternatives considered**:

- Ad hoc JSON response without shared schema updates: rejected because it breaks the contract-first requirement.
- UI-only composition from multiple existing APIs: rejected because it spreads domain rules across layers.

## 3. Sorting and Determinism

**Decision**: Sort each category by `updated_at DESC`, with stable tie-breakers `created_at DESC`, then `id DESC`.

**Rationale**: Feature requirement is “sorted by last time played,” and deterministic tie-breakers remove nondeterministic row ordering when timestamps match.

**Alternatives considered**:

- Sort only by `updated_at`: rejected because equal timestamps can produce unstable order.
- Sort by creation time only: rejected because it does not match “last time played.”

## 4. Missing Blueprint Handling

**Decision**: Keep sessions visible in lists when blueprint metadata cannot be resolved; set:

- `mystery_title = "Unknown Mystery"`
- `mystery_available = false`
- `can_open = false`

UI must render row as disabled for selection.

**Rationale**: This matches the approved edge-case requirement update: list remains visible, opening disabled.

**Alternatives considered**:

- Hide rows with missing blueprints: rejected because user loses visibility of historical sessions.
- Allow open with degraded rendering: rejected because current `game-get` relies on loading the blueprint from storage and fails when missing.

## 5. Routing and Navigation Pattern

**Decision**: Use dedicated list routes:

- `/sessions/in-progress`
- `/sessions/completed`

Support both browser back and keyboard `b` for returning to `/`.

**Rationale**: Separate routes make history behavior explicit and simplify keyboard routing semantics.

**Alternatives considered**:

- Single route with query param (`/sessions?status=...`): rejected for less explicit key mapping and more conditional complexity in one page.
- Modal/list overlay on `/`: rejected because browser-back semantics become less predictable.

## 6. Resume and Completed Viewer Behavior

**Decision**: Resume/view both categories through existing `game-get` by selected `game_id`; treat returned `state.mode` as source-of-truth:

- non-`ended`: interactive `/session`
- `ended`: read-only completed viewer with only `press any key to go back`

**Rationale**: Reuses proven session hydration endpoint and enforces consistent behavior based on persisted state.

**Alternatives considered**:

- Add separate “view completed” endpoint: rejected as redundant with `game-get`.
- Infer mode from list category only: rejected because source-of-truth must be persisted backend state.

## 7. Test Strategy and Quality Gates

**Decision**: Add coverage at four levels:

- Unit: catalog mapping/sorting/disable/openability logic in web store/parser helpers
- Integration: `game-sessions-list` auth, category assignment, sorting, missing-blueprint disable flags
- API E2E: start + progress + complete + list + resume/view via `game-get`
- Playwright E2E: landing menu states, list navigation, resume interactive, completed read-only behavior

Run final quality gate with `npm run test:all` plus web Playwright E2E.

**Rationale**: The feature spans backend contracts and keyboard-driven UI routing; single-tier testing is insufficient.

**Alternatives considered**:

- Integration-only: rejected because route and keyboard behavior would be unverified.
- Browser-only: rejected because backend contract/sorting/auth regressions would be opaque.
