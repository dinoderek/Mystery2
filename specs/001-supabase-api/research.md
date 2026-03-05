# Research: Supabase API Implementation (001-supabase-api)

**Phase**: 0 — Research & Decisions  
**Date**: 2026-03-05  
**Branch**: `001-supabase-api`

---

## 1. Edge Function Routing Strategy

**Decision**: One Edge Function per top-level game operation (e.g., `game-start`, `game-move`, `game-search`, `game-talk`, `game-ask`, `game-end-talk`, `game-accuse`, `game-accuse-reasoning`, `game-get`, `blueprints-list`).

**Rationale**: Supabase Edge Functions are deployed as individual Deno scripts under `supabase/functions/<name>/index.ts`. Grouping all routes into a single function is possible but creates a single point of failure and makes individual function deployment harder. One function per operation mirrors the API contract directly, enables granular local testing, and aligns with Supabase conventions.

**Alternatives considered**:

- Router-in-one-function (e.g., Hono inside a single function): Reduces function count but does not align with Supabase's first-party tooling and complicates log isolation.
- RPC calls directly from UI to Postgres: Rejected — game logic requires server-side AI calls and secret handling.

---

## 2. Database Persistence Pattern

**Decision**: Append-only **event log** table (`game_events`) + a **session snapshot** table (`game_sessions`) for fast reads. The snapshot is updated atomically after each action.

**Rationale**: Architecture doc explicitly recommends this pattern. The event log provides a complete, auditable history of every turn; the snapshot provides O(1) state reads without replaying the log on every request.

**Alternatives considered**:

- Snapshot-only (mutate in place): Simpler, but loses audit trail and makes debugging harder.
- Replay-on-read (event sourcing without snapshot): Correct but slow for games with many turns.

---

## 3. Blueprint Storage

**Decision**: Blueprints are stored as JSON files inside Supabase Storage, loaded into Edge Functions at request time via the Supabase Storage client. A `blueprints` bucket with public read access (no auth required) is created in a migration.

**Rationale**: Blueprints are pre-authored content, not user data. Supabase Storage is the natural fit. Loading from Storage inside the Edge Function keeps the binary small and allows blueprints to be updated without redeployment.

**Alternatives considered**:

- Embedded in Edge Function filesystem: Inflexible; requires redeployment to add blueprints.
- Stored in Postgres JSONB column: Workable but makes blueprint management (adding/editing) less intuitive than managing files.

---

## 4. AI Provider Abstraction (Mock Only — OpenRouter Deferred)

**Decision**: An `AIProvider` interface is defined in `supabase/functions/_shared/ai-provider.ts`. Only `MockAIProvider` is implemented in this feature. `OpenRouterProvider` is explicitly **out of scope** and will be added in a future feature. Edge Functions receive the provider via dependency injection; the `AI_PROVIDER` environment variable switches behaviour.

**Rationale**: The full game loop can be built, tested, and validated end-to-end using the mock AI. Keeping OpenRouter out of this feature reduces scope, eliminates the need for secret management in this iteration, and keeps all tests fully deterministic. The interface boundary means adding OpenRouter later requires zero changes to function logic.

**Alternatives considered**:

- Inline `if (TEST_MODE)` checks in functions: Creates messy production code and risks accidental test paths in production.
- HTTP interceptors in tests: Fragile and couples tests to HTTP implementation details.
- Implement OpenRouter now: Out of scope as per user decision.

---

## 5. Game State Machine

**Decision**: Game mode is a string enum: `explore | talk | accuse | ended`. All state transitions are validated in a shared `validateTransition(currentMode, action)` utility before any DB write. Invalid transitions return HTTP 400.

**Rationale**: The API contract defines specific modes and only certain operations are valid per mode (e.g., `ask` is only valid in `talk` mode). A central state machine guard prevents invalid state writes and simplifies individual function logic.

**Alternatives considered**:

- Validate inline per function: Duplicates logic and risks inconsistency.

---

## 6. Session Identity (Auth)

**Decision**: For this feature, sessions are **anonymous**. A `session_id` UUID is generated server-side on `POST /game/start` and returned to the client. The client passes it as a path parameter on all subsequent requests. RLS policies are set to allow any caller to create a session.

**Rationale**: Architecture doc notes auth is optional. The spec explicitly calls this out as an assumption. The migration path to user-scoped sessions is straightforward: add a `user_id` FK and tighten RLS policies.

**Alternatives considered**:

- Require Supabase Auth from day one: Higher friction for an MVP, premature given the feature scope.

---

## 7. Testing Stack

**Decision**:

- **Unit tests**: Deno's built-in test runner (`deno test`) for pure Edge Function logic (state machine, prompt builders, schema validators).
- **Integration tests**: Vitest running against a live local Supabase instance. Uses `packages/testkit` helpers for seeding and cleanup.
- **E2E tests**: Playwright targeting the SvelteKit UI + local Supabase. Uses a mock blueprint fixture file and `AI_PROVIDER=mock` env variable.

**Rationale**: Aligns exactly with `docs/testing.md`. Avoids mixing runtimes unnecessarily.

---

## 8. Shared Types Package

**Decision**: Public (non-secret) API request/response types live in `packages/shared/src/api-types.ts`. The `BlueprintSchema` and ground-truth types remain in `supabase/functions/_shared/` (backend-only).

**Rationale**: The UI must never see blueprint ground truth (who the culprit is, real alibis). Two separate type packages enforces this border.
