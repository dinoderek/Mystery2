# Testing Strategy

## Suites

- **API/shared unit**: `tests/api/unit`, Vitest, no server. `npm run test:unit`.
- **Web unit**: `web/src/lib/domain`, `web/src/lib/api`, Vitest. `npm -w web run test:unit`.
- **Integration**: `tests/api/integration`, Vitest on the built server with the mock provider. `npm run test:integration`.
- **API E2E**: `tests/api/e2e`, the same runner and server. `npm run test:e2e`.
- **Browser E2E**: `web/e2e`, Playwright on `vite dev`. `npm -w web run test:e2e`.

Every suite is self-contained: it starts what it needs against a temporary
config root and deletes it afterwards. Nothing has to be running first, and no
suite may touch the database you play on. Shared helpers live in
`tests/testkit`, and `tests/api/integration/helpers.ts`. Integration and API
E2E use the fixtures committed in `blueprints/`.

## Which suite to update

- Contracts, schemas, the command grammar, prompts and parsing, AI-provider
  helpers, the local adapter, the mock provider: **API/shared unit**.
- Retry classification, store behaviour, transcript transforms: **web unit**.
- Endpoints, profile gating, session ownership, content loading, AI profile
  resolution: **integration**.
- Multi-endpoint journeys, session lifecycle: **API E2E**.
- What the player reads across a whole game: **golden transcripts**.
- Routes, the profile picker, terminal rendering, retries, image UX: **browser E2E**.

A change that crosses boundaries updates every affected suite. Prefer
integration tests for backend behaviour; Playwright is for browser journeys.

## The gate

`npm test` runs `scripts/run-test-gate.mjs`. The `GATE_STEPS` list in
`scripts/lib/gate-steps.mjs` is the definitive set. Phase 1 runs in parallel:
lint, typecheck, `svelte-check`, `quality`, `imports`, both unit suites with
coverage, the doc checks, `gate-coverage` and `coverage-floors`, which starts
once both unit suites finish. Phase 2 runs only if phase 1 passed, one step at
a time, since each starts a server on the worktree's port: integration, API E2E,
browser E2E.

**Every step runs in every environment.** No suite may be reported skipped, and
one that cannot start is a bug to fix. Focused scripts are for iteration;
re-run the gate after any later edit.

Integration and API E2E run against the production build (`node build/index.js`),
so a bundling failure is caught. The build gets the run's config root and fails
the step if it opens a database. The runner fails if anything holds the port.

**Every test file runs in the gate.** Each step names its `roots` and `files`
pattern in `gate-steps.mjs`. `gate-coverage` fails, by name, on any test file no
step collects. Keep the `e2e-browser` root in step with `web/playwright.config.ts`.

**Quality and layer rules.** `quality` holds each function in engine, shared
and web TypeScript (not tests or `.svelte`) to cognitive complexity 25, 200
lines, nesting 4 and 5 parameters. `imports` enforces `scripts/lib/import-rules.mjs`.
Existing offenders sit in `quality-baseline.json` and `imports-baseline.json`,
which only shrink: a new offender fails, and so does a stale entry. After a fix,
run `check:quality -- --prune` or `check:imports -- --prune`.

**Doc checks**, all failing the gate:

- `check:curated-docs` holds the extracts in
  `evaluation/generator-harness/template/docs/` to the doc sections they
  summarise. On drift, fix the extract if it no longer holds, then record the
  new hash. A refreshed hash over stale prose fixes nothing
  (`evaluation/generator-harness/template/README.md`).
- `check:doc-refs` fails on a path, `npm run` script or relative link that does
  not exist in `AGENTS.md`, `QUICKSTART.md`, `docs/` or a README. A code span
  counts as a path only when its first segment is a real directory.
- `check:word-budgets` fails when a Markdown file is over its row in
  `docs/word-budgets.tsv`, has no row, or a row names a missing file. Every
  `.md` counts, templates and prompts included, as `wc -w` counts it. Symlinks
  such as `CLAUDE.md` answer to their target's row. Budgets sit at each count
  rounded up to 50. Raising one is the operator's decision: trim the doc, or
  ask.

## Running

Integration, API E2E and browser E2E share the worktree's port, so run one at a
time per checkout. Each worktree has its own port
([`docs/local-infrastructure.md`](local-infrastructure.md)).

- **Playwright.** After any `@playwright/test` bump, run `npx playwright install
  chromium`. Otherwise every browser test fails with `Executable doesn't exist`.
  CI reinstalls itself.
- **Live AI** is opt-in and never a substitute for the gate:
  `npm run test:integration:live:free|paid`, `test:e2e:live:free|paid`,
  `test:blueprint:live:free|paid`, and `AI_LIVE=1 npm -w web run test:e2e --
  web/e2e/live-ai.spec.ts`. They need `AI_LIVE=1`, a `.env.ai.free.local` or
  `.env.ai.paid.local`, and tolerance of retriable `503`s. See
  [`docs/ai-configuration.md`](ai-configuration.md).

## Reading results

Each `npm test` writes `test-results/<timestamp>/` (the last five are kept): a
log per step, `summary.log` and `coverage.log`. The `Total` line in
`summary.log` is the verdict; the coverage section never changes the exit code.

For a failure, also read the server's stdout (JSON per request),
`readStoredSession()` and `readStoredEvents()` in
`tests/api/integration/helpers.ts`, and Playwright's `web/playwright-report/`
and `web/test-results/`.

## Coverage

`coverage-floors.json` holds the floors, as percentages of the unit totals:
engine and shared at 80% lines and 80% branches; web TypeScript without
`.svelte` at 80% lines and 75% branches. The `coverage-floors` step fails, naming
the project and measure, when one falls short or reads `not measured`. Anyone
may raise a floor. Lowering one, or excluding code, is the operator's decision:
if behaviour-proving tests cannot reach a floor, ask.

Measured globs are the `coverage.include` arrays in `vitest.config.ts` and
`web/vite.config.ts`; a new source directory is invisible until added. Only unit
suites feed the numbers, so endpoints and components read 0% under the E2E
suites. A listed file is a reason to act only when its boundary is unit.

## Golden transcripts

`tests/api/e2e/golden-transcripts.test.ts` plays the games in
`tests/api/e2e/golden/games.ts` over HTTP under the mock narrator, and compares
what the player would see (lines, speakers, page breaks, mode, turns left) with
`tests/api/e2e/golden/transcripts/`. The games cover every command and refusal,
the budget running out, and a won and a lost accusation. Only
`tests/testkit/src/golden/driver.ts` knows how a line becomes requests. A
resumed game is not compared.

The mock quotes the start of the narrator prompt, so editing it changes every
transcript. The gate only compares. Re-record on purpose with `npm run
test:golden:record`, and review the diff.

## Writing tests

- **Isolation.** Each API run gets its own database in a temporary config root,
  shared by its tests. Each test creates its own profile with
  `setupApiTestAuth(tag)`, scopes assertions to its own identifiers, and avoids
  unscoped global counts. Anything that opens a database gets an explicit path,
  never `resolveDatabasePath()`, which points at the database you play on.
- **Fixtures.** Use the factories in `tests/testkit/src/fixtures.ts`. Never
  hand-write an object for a shape with a Zod schema in `packages/shared/src/`.
  Factories parse at creation, so a renamed field fails at once. Pass only the
  overrides that differ. A new response type needs its factory. For a shape with
  a TypeScript type and no schema, annotate the mock so `typecheck` catches drift.
- **Boundaries that stay proven** (`session-ownership.test.ts`,
  `unauthenticated.test.ts`, `request-validation.test.ts`). Ownership lives in
  the engine's repositories, with nothing beneath to catch a forgotten query, so
  integration must prove:
  - profile A reads and creates its own sessions; profile B can neither read
    nor mutate them through any endpoint taking a `game_id`;
  - every session endpoint rejects a missing cookie or an unknown profile, and
    every shared-content endpoint answers without one;
  - image bytes are served only for images the blueprint references;
  - a missing or wrong field answers `400` naming it, and a name outside the
    registry answers `404`.
- **No real model.** Integration and E2E never call one. The server runs the
  mock provider, so assert persisted side effects.
- **Mock by absence.** Mock is chosen when the config root has no `.env.ai.*`
  and the settings row is empty. That row can be changed over the API, and a
  test that switches to live switches it for every test sharing the server. So
  no suite that shares a server with game-playing tests may switch to live.
  Assert that in the unit suites (`ai-settings-store.test.ts`,
  `local-engine-ai-profile.test.ts`). The suites that change the row
  (`tests/api/integration/ai-settings.test.ts`, `web/e2e/ai-settings.spec.ts`)
  reset it around each test. As a backstop, `scripts/run-mock-tests.mjs` and
  `web/playwright.config.ts` point `OPENROUTER_URL` at a closed port and
  `CLAUDE_CLI_PATH` at a missing file.

## CI and documentation-only changes

`.github/workflows/ci.yml` runs the gate on pushes to `main` and on pull
requests, and uploads `test-results/` (and Playwright's report on failure). A
documentation-only change runs `check:curated-docs`, `check:doc-refs` and
`check:word-budgets`, and has its commands checked by hand.
