# Testing Strategy

## Layers

Unit tests cover logic; integration, against the built server under the mock
provider, covers endpoints, ownership, profiles, schema and content; E2E covers
journeys, over HTTP (`tests/api/e2e`) and in the browser (`web/e2e`). Prefer
integration for backend behaviour; Playwright is for browser journeys. A change updates every suite it affects. Helpers live in `tests/testkit`.

## The gate

`npm test` runs the steps in `scripts/lib/gate-steps.mjs`; `./dev test <step>...`
runs only those named.

**Every step runs in every environment.** The gate needs nothing beyond this
repo. No suite may be reported skipped; one that cannot start is a bug.

Integration and API E2E run against the production build, so a bundling failure
shows; the build fails its step if it opens a database.

**Every test file runs in the gate.** Each step names its `roots` and `files`
pattern; keep them in step with the runner's include (and the `e2e-browser`
root with `testDir` in `web/playwright.config.ts`). `gate-coverage` fails, by
name, on any test file no step collects, untracked ones included.

**Baselines only shrink.** `quality-baseline.json` and `imports-baseline.json`
hold today's offenders against the `quality` limits and
`scripts/lib/import-rules.mjs`: a new offender or a stale entry fails. After a
fix, prune with `npm run check:quality -- --prune` or
`npm run check:imports -- --prune`.

**One case format.** `tests/api/unit/one-case-format.test.ts` fails when any
file or path, untracked ones included, names a retired case format.

**Doc checks**, all failing the gate:

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

A documentation-only change needs the doc checks green and its commands checked
by hand against the owning doc; the code suites are optional locally.

## Running

Integration, API E2E and browser E2E share the worktree's port: run one at a
time per checkout ([`docs/local-infrastructure.md`](local-infrastructure.md)).

Live AI runs (the `test:*:live` scripts) are opt-in, never a gate substitute,
and call only an AI they are named, from `ai.json`
([`docs/ai-configuration.md`](ai-configuration.md)). They tolerate retriable
`503`s.

## Reading results

Each `npm test` writes `test-results/<timestamp>/`: a log per step,
`summary.log` and `coverage.log`. The `Total` line in `summary.log` is the
verdict. For a failure, also read the server's stdout, `readStoredSession()` and
`readStoredEvents()` (`tests/api/integration/helpers.ts`), and Playwright's
report.

## Coverage

`coverage-floors.json` holds the floors, and the `coverage-floors` step fails
when a project falls short or reads `not measured`. Anyone may raise a floor.
Lowering one, or excluding code, is the operator's decision: if
behaviour-proving tests cannot reach a floor, ask.

Only the unit suites feed the numbers, and only the `coverage.include` globs in
`vitest.config.ts` and `web/vite.config.ts` count: a new source directory is
invisible until added. E2E drives an uninstrumented server, so endpoints and
components read 0%; act on a low file in `summary.log` only when its boundary is
unit. Every `./dev eval` command's main path runs in the gate on stub bindings,
never a model.

## Evaluation snapshots

`eval-snapshots.test.ts` runs each evaluation harness with its model CLI
swapped for a stub that keeps what it is sent, and compares every prompt and the
verdicts reached on fixed stub answers with
`tests/api/unit/snapshots/evaluation/`. Moving code changes no snapshot.
Re-record with `npm run test:snapshots:record` and read the diff; for judge
content, that is the operator's call.

## Golden transcripts

`tests/api/e2e/golden-transcripts.test.ts` plays fixed games over HTTP under
the mock narrator and compares what the player would see with
`tests/api/e2e/golden/transcripts/`. Only `tests/testkit/src/golden/driver.ts`
knows how a line becomes requests. The mock narrates from the case and the
context it is given, so changing either moves the transcripts. Re-record on
purpose with `npm run test:golden:record`; review the diff.

## Writing tests

- **Isolation.** Each API run gets a temporary config root and database, and
  never touches your play database. Each test creates its own profile with
  `setupApiTestAuth(tag)` and scopes assertions to its own identifiers, with no
  unscoped global counts. Anything that opens a database gets an explicit path,
  never `resolveDatabasePath()`, which names your play database.
- **Fixtures.** A test that plays a case plays the mock case,
  `blueprints/clue-graph/mock-case.json` (`tests/testkit/src/mock-case.ts`).
  Its scenes (`tests/testkit/src/mock-case-scenes.json`) are written into each
  test config root, since `blueprint-scenes/` ships none.
  Use the factories in `tests/testkit/src/fixtures.ts`; never
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
  choose reset to mock around each test. The runners also point the live
  backends at a closed port and a missing executable.
