# Testing Strategy

## Suite Map

| Suite           | Location                                | Runner                                  | Server                     | AI                         | Command                    |
| --------------- | --------------------------------------- | --------------------------------------- | -------------------------- | -------------------------- | -------------------------- |
| API/shared unit | `tests/api/unit`                        | Vitest                                  | No                         | None, or mocked in-process | `npm run test:unit`        |
| Web unit        | `web/src/lib/domain`, `web/src/lib/api` | Vitest                                  | No                         | None                       | `npm -w web run test:unit` |
| Integration     | `tests/api/integration`                 | Vitest via `scripts/run-mock-tests.mjs` | Built server               | Mock provider              | `npm run test:integration` |
| API E2E         | `tests/api/e2e`                         | Vitest via `scripts/run-mock-tests.mjs` | Built server               | Mock provider              | `npm run test:e2e`         |
| Browser E2E     | `web/e2e`                               | Playwright                              | `vite dev` via `webServer` | Mock provider              | `npm -w web run test:e2e`  |

Every suite is self-contained: it builds or starts what it needs against a
temporary config root and deletes it afterwards, so nothing has to be running
first and no suite can touch the database you play on.

Shared helpers live in `tests/testkit`; the integration suite adds
`tests/api/integration/helpers.ts`. Integration and API E2E depend on the
deterministic fixtures committed in `blueprints/`.

## Which Suite To Update

- shared contracts and schema validation; the command grammar; prompt construction, parsing, and
  AI-provider helpers; blueprint generation, evaluation, and image helpers; the
  local adapter (repositories, content loading, profile resolution, schema);
  mock provider behavior → **API/shared unit**
- retry classification; store behavior;
  speaker mapping and other client-only transcript transforms → **web unit**
- endpoints, profile gating, session ownership, schema, content loading, API
  contracts, AI profile resolution and provider selection → **integration**
- multi-endpoint player journeys; session start/resume/endgame lifecycle →
  **API E2E**
- what the player reads across a whole game → **golden transcripts** (below)
- route protection and the profile picker; terminal rendering, command entry,
  loading states, retries; session list navigation; speaker colours; image
  rendering and its failure UX → **browser E2E**

A change that crosses boundaries updates every affected suite. An AI output
contract change, for example, touches unit, integration, API E2E, and browser
E2E only if the rendered UX or retry behavior changes.

Prefer integration tests for backend behavior; Playwright is for browser journeys.

## Running

### The gate

`npm test` runs `scripts/run-test-gate.mjs`; the `GATE_STEPS` list in
`scripts/lib/gate-steps.mjs` is the definitive set. Phase 1 runs in parallel:
lint, typecheck, `svelte-check`, `quality` and `imports` (below), both unit
suites with coverage, the three doc checks, `gate-coverage` (below) and `coverage-floors`
(see Coverage), which starts once both unit suites finish. Phase 2 runs only if all of
phase 1 passed, one step at a time because each starts a server on the
worktree's port: integration, API E2E, browser E2E.

**Every step runs in every environment.** The gate needs nothing beyond this
repo; no suite may be reported as skipped, and one that cannot start is a bug
to fix. Focused scripts are for iteration; re-run the gate after any later edit.

Integration and API E2E run against the production build (`node build/index.js`),
not the dev server, so a bundling failure is caught. The build gets the run's
config root too, and fails the step if it opens a database. The runner fails if
anything already holds the port, which would otherwise be tested instead. The browser suite starts `vite dev` through
Playwright's `webServer`. Each gets a config root of its own, deleted afterwards.

**Every test file runs in the gate.** `scripts/lib/gate-steps.mjs` is the one
list of where tests live: each step that runs tests names its `roots` and the
`files` pattern its runner collects, and the Vitest steps build their command
from the roots. `gate-coverage` lists test files from git (tracked, plus
untracked files git does not ignore) and fails, by name, on any under no step's
roots or matching no step's pattern: it
would pass by hand and never run here. It checks every step, even when named
alone (`./dev test gate-coverage`). To add a suite, add its root to a step or
add a step. `integration` and `e2e-api` hand their roots to
`scripts/run-mock-tests.mjs`; keep the `e2e-browser` root in step with the
`testDir` in `web/playwright.config.ts`, and the patterns with each runner's
include.

**Quality limits and layer rules.** `quality` holds each function in engine,
shared and web TypeScript (not tests or `.svelte`) to cognitive complexity 25,
200 lines, nesting 4 and 5 parameters; `imports` holds the rules in
`scripts/lib/import-rules.mjs`, among them that only the engine imports the
command grammar, `web/` and `evaluation/` included. Pre-existing offenders sit in
`quality-baseline.json` and `imports-baseline.json`, which only shrink: a new
offender fails, and so does a stale entry. After a fix, `npm run check:quality
-- --prune` or `npm run check:imports -- --prune` drops it.

The three doc checks:

- `check:curated-docs` holds the curated extracts in
  `evaluation/generator-harness/template/docs/` to the doc sections they
  summarise. On drift it names the commit to diff against; fix the extract if
  it no longer holds, then record the new hash: a refreshed hash over stale
  prose fixes nothing. Details:
  `evaluation/generator-harness/template/README.md`.
- `check:doc-refs` fails when `AGENTS.md`, `QUICKSTART.md`, `docs/` or a README
  names a path, an `npm run` script or a relative link that does not exist. A
  code span counts as a path only when its first segment is a real directory;
  gitignored paths are skipped; the harness templates are not checked.
- `check:word-budgets` fails when a Markdown file is over its word budget, has
  no row in `docs/word-budgets.tsv`, or a row names a file that does not exist.
  It lists files as `gate-coverage` does, so a doc not yet added counts. Every
  `.md` counts, including harness templates, judges, personas and prompts.
  Words are counted as `wc -w` counts them; symlinks such as `CLAUDE.md` are
  skipped and answer to their target's row.
  Budgets sit at each file's count when set, rounded up to the next 50. Raising
  one is the operator's decision: trim the doc, or ask
  the operator to raise its row.

### Concurrency

Integration, API E2E, and browser E2E share the worktree's port, so run only
one at a time within a checkout; a second fails fast. Worktrees each get their
own port and can run concurrently
([`docs/local-infrastructure.md`](local-infrastructure.md)).

### Playwright browsers

Install once per machine, and again after any `@playwright/test` version bump:

```bash
npx playwright install chromium
```

Binaries are keyed to the Playwright version: after a bump every browser test
fails with `browserType.launch: Executable doesn't exist at ...`. CI reinstalls
itself.

### Live-AI suites (opt-in)

Excluded from `npm test`, never a substitute for it:

- `npm run test:integration:live:free` / `:paid`
- `npm run test:e2e:live:free` / `:paid`
- `npm run test:blueprint:live:free` / `:paid`
- `AI_LIVE=1 npm -w web run test:e2e -- web/e2e/live-ai.spec.ts`

They require `AI_LIVE=1`, a `.env.ai.free.local` or `.env.ai.paid.local`, and
tolerance of retriable `503`s. `scripts/run-live-ai.mjs` starts the server with
the mode's AI env. See
[`docs/ai-configuration.md`](ai-configuration.md).

## Reading The Results

Each `npm test` run writes `test-results/<timestamp>/` (the last five are
kept): a log per step, `summary.log` and `coverage.log`. In `summary.log`,
the `Total` line is the verdict; the coverage section after it never changes
the exit code. Read the file, not scrollback.

For a failure, also look at the server's stdout (structured JSON per request),
`readStoredSession()` and `readStoredEvents()` in
`tests/api/integration/helpers.ts` for what was persisted, and for Playwright
`web/playwright-report/` and `web/test-results/`.

## Coverage

`coverage-floors.json` holds the floors, as percentages of the unit suites'
totals: engine and shared 80% lines and 80% branches; web TypeScript, `.svelte`
excluded, 80% lines and 75% branches. The `coverage-floors` step fails, naming
the project and measure, when one falls short or reads `not measured`; it needs
the unit steps in the same run. Anyone may raise a
floor; lowering one, or excluding code from what is measured, is the operator's decision. If tests that
prove behaviour cannot reach a floor, ask rather than lower it.

The measured globs are the `coverage.include` arrays in `vitest.config.ts` and
`web/vite.config.ts`; a new source directory outside them is invisible until
added. `summary.log` lists files at or below `LOW_FILE_THRESHOLD`
(`scripts/lib/coverage-report.mjs`) by uncovered statements, not percentage.

**The numbers come from the unit suites alone.** Integration and E2E drive a
separate server process this instrumentation does not see, so every file under
`packages/game-engine/src/endpoints/` reads 0% while API E2E exercises it, as
browser E2E does for `web/src/lib/components/`. A listed file is a
reason to act only when its boundary is unit ([Which Suite To
Update](#which-suite-to-update)).

## Golden transcripts

`tests/api/e2e/golden-transcripts.test.ts` plays the games in
`tests/api/e2e/golden/games.ts` over HTTP under the mock narrator and compares
what the player would see (lines, speakers, page breaks, mode, turns left) with
`tests/api/e2e/golden/transcripts/`. They cover every command and refusal, the
budget running out, and a won and a lost accusation,
so they prove the game reads the same however a line reaches it. Only
`tests/testkit/src/golden/driver.ts` knows how a line becomes requests. A
resumed game is not compared. The mock
quotes the start of the narrator prompt, so editing it changes every
transcript. The gate only compares; change a transcript on purpose with
`npm run test:golden:record` and review the diff.

## Writing Tests

### Isolation

Each API suite run gets its own database in a temporary config root. Within a
run tests share it, so each must create its own profile via `setupApiTestAuth(tag)`, scope assertions to its own identifiers, and avoid
unscoped global count assertions.

Anything that opens a database directly must be given an explicit path — never
`resolveDatabasePath()`, which points at the database you play on.

### Mock data

Fixtures are typed against the Zod schemas in `packages/shared/src/`
(`mystery-api-contracts.ts`, `blueprint-schema-v2.ts`).

- Use the factories and constants in `tests/testkit/src/fixtures.ts`; never
  hand-write inline objects for shapes that have a Zod schema.
- Factories call `Schema.parse()` at creation, so a renamed or newly required
  field fails at once.
- Pass only the overrides that differ from the defaults.
- A new response type in the shared schemas needs its factory.
- For shapes with a TypeScript type but no Zod schema, annotate the mock
  explicitly so `npm run typecheck` catches drift.

### Boundaries that must stay proven

Ownership is enforced in the engine's repositories, with no database layer
underneath to catch a query that forgets, and the two access behaviours
(`docs/architecture.md`) are a property of the endpoint registry that nothing
else checks. Integration must prove at minimum:

- profile A can create and read its own sessions
- profile B can neither read nor mutate profile A's session, through any
  endpoint taking a `game_id`
- every endpoint that manages or plays a session rejects a missing cookie, and
  a cookie naming a profile that does not exist
- every endpoint over shared content answers without a cookie at all
- image bytes are served for an image the blueprint references, and only for
  those
- every endpoint that takes fields answers a missing or wrong one with `400`
  naming it, and a name outside the registry answers `404`

That bar lives in `tests/api/integration/session-ownership.test.ts`,
`unauthenticated.test.ts` and `request-validation.test.ts`.

Integration and E2E never call a real model. The server runs the mock provider;
assert persisted side effects instead.

Mock is chosen by absence: the config root has no `.env.ai.*` and the settings
row is empty. That row can be changed over the API. **A test that switches the server to live switches
it for every test sharing that server**, and their calls reach the real API.

So no suite that shares a server with game-playing tests may switch the mode to
live; assert that in the unit suites (`ai-settings-store.test.ts`,
`local-engine-ai-profile.test.ts`). The suites that do change the row
(`tests/api/integration/ai-settings.test.ts`, `web/e2e/ai-settings.spec.ts`)
reset it around each test and leave it on mock. As a backstop,
`scripts/run-mock-tests.mjs` and `web/playwright.config.ts` point
`OPENROUTER_URL` at a closed port and `CLAUDE_CLI_PATH` at a file that does not
exist, so a slip fails fast.

## CI

`.github/workflows/ci.yml` runs the gate on pushes to `main` and on pull
requests, and uploads `test-results/` on every run
and Playwright's report on failure.

## Documentation-Only Changes

For a change to documentation only, the code suites are optional locally; run
`npm run check:curated-docs`, `npm run check:doc-refs` and `npm run
check:word-budgets`: all three fail the gate. Check the
rest by hand: command accuracy, and consistency with the owning doc.
