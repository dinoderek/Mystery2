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
- blueprint generation utilities (`packages/blueprint-generator/*`, `scripts/generate-blueprint.mjs`)
- blueprint schema versioning coverage, including:
  - V2 schema acceptance for all canonical playable fixtures
  - V2 authoring schema validation for generator/evaluator blueprints
  - V1 schema still exists for reference but is no longer used by runtime code
- image generation/deploy utilities (`scripts/lib/*`, `scripts/generate-blueprint-images.mjs`)
- evaluation-packet assembly (`scripts/build-blueprint-evaluation-markdown.mjs`)
- image-generation env loading precedence (`.env.images.local`, `.env.local`, shell env, CLI overrides)
  - when `MYSTERY_CONFIG_ROOT` is set, those local-only files are resolved from that directory instead of the repo root
- image generation diagnostics, including preserved provider response bodies and stack traces on failed targets
- deployment helper logic (`tests/api/unit/deploy-helpers.test.ts`) including:
  - deploy CLI arg parsing and validation
  - strict deploy env/manifest contract enforcement
  - edge-function discovery (`supabase/functions/*`, excluding `_shared`)
  - command plan assembly for `dev|staging|prod`
  - skip behavior (`--skip-seed`, `--skip-users`) and bootstrap-user config validation
  - `.example.json` to `.json` bootstrap-user guidance and placeholder-password rejection
- local auth seed helper logic (`tests/api/unit/seed-auth-users.test.ts`) including:
  - first-run generation of `supabase/seed/auth-users.local.json`
  - rerun preservation of existing local passwords
  - generated-credentials output formatting
  - external-root resolution via `MYSTERY_CONFIG_ROOT`

Web-specific command parser coverage:

- `web/src/lib/domain/parser.test.ts` validates:
  - alias recognition (move/talk/search/end/help/quit/list)
  - mode-aware behavior across explore/talk/accuse/ended
  - canonical command hint text accuracy (`move to/go to`, `talk to`, `accuse [statement]`)
  - accuse-mode command-like input (for example `go ...`, `talk ...`) stays narrator-facing and is treated as reasoning text
  - client-side missing/invalid target branches and suggestions
  - unrecognized inline hint generation
- `web/src/lib/domain/store.retry.test.ts` validates:
  - transient vs permanent error classification
  - exponential backoff sequencing used by the store retry loop
- `web/src/lib/domain/theme-store.test.ts` validates:
  - theme listing, switching by id and name, invalid theme handling
  - localStorage persistence and initialization
  - CSS custom property application to DOM
- `web/src/lib/domain/store.speaker.test.ts` validates:
  - investigator/system/backend speaker mapping in the UI stream
  - local help/validation feedback remains client-only (no backend write path)

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
  - CORS behavior: `OPTIONS` preflight returns success and auth failures still include CORS headers
- Authenticated request setup:
  - provision users through `tests/testkit/src/auth.ts` (`setupTestAuth`, `createTestUser`, `signIn`)
  - include bearer auth headers from testkit helpers for all protected function calls
- DB writes/reads for session lifecycle and event log
- Session catalog endpoint behavior (`game-sessions-list`):
  - returns `in_progress`, `completed`, and `counts`
  - enforces recency ordering (`last_played_at`, then `created_at`, then `game_id`)
  - maps ended sessions to completed rows with `outcome`
  - marks missing-blueprint sessions as `can_open=false` with fallback title
- Storage policies if used for user assets
- Conversation/search API contract behavior:
  - `game-ask` requires non-empty `player_input`
  - `game-ask` and `game-search` responses are narration/time/mode focused (no clue-ID fields)
  - speaker attribution per endpoint lives on `narration_parts[].speaker` and replay uses the persisted `narration_events[].narration_parts[]`
  - narration-bearing `game_events.payload.diagnostics` records sequence, category, timing, and timeout-order metadata
  - timeout-forced `mode='accuse'` transitions continue through `game-accuse` reasoning rounds without missing-context failures
  - timeout-forced `move`, `search`, and `ask` persist the action event before the appended `forced_endgame` event
  - `talk` and `end_talk` leave `time_remaining` unchanged
  - accusation judge internal contract no longer includes inferred suspect fields; terminal `win|lose` resolution is authoritative
- Static image boundary behavior:
  - `blueprints-list` includes optional `blueprint_image_id`
  - `game-move` includes optional `narration_parts[].image_id`
  - `game-talk` includes optional `narration_parts[].image_id`
  - `blueprint-image-link` enforces auth and returns signed URL/expiry on valid references

AI calls:

- Never call OpenRouter in integration tests.
- Instead, use the seeded `mock` profile in `ai_profiles` (canonical default row is `id='default'`, and tests can still pass `ai_profile: "mock"` explicitly).
- Assert the persisted DB side effects match expectations.
  - accusation resolution persists `game_sessions.mode='ended'` and `game_sessions.outcome='win'|'lose'`
- Live provider checks are isolated in dedicated opt-in suites (see below).

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
- user can sign in with a provisioned account
- unauthenticated users are redirected to `/login`
- authenticated users are redirected away from `/login`
- session persistence and token refresh behavior
- logout clears session and re-protects game routes
- user can create/continue a game session
- session-aware landing menu exposes exactly 3 numeric options (`new`, `in-progress`, `completed`)
- in-progress and completed options disable correctly when counts are zero
- `/sessions/in-progress` and `/sessions/completed` list flows support numeric row selection
- completed-session viewer opens in read-only mode and returns to `/` on any key
- user can perform an action that triggers an Edge Function
- UI renders returned payload and state remains consistent after refresh
- transcript resume failures surface player-facing recovery guidance instead of silently dropping story lines

Guidance:

- Keep E2E tests few but high value.
- Use integration tests for most behavior; reserve E2E for critical journeys.
- Vitest setup and Playwright auth/bootstrap helpers should honor `MYSTERY_CONFIG_ROOT` so shared local config works the same way in automation as it does in operator scripts.

Web command parser E2E coverage (`web/e2e/input.test.ts`, `web/e2e/help.test.ts`) must include:

- alias submissions resolving to successful backend calls
- missing/invalid targets blocked client-side (no backend call)
- inline `locations`/`characters` list rendering
- brief unrecognized-command inline guidance
- detailed help modal on `help`
- transient failure retries and retry-exhaustion/manual-retry UX
- no retry on permanent 4xx failures
- parser-to-backend payload mapping for talk/ask (`player_input`) and accuse reasoning (`player_reasoning`)
- accuse-mode multi-round continuity: reasoning text continues to route to `game-accuse` even when the text resembles explore/talk commands
- accusation end-state UX: success/failure message, input lock, and `press any key` return-to-list prompt
- quit end-state UX: local `quit`/`exit` shows the same `press any key` return-to-list prompt and returns to `/` on keypress
- actor label rendering in the terminal stream (`You`, `Narrator`, character name, `System`)
- theme-aware speaker style behavior across at least two themes, with one shared generic style for all character speakers
- terminal loading indicators:
  - narration-area wait spinner during backend calls
- centered start-screen spinner while a selected mystery is initializing
- image rendering checks:
  - start screen blueprint cover image via signed link
  - session side panel updates on move/talk image IDs
  - placeholder fallback when signed-link requests fail

Theme command E2E coverage (`web/e2e/theme.test.ts`) must include:

- `themes` listing available themes without player input echo in narration
- `theme <name>` switching CSS custom properties and confirming without player echo
- theme persistence across page navigation (localStorage)
- invalid theme name error feedback with available theme list
- theme commands working across all game modes (not just explore)

Full-stack browser coverage (`web/e2e/full-stack.spec.ts`) should exercise parser + store + backend state machine without network route mocking when local Supabase is available.

Auth browser coverage (`web/e2e/auth.spec.ts`) must include:

- required-field validation for login form
- invalid credential feedback
- credential resolution from explicit env vars, the local auth seed manifest, or ephemeral fallback via `web/e2e/test-auth.ts`
- successful login redirect behavior
- session persistence across reload
- refresh-failure path redirecting to `/login` with a friendly message
- logout flow and route protection (`/` and `/session`)

Sessions navigation E2E coverage (`web/e2e/sessions-navigation.test.ts`) must include:

- in-progress rows render title, turns-left, and last-played values
- completed rows render title, outcome, and last-played values
- numeric row selection opens `/session` for resume/review paths
- non-openable rows (`can_open=false`) show guard messaging and do not navigate

## Test Isolation Strategy (Logical Isolation)

Because starting and stopping Supabase is resource-intensive and slow, we rely on **Logical Isolation** rather than database resets. A single Supabase instance runs continuously. Every test is responsible for:

1. **Unique IDs:** Generating unique `user_id` and/or `session_id`s (UUIDs) during setup.
2. **Scoping:** Asserting only against its own unique IDs (no `SELECT COUNT(*) FROM table` without scoping to a specific user).
3. **Cleanup (Optional but recommended):** Relying on Postgres `ON DELETE CASCADE` via an `afterAll` hook to delete the mock `user_id`, cleanly wiping test data without a hard reset.

Integration/E2E tests should rely on:

- programmatic seeding via `packages/testkit` with unique IDs for every test run
- avoiding global database assertions

## Test execution

Before running tests, developers or CI can rely on the npm scripts to start Supabase when required and reseed storage blueprints before API-level suites.

### Integration test script

`npm run test:integration`:

1. Ensures Supabase is running (no restart by default)
2. Seeds storage blueprints only when the bucket is empty (`--if-missing`)
3. Seeds/refreshes canonical `default` AI profile in Postgres (mock config)
4. Uses Vitest to run the integration test suite (handling its own data isolation)

### E2E test script

`npm run test:e2e`:

1. Ensures Supabase is running (no restart by default)
2. Seeds storage blueprints only when the bucket is empty (`--if-missing`)
3. Seeds/refreshes canonical `default` AI profile in Postgres (mock config)
4. Runs Vitest against the running Edge Functions to validate full player journeys

`npm -w web run test:e2e`:

1. Runs Playwright browser E2E for the web app
2. Current project matrix is Chromium-only (`web/playwright.config.ts`) for local stability

### Shared-suite execution

- Treat integration, API E2E, and Playwright suites as serialized across the repo.
- `npm run test:integration`, `npm run test:e2e`, and `npm -w web run test:e2e` all rely on shared local resources (Supabase at `127.0.0.1:54331`, shared storage/auth state, and for Playwright a fixed dev-server port `5173`).
- Do not run more than one of those shared-state suites at the same time from different terminals or subagents.
- Parallel verification is still fine for unit-only suites such as `npx vitest run tests/api/unit/...` and `npm -w web run test:unit`.

### Deploy dry-run checks

`npm run test:unit` includes deploy helper dry-run coverage for the staged plan shape, function-job resolution, and serial override behavior, plus runner coverage for parallel lane ordering and sibling-lane cancellation. Full remote deploy verification remains manual via `npm run deploy -- --env <env> --dry-run --skip-users` and live deploy smoke checks.

### Live-AI suites (opt-in)

These suites are intentionally excluded from `npm run test:all` and only run when explicitly requested.

- Integration (live harness):
  - `npm run test:integration:live:free`
  - `npm run test:integration:live:paid`
- API E2E (investigator script):
  - `npm run test:e2e:live:free`
  - `npm run test:e2e:live:paid`
- Blueprint generation:
  - `npm run test:blueprint:live:free`
  - `npm run test:blueprint:live:paid`
- Browser smoke (optional):
  - `AI_LIVE=1 npm -w web run test:e2e -- web/e2e/live-ai.spec.ts`

Live suites require:

- `AI_LIVE=1`
- mode-specific local AI env files (`.env.ai.free.local`, `.env.ai.paid.local`) with `AI_PROVIDER`, `AI_MODEL`, and `OPENROUTER_API_KEY` for OpenRouter modes
- `npm run seed:ai -- --only <free|paid>` to sync profile model/key into Postgres for the selected live mode
- resilient retry handling for retriable `503` failures (`details.retriable=true`) in live tests
- higher timeout budget for real model latency (default 600s per live test)
- live suites may short-circuit with a warning when retries are exhausted by upstream transient failures
- blueprint live suites validate generated payloads against the shared `BlueprintV2Schema`

Live API E2E investigator coverage must exercise all actions:

- `move`
- `search`
- `talk`
- `ask`
- `end_talk`
- `accuse_reasoning`

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
- Preferred local log tail command:
  - `npm run logs:edge`

## Quality Gates

Before finalizing and merging any work, the following Quality Gates **must** be executed and passed successfully. AI Agents and developers should verify these before proposing completion. A single-shot quality gate script (e.g., `npm run test:all` or `scripts/quality-gate.sh`) should be provided to run all these checks in one go:

Exception (documentation-only changes):
- If a change only touches documentation files (`*.md`) and does not affect code, tests, build/deploy scripts, migrations, or environment contracts, running code quality gates is optional.
- For doc-only changes, validate command accuracy, cross-document consistency, and link/path correctness instead.

1. **Linting & Formatting:** Ensure code conforms to stylistic guidelines (`npm run lint` / `npm run format`).
2. **Type Checking:** Ensure the TypeScript compiler passes with no errors (`npm run typecheck`).
3. **Unit Tests:** Execute the unit test suite (`npm run test:unit`) to verify all isolated logic functions correctly.
4. **Integration Tests:** Run the integration test suite against the local Supabase stack (`npm run test:integration`).
5. **E2E Tests:** For front-end or critical journeys, ensure the Playwright E2E suite passes (`npm run test:e2e`).
6. **Documentation Sync:** Ensure all architectural, feature, or tooling changes are reflected in the `docs/` directory.

_(Note: Adjust the exact `npm run` commands above to match the actual script names in `package.json` if they differ.)_
