# Testing Strategy

## Goals

- exercise pure logic, the integrated Supabase stack, and the browser UX at the
  correct layer
- keep local and CI runs deterministic by default
- make it obvious which suite to update when a change crosses a boundary
- preserve one final quality gate: `npm test` for every non-documentation change

## Suite Map

| Suite | Locations | Runner | Requires Supabase | Requires web dev server | AI mode | Command |
| --- | --- | --- | --- | --- | --- | --- |
| API/shared unit | `tests/api/unit` | Vitest | No | No | None or mocked in-process | `npm run test:unit` |
| Web unit | `web/src/lib/**/*.test.ts` | Vitest | No | No | None | `npm -w web run test:unit` |
| Integration | `tests/api/integration`, helpers in `tests/testkit` | Vitest via `scripts/run-mock-tests.mjs` | Yes | No | Seeded `mock` profile by default | `npm run test:integration` |
| API E2E | `tests/api/e2e`, helpers in `tests/testkit` | Vitest via `scripts/run-mock-tests.mjs` | Yes | No | Seeded `mock` profile by default | `npm run test:e2e` |
| Browser E2E | `web/e2e` | Playwright | Yes | Yes, via Playwright `webServer` | Seeded `mock` profile by default | `npm -w web run test:e2e` |

## Suite Responsibilities

### 1) API/shared unit

Use this suite for fast validation of logic that does not need a running local
stack.

Update this suite when changing:

- shared contracts and schema validation
- prompt construction, parsing, and AI-provider helper logic
- blueprint generation, evaluation, image-generation, and deploy helpers
- local auth or AI seed helper logic
- mock provider behavior in `supabase/functions/_shared/ai-provider.ts`

Expected coverage includes:

- domain logic and request/response schema validation
- blueprint generator, evaluator, image, and deploy utility behavior
- mock AI role output and provider-selection unit coverage
- local auth and AI seeding helper logic

### 2) Web unit

Use this suite for browser-domain logic that can be tested without the full UI
stack.

Update this suite when changing:

- parser and command normalization
- retry classification and store behavior
- theme store behavior
- speaker mapping or other client-only transcript transforms

Expected coverage includes:

- alias recognition and mode-aware parsing
- inline validation and unrecognized-command guidance
- retry/backoff classification
- theme persistence and CSS custom property updates
- speaker mapping and client-only feedback paths

### 3) Integration

Use this suite for real Supabase boundaries without a browser.

Update this suite when changing:

- Edge Functions or files in `supabase/functions/_shared/`
- shared API contracts used by Edge Functions
- auth rules, RLS, storage policies, migrations, or seeded local state
- AI profile resolution, provider selection, or the default mock profile

Dependencies:

- local Supabase stack
- seeded storage blueprints
- seeded `ai_profiles.id='default'` pointing at `mock`
- test helpers in `tests/testkit`

Expected coverage includes:

- auth rejection/success paths and CORS behavior
- RLS and storage access rules
- session lifecycle writes and reads
- persisted event payloads, diagnostics, and state transitions
- session catalog behavior
- signed image-link behavior
- AI profile runtime resolution and default/mock profile behavior

Never call OpenRouter in this suite. Use the seeded `mock` profile and assert
persisted side effects instead.

### 4) API E2E

Use this suite for full player journeys through the Edge Function layer without
the browser UI.

Update this suite when changing:

- multi-step gameplay flows across endpoints
- session start/resume/endgame lifecycle
- AI-profile-dependent API journeys
- seeded mock narration or API expectations that span multiple turns

Dependencies:

- local Supabase stack
- seeded storage blueprints
- seeded `default` mock profile
- test helpers in `tests/testkit`

Expected coverage includes:

- new-game flow and resumable-session flow
- move, search, talk, ask, end-talk, and accuse journeys
- mock-profile-backed end-to-end API behavior

### 5) Browser E2E

Use this suite for browser navigation, auth UX, rendering, and retry behavior.

Update this suite when changing:

- route protection and login/logout behavior
- terminal rendering, command entry UX, loading states, and retries
- session list navigation
- theme commands and browser persistence
- image rendering and signed-link failure UX

Dependencies:

- local Supabase stack
- running local web server
- seeded local auth users and seeded `default` mock profile

Expected coverage includes:

- login, logout, redirect, and refresh-failure flows
- command submission and parser-to-backend wiring
- retry and error UX
- transcript, speaker labels, and terminal loading indicators
- in-progress/completed session navigation
- theme commands and persistence
- signed image rendering and placeholder fallback

Keep this suite high value. Prefer integration tests for backend behavior and
reserve Playwright for browser-specific user journeys.

## Change-To-Test Mapping

- shared logic, parser behavior, prompt builders, script helpers, and pure
  contract validation -> unit tests
- Edge Functions, auth, RLS, storage, migrations, seeded runtime state, and
  API contracts -> integration tests
- multi-endpoint player journeys through Edge Functions -> API E2E
- browser auth/navigation/rendering/retry UX -> browser E2E

When a change crosses more than one boundary, update every affected suite. For
example, a change to AI output contracts may require:

- unit updates for `supabase/functions/_shared/ai-provider.ts`
- integration updates for Edge Function payloads and seeded profile flow
- API E2E updates if mock narration or session flow assertions change
- browser E2E updates only if the rendered UX or retry behavior changes

## Agent Workflow

- Use focused suites while iterating.
- Before finalizing any non-documentation change, run `npm test`.
- If you changed files under `supabase/functions/` or
  `supabase/functions/_shared/`, run `npm run supabase:restart` before
  integration, API E2E, browser E2E, or `npm test`.
- `npm run test:integration` and `npm run test:e2e` call
  `ensureSupabaseRunning()` and reseed storage plus the canonical `default`
  mock profile, but they do not restart stale Edge Function code.
- If you changed AI contracts, prompts, runtime context, provider selection, or
  seeded AI profile behavior, update the mock provider unit coverage in
  `tests/api/unit/ai-provider.test.ts` and any affected integration or API E2E
  assertions, then reseed via `npm run seed:ai` or `npm run seed:all`.
- Live-AI suites are opt-in only and are never a substitute for the default
  mock-backed quality gate.

## Mock Data Conventions

Browser E2E mocks and the blueprint unit fixture are typed against the shared
Zod schemas in `packages/shared/src/mystery-api-contracts.ts` and
`packages/shared/src/blueprint-schema-v2.ts`.

### Rules

- Use the factory functions and validated constants in
  `tests/testkit/src/fixtures.ts` instead of hand-writing inline mock objects.
- Never define inline mock objects for shapes that have Zod schemas
  (`Speaker`, `GameState`, `SessionSummary`, `BlueprintSummary`, etc.).
- Factories call `Schema.parse()` at creation time — if the schema adds a
  required field or renames a key, the mock fails immediately rather than
  silently passing against a stale shape.
- Pass only the overrides that differ from factory defaults. This keeps tests
  focused on what is being tested.
- When adding a new response type to the shared schemas, add a corresponding
  factory in `tests/testkit/src/fixtures.ts` and validate it with
  `Schema.parse()`.
- For shapes that have a TypeScript type but no Zod schema, annotate mock data
  with that type explicitly. This ensures `npm run typecheck` catches drift
  (missing fields, renamed keys, wrong property types) at compile time rather
  than letting untyped object literals silently go stale.

### Available factories

Constants: `NARRATOR_SPEAKER`, `INVESTIGATOR_SPEAKER`, `LOCATIONS`,
`CHARACTERS`, `BASE_GAME_STATE`, `EMPTY_CATALOG`, `MOCK_BLUEPRINT`,
`MOCK_IMAGE_LINK`.

Functions: `characterSpeaker(name)`, `narrationResponse(text, speaker, imageId?)`,
`createNarrationEvent(overrides?)`, `createGameState(overrides?)`,
`createGameStartResponse(overrides?)`, `createSessionSummary(overrides?)`,
`createSessionCatalog(overrides?)`, `createBlueprintSummary(overrides?)`,
`createMoveResponse(overrides?)`, `createSearchResponse(overrides?)`,
`createTalkStartResponse(overrides?)`, `createTalkEndResponse(overrides?)`,
`createAccuseResponse(overrides?)`, `createImageLinkResponse(overrides?)`.

## Test Isolation Strategy

Because starting and stopping Supabase is resource-intensive, integration and
E2E suites use logical isolation instead of database resets.

Every test is responsible for:

1. generating unique `user_id` and/or `session_id` values
2. scoping assertions to its own identifiers
3. optionally cleaning up through `ON DELETE CASCADE` rather than full resets

Integration, API E2E, and browser E2E tests should rely on:

- programmatic setup via `tests/testkit`
- unique IDs per test run
- no global count assertions without scoping

## Test Execution

### Final quality gate

`npm test` (aliased as `npm run test:gate`) runs the test gate orchestrator
(`scripts/run-test-gate.mjs`), which executes in two phases:

**Phase 1 (parallel):**

1. `npm run lint`
2. `npm run typecheck`
3. `npm -w web run check`
4. `npm run test:unit`
5. `npm -w web run test:unit`

**Phase 2 (serial — shares Supabase state):**

6. `npm run test:integration`
7. `npm run test:e2e`
8. `npm -w web run test:e2e`

Phase 2 only runs if all phase 1 steps pass. After phase 2, a non-fatal leak
check runs to detect orphaned test users.

Focused sub-scripts are for iteration only. They do not replace the final
`npm test` gate.

Documentation sync is still required alongside that gate whenever setup,
runtime behavior, testing workflow, or debugging guidance changes.

### Script behavior

`npm run test:integration`:

1. ensures Supabase is running
2. seeds storage blueprints
3. seeds or refreshes the canonical `default` AI profile in mock mode
4. runs Vitest on `tests/api/integration`

`npm run test:e2e`:

1. ensures Supabase is running
2. seeds storage blueprints
3. seeds or refreshes the canonical `default` AI profile in mock mode
4. runs Vitest on `tests/api/e2e`

`npm -w web run test:e2e`:

1. starts the local web app through Playwright's `webServer` configuration
2. runs Playwright browser E2E against that local app
3. uses the current local project browser matrix in `web/playwright.config.ts`

### Shared-suite execution

- Treat integration, API E2E, and browser E2E as serialized within a single
  checkout or worktree.
- Within one checkout, those suites share local Supabase state and the Vite dev
  server port. Do not run more than one of them at the same time from separate
  terminals.
- Across worktrees, they can run concurrently because each worktree gets its
  own Supabase stack and Vite port. See
  [`docs/local-infrastructure.md`](local-infrastructure.md).
- Unit-only suites can run in parallel more safely.

## Live-AI Suites (Opt-In)

These suites are excluded from `npm test` and run only when explicitly
requested:

- `npm run test:integration:live:free`
- `npm run test:integration:live:paid`
- `npm run test:e2e:live:free`
- `npm run test:e2e:live:paid`
- `npm run test:blueprint:live:free`
- `npm run test:blueprint:live:paid`
- `AI_LIVE=1 npm -w web run test:e2e -- web/e2e/live-ai.spec.ts`

Live suites require:

- `AI_LIVE=1`
- `.env.ai.free.local` or `.env.ai.paid.local`
- `npm run seed:ai -- --only <free|paid>` to sync the selected live profile
- resilient handling of retriable `503` failures

See [`docs/ai-configuration.md`](ai-configuration.md) for the canonical local
profile and reseeding rules.

## RLS And Boundary Minimum Bar

At minimum, integration coverage should prove:

- user A can create and read their own session rows
- user B cannot read or mutate user A's rows
- storage access is limited to the intended user unless explicitly shared
- protected Edge Functions reject missing or invalid auth

## Observability During Tests

### Log files and timing

Every `npm test` run writes timestamped logs to `test-results/<timestamp>/`.
Each step gets its own log file (`lint.log`, `typecheck.log`, `unit-api.log`,
etc.) and a `summary.log` with per-step pass/fail status and wall-clock
timing. The orchestrator keeps the last 5 runs and prunes older ones.

Example `summary.log` output:

```
lint               4.2s  PASS
typecheck          8.1s  PASS
unit-api           2.3s  PASS
integration       18.4s  PASS
─────────────────────────────
Total             45.1s  PASS
```

Use these logs for post-mortem debugging, especially in agent workflows where
console scrollback may be lost.

### Playwright artifacts

On failure, Playwright captures screenshots and traces automatically
(`screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`). Reports land
in `web/playwright-report/` and `web/test-results/`.

### Other failure inspection

- Edge Function logs from local Supabase via `npm run logs:edge`
- relevant DB state snapshots when testkit helpers provide them

## Test Coverage

Coverage is configured but **not enforced** — no threshold gates yet. Use
coverage to identify gaps and track trends.

### Running coverage locally

```bash
npm run test:unit:coverage          # API/shared unit → coverage/api/
npm -w web run test:unit:coverage   # Web unit → web/coverage/
```

Both produce `text-summary` (console), `json`, and `html` reports. Open
`coverage/api/index.html` or `web/coverage/index.html` for browsable reports.

Coverage uses the Vitest v8 provider and measures the source files listed in
each `vitest.config.ts` `coverage.include` array.

### What is covered

- **API/shared unit coverage**: `supabase/functions/**/*.ts`,
  `packages/shared/src/**/*.ts`
- **Web unit coverage**: `src/lib/**/*.ts`, `src/lib/**/*.svelte`

Integration and E2E suites do not collect coverage (they test through HTTP
boundaries).

## Leak Detection

After phase 2 of the test gate, a non-fatal leak check queries the local
Supabase auth store for users with emails matching `*@test.local`. These are
test users that were not cleaned up by `afterEach` teardown.

Results appear in the console output and in `test-results/<timestamp>/summary.log`.
The check never fails the gate — it only logs warnings.

The utility lives at `tests/testkit/src/leak-detector.ts` and can be called
independently:

```ts
import { detectTestUserLeaks } from '@testkit/leak-detector';
const count = await detectTestUserLeaks();
```

## CI Pipeline

A GitHub Actions workflow (`.github/workflows/test.yml`) runs on every push to
`main` and every pull request targeting `main`.

### Jobs

1. **static-and-unit** — lint, typecheck, svelte-check, unit tests (no
   Supabase needed)
2. **integration-and-e2e** — starts local Supabase, seeds, runs integration,
   API E2E, and browser E2E tests

### Artifacts

On every run (pass or fail), the workflow uploads:

- Playwright HTML report (`playwright-report/`)
- Playwright test results with screenshots/traces (`test-results/`)

Artifacts are retained for 14 days.

### Concurrency

Uses `concurrency.cancel-in-progress` so new pushes to the same branch cancel
stale runs.

## Documentation-Only Changes

If a change only touches documentation files and does not affect runtime code,
tooling, migrations, tests, or environment contracts, code quality gates are
optional.

For documentation-only changes, validate instead:

- command accuracy
- path and link correctness
- cross-document consistency
- stale references to old suite names or locations
