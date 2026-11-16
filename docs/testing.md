# Testing Strategy

## Suites

- **API/shared unit**: `tests/api/unit`, Vitest, no server. Contracts, schemas,
  the command grammar, prompts and parsing, AI-provider helpers, generation and
  evaluation, image helpers, the local adapter. `npm run test:unit`.
- **Web unit**: `web/src/lib/domain`, `web/src/lib/api`, Vitest. Retry
  classification, store behaviour, transcript transforms. `npm -w web run test:unit`.
- **Integration**: `tests/api/integration`, Vitest on the built server with the
  mock provider. Endpoints, profile gating, session ownership, schema, content
  loading, AI provider selection. `npm run test:integration`.
- **API E2E**: `tests/api/e2e`, same runner. Multi-endpoint journeys; session
  start, resume and endgame. `npm run test:e2e`.
- **Golden transcripts**: what the player reads across a game.
- **Browser E2E**: `web/e2e`, Playwright on `vite dev`. Route protection, profile picker, session list, speaker colours, command
  entry, loading states, retries, images. `npm -w web run test:e2e`.

Each suite starts what it needs in a temporary config root, deletes it
afterwards, and never touches your play database. Helpers:
`tests/testkit`; integration and E2E use the `blueprints/`
fixtures. Changes update every affected suite. Prefer
integration tests for backend behaviour. Playwright is for browser journeys.

## The gate

`npm test` runs `scripts/run-test-gate.mjs`. `GATE_STEPS` in
`scripts/lib/gate-steps.mjs` defines the steps. Phase 1 runs in parallel:
lint, typecheck, `svelte-check`, `quality`, `imports`, both unit suites with
coverage, the doc checks, `gate-coverage`, `tracked-files`, and
`coverage-floors`, which starts
once both unit suites finish. Phase 2 runs only if phase 1 passed, one step at a
time: integration, API E2E, browser E2E.

**Every step runs in every environment.** The gate needs nothing beyond this
repo. No suite may be reported skipped; one that cannot start is a bug.

Integration and API E2E run against the production build (`node build/index.js`),
so a bundling failure shows. The build gets the run's config root and fails
the step if it opens a database. The runner fails if anything holds the port.

**Every test file runs in the gate.** Steps name their `roots` and `files`
pattern in `gate-steps.mjs`. To add a suite, add its root to a step or add a step,
and keep the pattern in step with the runner's include. `gate-coverage` fails,
by name, on any test file no step collects, counting untracked files git does
not ignore. It runs even when named alone (`./dev test gate-coverage`). Keep the
`e2e-browser` root in step with `testDir` in `web/playwright.config.ts`.

**Quality and layer rules.** `lint`, `quality` and `imports` also cover
`evaluation/`, `scripts/` and `lib/`. `quality` holds each function (not tests or
`.svelte`) to cognitive complexity 25, 200 lines, nesting 4 and 5 parameters.
`imports` enforces `scripts/lib/import-rules.mjs`, including what `evaluation/`
may import and who may start a model subprocess or resolve the play database.
Offenders sit in `quality-baseline.json` and `imports-baseline.json`, which only
shrink: a new offender or a stale entry fails. After a fix, run
`npm run check:quality -- --prune` or `npm run check:imports -- --prune`.

**Doc checks**, all failing the gate:

- `check:curated-docs` holds the extracts in
  `evaluation/generator-harness/template/docs/` to the doc sections they
  summarise. On drift, fix the extract if it no longer holds, then record the
  new hash. A refreshed hash over stale prose fixes nothing
  (`evaluation/generator-harness/template/README.md`).
- `check:doc-refs` fails when any `AGENTS.md`, `QUICKSTART.md`, `docs/` or
  README names a path, `npm run` script or relative link that does not exist.
  A code span counts as a path only when its first segment is a real directory. Gitignored
  paths and harness templates are skipped.
- `check:word-budgets` fails when a Markdown file is over its row in
  `docs/word-budgets.tsv`, has no row, or a row names a missing file. Every
  `.md` counts, including files not yet added to git, as `wc -w` counts it.
  Symlinks such as `CLAUDE.md` answer to their target's row. Budgets sit at
  each count rounded up to 50. Raising one is the operator's decision: trim the
  doc, or ask.

## Running

Integration, API E2E and browser E2E share the worktree's port: run one at a
time per checkout ([`docs/local-infrastructure.md`](local-infrastructure.md)).

- **Playwright.** Once per machine, and after any `@playwright/test` bump, run
  `npx playwright install chromium`. Otherwise browser tests fail with
  `Executable doesn't exist`.
- **Live AI** is opt-in, never a gate substitute, and calls only an AI it is
  named, from `ai.json`: `npm run test:integration:live -- <ai>`,
  `test:e2e:live -- <ai>`, `test:blueprint:live -- <ai>` (`openrouter` only).
  They tolerate retriable `503`s. `AI_LIVE=1 npm -w web run test:e2e --
  web/e2e/live-ai.spec.ts` is the browser smoke. How a harness names an AI:
  [`docs/ai-configuration.md`](ai-configuration.md).

## Reading results

Each `npm test` writes `test-results/<timestamp>/` (last five kept): a
log per step, `summary.log` and `coverage.log`. The `Total` line in
`summary.log` is the verdict.
For a failure, also read the server's stdout, `readStoredSession()` and
`readStoredEvents()` (`tests/api/integration/helpers.ts`), and Playwright's report.

## Coverage

`coverage-floors.json` holds the floors, as percentages of the unit totals:
engine and shared 80% lines and 80% branches; web TypeScript without `.svelte`
80% lines and 75% branches; evaluation (`evaluation/**/*.ts`, counted apart from
engine and shared) 90% and 80%, above its 80% and 75% minimum. Every `./dev eval` command's main path runs in the gate on
stub bindings (`play` in integration), never a model. The `coverage-floors`
step fails, naming the project and measure, when one falls short or reads
`not measured`. Anyone may raise a floor. Lowering one, or excluding code, is
the operator's decision: if behaviour-proving tests cannot reach a floor, ask.

Measured globs are the `coverage.include` arrays in `vitest.config.ts` and
`web/vite.config.ts`; a new source directory is invisible until added.
`summary.log` lists files at or below `LOW_FILE_THRESHOLD`
(`scripts/lib/coverage-report.mjs`) by uncovered statements. Unit suites alone
feed the numbers: E2E drives an uninstrumented server, so endpoints and
components read 0%; act on a listed file only when its boundary is unit.

## Evaluation snapshots

`eval-snapshots.test.ts` runs each evaluation harness with its model CLI
swapped for a stub that keeps what it is sent. It compares every prompt (judges,
generator, investigator and its `claude` arguments) and the
verdicts reached on fixed stub answers with `tests/api/unit/snapshots/evaluation/`.
Moving code changes no snapshot. Re-record with `npm run test:snapshots:record`,
read the diff; for judge content, that is the operator's call.

## Golden transcripts

`tests/api/e2e/golden-transcripts.test.ts` plays the games in
`tests/api/e2e/golden/games.ts` over HTTP under the mock narrator, and compares
what the player would see (lines, speakers, page breaks, mode, turns left) with
`tests/api/e2e/golden/transcripts/`. They cover every command and refusal, the
budget running out, and a won and a lost accusation. Only
`tests/testkit/src/golden/driver.ts` knows how a line becomes requests. A resumed game is not compared. The mock quotes the start of the narrator prompt, so
editing it changes every transcript. Re-record on purpose with `npm run
test:golden:record`; review the diff.

## Writing tests

- **Isolation.** Each API run gets a temp database. Each test creates its
  own profile with `setupApiTestAuth(tag)` and scopes assertions to its own
  identifiers, with no unscoped global counts. Anything that opens a database gets an explicit path,
  never `resolveDatabasePath()`, which names your play database.
- **Fixtures.** Use the factories in `tests/testkit/src/fixtures.ts`; never
  hand-write an object for a shape with a Zod schema in `packages/shared/src/`.
  Factories parse at creation: pass only the overrides that differ. A new
  response type needs its factory. For a TypeScript-only shape, annotate the
  mock so `typecheck` catches drift.
- **Boundaries that stay proven** (`session-ownership.test.ts`,
  `unauthenticated.test.ts`, `request-validation.test.ts`). Ownership lives in
  the engine's repositories, with nothing beneath to catch a forgotten query, so
  integration must prove:
  - profile A reads and creates its own sessions; profile B can neither read nor
    mutate them through any endpoint taking a `game_id`;
  - every session endpoint rejects a missing cookie or unknown profile, and every
    shared-content endpoint answers without one;
  - image bytes are served only for images the blueprint references;
  - a missing or wrong field answers `400` naming it; a name outside the registry
    answers `404`.
- **No real model.** Integration and E2E never call one. The server runs the mock
  provider, so assert persisted side effects.
- **Mock by absence.** Mock narrates when the config root has no `ai.json`,
  the runners clear `AI_PROFILE`, and nothing is chosen. A live choice switches
  every test sharing the server, so make one only in the unit suites or on a
  server of the test's own (`tests/testkit/src/own-server.ts`); suites that
  choose reset to mock around each test. The runners also point `OPENROUTER_URL` at
  a closed port and `CLAUDE_CLI_PATH` at a missing file.

## CI and documentation-only changes

`.github/workflows/ci.yml` runs the gate on pushes to `main` and on pull requests,
and uploads `test-results/` and, on failure, Playwright's report. A
documentation-only change runs `check:curated-docs`, `check:doc-refs` and
`check:word-budgets`; the code suites are optional locally. Check commands by hand and against the owning doc.
