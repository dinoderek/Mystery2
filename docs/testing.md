# Testing Strategy

## Goals

- Exercise:
  - each component in isolation where possible
  - the integrated stack (DB + auth + functions)
  - the full user journey in a browser
- Deterministic tests:
  - avoid network calls to OpenRouter
  - mock AI responses at the Edge Function boundary
- CI-friendly:
  - single continuously running DB instance
  - logically isolated tests using unique IDs

## Test tiers

### 1) Unit tests (fast, no infra)

Location:

- `packages/apitests/unit`
- `packages/shared/tests`
- (optional) `supabase/functions/<function-name>/tests` for pure function tests

Covers:

- domain logic (reducers/state transitions)
- request/response schema validation
- UI component logic (where practical)
- prompt construction and parsing utilities

Web-specific command parser coverage:

- `web/src/lib/domain/parser.test.ts` validates:
  - alias recognition (move/talk/search/end/help/quit/list)
  - mode-aware behavior across explore/talk/accuse/ended
  - client-side missing/invalid target branches and suggestions
  - unrecognized inline hint generation
- `web/src/lib/domain/store.retry.test.ts` validates:
  - transient vs permanent error classification
  - exponential backoff sequencing used by the store retry loop

### 2) Integration tests (real Supabase local, no browser)

Location:

- `packages/apitests/integration`
- plus shared helpers in `packages/testkit`

Runs against:

- Supabase local stack (Postgres/Auth/Storage/Functions)

What we test:

- RLS policies (A cannot read B, etc.)
- Edge Function authentication behavior:
  - no token → 401/403 (where required)
  - valid token → success
- DB writes/reads for session lifecycle and event log
- Storage policies if used for user assets

AI calls:

- Never call OpenRouter in integration tests.
- Instead, configure Edge Functions to use a mock provider when `AI_PROVIDER=mock` (or similar config).
- Assert the persisted DB side effects match expectations.

Runner:

- Vitest/Jest (implementation choice)

### 3) End-to-end tests (browser, full stack)

Location:

- `web/e2e` for Playwright E2E tests

Harness:

- Vitest (API-first flow testing)

Runs against:

- local UI server (SvelteKit dev or preview)
- local Supabase stack

What we test:

- user can load UI
- optional: user can sign up/sign in
- user can create/continue a game session
- user can perform an action that triggers an Edge Function
- UI renders returned payload and state remains consistent after refresh

Guidance:

- Keep E2E tests few but high value.
- Use integration tests for most behavior; reserve E2E for critical journeys.

Web command parser E2E coverage (`web/e2e/input.test.ts`, `web/e2e/help.test.ts`) must include:

- alias submissions resolving to successful backend calls
- missing/invalid targets blocked client-side (no backend call)
- inline `locations`/`characters` list rendering
- brief unrecognized-command inline guidance
- detailed help modal on `help`
- transient failure retries and retry-exhaustion/manual-retry UX
- no retry on permanent 4xx failures

## Test Isolation Strategy (Logical Isolation)

Because starting and stopping Supabase is resource-intensive and slow, we rely on **Logical Isolation** rather than database resets. A single Supabase instance runs continuously. Every test is responsible for:

1. **Unique IDs:** Generating unique `user_id` and/or `session_id`s (UUIDs) during setup.
2. **Scoping:** Asserting only against its own unique IDs (no `SELECT COUNT(*) FROM table` without scoping to a specific user).
3. **Cleanup (Optional but recommended):** Relying on Postgres `ON DELETE CASCADE` via an `afterAll` hook to delete the mock `user_id`, cleanly wiping test data without a hard reset.

Integration/E2E tests should rely on:

- programmatic seeding via `packages/testkit` with unique IDs for every test run
- avoiding global database assertions

## Test execution

Before running tests, developers or CI must ensure the Supabase stack is running (`supabase start` or via the dev script). Tests should reuse the existing instance.

### Integration test script

`npm run test:integration`:

1. Uses Vitest to run the integration test suite against the running Supabase instance (handling its own data isolation)

### E2E test script

`npm run test:e2e`:

1. Starts Supabase if it isn't running already
2. Runs Vitest against the running Edge Functions to validate full player journeys

## RLS policy testing (minimum bar)

At least the following should be tested:

- User A can create and read their own session rows.
- User B cannot read or mutate User A’s session rows.
- If any “shared session” concept exists:
  - invited users can read (and maybe write) depending on design
- Storage:
  - user can access their own objects
  - user cannot access others (unless explicitly shared)

## Observability during tests

- On failures, capture:
  - Playwright screenshots/traces (E2E)
  - Edge Function logs from local Supabase (integration)
  - DB state snapshot for debugging (optional helper in testkit)

## Quality Gates

Before finalizing and merging any work, the following Quality Gates **must** be executed and passed successfully. AI Agents and developers should verify these before proposing completion. A single-shot quality gate script (e.g., `npm run test:all` or `scripts/quality-gate.sh`) should be provided to run all these checks in one go:

1. **Linting & Formatting:** Ensure code conforms to stylistic guidelines (`npm run lint` / `npm run format`).
2. **Type Checking:** Ensure the TypeScript compiler passes with no errors (`npm run typecheck`).
3. **Unit Tests:** Execute the unit test suite (`npm run test:unit`) to verify all isolated logic functions correctly.
4. **Integration Tests:** Run the integration test suite against the local Supabase stack (`npm run test:integration`).
5. **E2E Tests:** For front-end or critical journeys, ensure the Playwright E2E suite passes (`npm run test:e2e`).
6. **Documentation Sync:** Ensure all architectural, feature, or tooling changes are reflected in the `docs/` directory.

_(Note: Adjust the exact `npm run` commands above to match the actual script names in `package.json` if they differ.)_
