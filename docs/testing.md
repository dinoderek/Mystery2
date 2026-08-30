# Testing Strategy

## Goals

- exercise pure logic, the running game, and the browser UX at the correct
  layer
- keep local and CI runs deterministic by default
- make it obvious which suite to update when a change crosses a boundary
- preserve one final quality gate: `npm test` for every non-documentation change

## Suite Map

| Suite | Locations | Runner | Runs a server | AI mode | Command |
| --- | --- | --- | --- | --- | --- |
| API/shared unit | `tests/api/unit` | Vitest | No | None or mocked in-process | `npm run test:unit` |
| Web unit | `web/src/lib/**/*.test.ts` | Vitest | No | None | `npm -w web run test:unit` |
| Integration | `tests/api/integration`, helpers in `tests/testkit` | Vitest via `scripts/run-mock-tests.mjs` | Yes — the built server | Mock provider | `npm run test:integration` |
| API E2E | `tests/api/e2e`, helpers in `tests/testkit` | Vitest via `scripts/run-mock-tests.mjs` | Yes — the built server | Mock provider | `npm run test:e2e` |
| Browser E2E | `web/e2e` | Playwright | Yes — `vite dev`, via `webServer` | Mock provider | `npm -w web run test:e2e` |

**Every suite is self-contained.** The two API suites build the game and start
it against a temporary config root; the browser suite runs the dev server
against one of its own. Nothing has to be running first, and no suite can touch
the database you have been playing on.

## Suite Responsibilities

### 1) API/shared unit

Use this suite for fast validation of logic that does not need a running local
stack.

Update this suite when changing:

- shared contracts and schema validation
- prompt construction, parsing, and AI-provider helper logic
- blueprint generation, evaluation, and image-generation helpers
- the local adapter: repositories, content loading, profile resolution, schema
- mock provider behavior in `packages/game-engine/src/ai-provider.ts`

Expected coverage includes:

- domain logic and request/response schema validation
- blueprint generator, evaluator, and image utility behavior
- mock AI role output and provider-selection unit coverage
- ownership isolation, sequence allocation, and the `game_events` cascade,
  against a throwaway database (`tests/api/unit/local-engine-*.test.ts`)

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

Use this suite for one endpoint at a time against a running server.

Update this suite when changing:

- an endpoint handler or a shared engine module
- shared API contracts used by the endpoints
- profile gating, session ownership, or schema
- AI profile resolution, provider selection, or the default profile

Dependencies:

- the blueprints committed in `blueprints/` — the fixtures are deterministic
- test helpers in `tests/testkit` (`server.ts`) and
  `tests/api/integration/helpers.ts`

Expected coverage includes:

- unauthenticated rejection and signed-in success
- session ownership: another profile can neither read nor write yours
- session lifecycle writes and reads
- persisted event payloads, diagnostics, and state transitions
- session catalog behavior
- blueprint image serving, and the reference check that gates it
- AI profile runtime resolution and default/mock behavior

Never call OpenRouter here. The server runs with the mock provider; assert
persisted side effects instead — `readStoredSession()` and
`readStoredEvents()` read the run's database directly.

### 4) API E2E

Use this suite for full player journeys through the API without the browser
UI.

Update this suite when changing:

- multi-step gameplay flows across endpoints
- session start/resume/endgame lifecycle
- AI-profile-dependent API journeys
- seeded mock narration or API expectations that span multiple turns

Dependencies:

- the blueprints committed in `blueprints/`
- test helpers in `tests/testkit`

Expected coverage includes:

- new-game flow and resumable-session flow
- move, search, talk, ask, end-talk, and accuse journeys
- mock-profile-backed end-to-end API behavior

### 5) Browser E2E

Use this suite for browser navigation, profile UX, rendering, and retry
behavior.

Update this suite when changing:

- route protection and the profile picker
- terminal rendering, command entry UX, loading states, and retries
- session list navigation
- theme commands and browser persistence
- image rendering and its failure UX

Dependencies:

- the dev server, started by Playwright's `webServer` against a database of the
  run's own (`web/e2e/global-setup.ts` empties it first)
- Playwright browser binaries matching the pinned `@playwright/test` version

Install the browsers once per machine, and again after any `@playwright/test`
version bump:

```bash
npx playwright install chromium webkit
```

The binaries are keyed to the Playwright version, so a bump invalidates the
existing ones and every browser test fails with
`browserType.launch: Executable doesn't exist at ...`. CI reinstalls
automatically: its cache key hashes `package-lock.json` and `web/package.json`,
so a version bump misses the cache and triggers a fresh install.

Expected coverage includes:

- login, logout, redirect, and refresh-failure flows
- command submission and parser-to-backend wiring
- retry and error UX
- transcript, speaker labels, and terminal loading indicators
- in-progress/completed session navigation
- theme commands and persistence
- image rendering and placeholder fallback

Keep this suite high value. Prefer integration tests for backend behavior and
reserve Playwright for browser-specific user journeys.

## Change-To-Test Mapping

- shared logic, parser behavior, prompt builders, script helpers, and pure
  contract validation -> unit tests
- endpoints, profile gating, ownership, schema, content loading, and API
  contracts -> integration tests
- multi-endpoint player journeys -> API E2E
- browser profile/navigation/rendering/retry UX -> browser E2E

When a change crosses more than one boundary, update every affected suite. For
example, a change to AI output contracts may require:

- unit updates for `packages/game-engine/src/ai-provider.ts`
- integration updates for endpoint payloads and profile resolution
- API E2E updates if mock narration or session flow assertions change
- browser E2E updates only if the rendered UX or retry behavior changes

## Agent Workflow

- Use focused suites while iterating.
- Before finalizing any non-documentation change, run `npm test`.
- Nothing needs restarting after an engine edit. `npm run test:integration`
  and `npm run test:e2e` rebuild the app before each run, and the browser
  suite's dev server reloads it.
- If you changed AI contracts, prompts, runtime context, or provider selection,
  update the mock provider unit coverage in
  `tests/api/unit/ai-provider.test.ts` and any affected integration or API E2E
  assertions.
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

Each API suite run gets its **own database**, created fresh in a temporary
config root and deleted afterwards. There is nothing to reset between tests and
nothing to leak between runs.

Within a run, tests still share that database, so each is responsible for:

1. creating its own profile via `setupApiTestAuth(tag)`
2. scoping assertions to its own identifiers
3. avoiding global count assertions without scoping

There is no cleanup step and no leak detection, because there is nothing left
behind to detect.

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
6. `npm run check:curated-docs`

**Phase 2 (serial — each starts a server on the same port):**

7. `npm run test:integration`
8. `npm run test:e2e`
9. `npm -w web run test:e2e`

Phase 2 only runs if all phase 1 steps pass.

**Every step runs in every environment.** The gate needs nothing installed
beyond this repo — no Docker, no CLI, no seeding — so there is no waiver and no
condition under which a suite may be reported as skipped. If a suite cannot
start, that is a bug to fix, not a partial run to report.

`check:curated-docs` verifies that the curated extracts in
`evaluation/generator-harness/template/docs/` still match the git blob hashes of
the repo docs they were derived from. It needs no network, which is why it sits
in Phase 1. On drift, regenerate the affected extract against its current source
and update the hash in the same change — refreshing the hash alone silences the
check without fixing the doc. See
`evaluation/generator-harness/template/README.md`.

Focused sub-scripts are for iteration only. They do not replace the final
`npm test` gate.

Documentation sync is still required alongside that gate whenever setup,
runtime behavior, testing workflow, or debugging guidance changes.

### Script behavior

`npm run test:integration` and `npm run test:e2e`
(`scripts/run-mock-tests.mjs`):

1. build the web app (`npm -w web run build`)
2. start `node build/index.js` against a temporary config root, on the
   worktree's port
3. wait for it to answer, failing fast if something else already holds the port
4. run Vitest on the suite, passing the server URL and config root through
   `MYSTERY_TEST_API_URL` / `MYSTERY_TEST_CONFIG_ROOT`
5. stop the server and delete the config root

Using the production build rather than the dev server is deliberate: it is the
artefact `npm run build` produces, and running it here is what catches a
bundling failure before someone deploys one.

`npm -w web run test:e2e`:

1. starts the dev server through Playwright's `webServer` configuration,
   against a config root of its own that `global-setup.ts` empties first
2. runs Playwright browser E2E against it
3. removes that config root in `global-teardown.ts`

### Shared-suite execution

- Treat integration, API E2E, and browser E2E as serialized within a single
  checkout or worktree.
- Within one checkout, they share the worktree's port. Do not run more than one
  at the same time from separate terminals — the second will fail fast rather
  than test against the first one's server.
- Across worktrees, they can run concurrently because each worktree gets its
  own port. See
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
- resilient handling of retriable `503` failures

There is no profile to seed: `scripts/run-live-ai.mjs` starts the server with
the mode's AI env, so the sessions those tests play reach the real model.

See [`docs/ai-configuration.md`](ai-configuration.md) for the canonical local
profile and reseeding rules.

## Ownership And Boundary Minimum Bar

Ownership is enforced in the engine's repositories, with no database layer
underneath to catch a query that forgets. Integration coverage must therefore
prove, at minimum:

- profile A can create and read its own sessions
- profile B can neither read nor mutate profile A's session, through any
  endpoint that takes a `game_id`
- image bytes are served only to a signed-in profile, and only for an image the
  blueprint references
- every endpoint rejects a missing cookie and a cookie naming a profile that
  does not exist

`tests/api/integration/session-ownership.test.ts` and `unauthenticated.test.ts`
are where that bar lives.

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

- the server's own stdout, which the suite runner inherits — every handler
  logs structured JSON per request
- `readStoredSession()` / `readStoredEvents()` for what was actually persisted

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

- **API/shared unit coverage**: `packages/game-engine/src/**/*.ts`,
  `packages/shared/src/**/*.ts`
- **Web unit coverage**: `src/lib/**/*.ts`, `src/lib/**/*.svelte`

Integration and E2E suites do not collect coverage (they test through HTTP
boundaries).

## CI Pipeline

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push to
`main` and every pull request targeting `main`.

### Jobs

One: **gate**, which runs `npm test`. The whole suite needs nothing but this
repo and Playwright's browsers, so there is nothing to provision and no reason
to split it.

### Artifacts

The workflow uploads the gate's per-step logs on every run, and Playwright's
HTML report with screenshots and traces on failure.

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
