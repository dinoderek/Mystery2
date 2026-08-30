# Testing Strategy

## Suite Map

| Suite           | Location                | Runner                                  | Server                     | AI                         | Command                    |
| --------------- | ----------------------- | --------------------------------------- | -------------------------- | -------------------------- | -------------------------- |
| API/shared unit | `tests/api/unit`        | Vitest                                  | No                         | None, or mocked in-process | `npm run test:unit`        |
| Web unit        | `web/src/lib/domain`    | Vitest                                  | No                         | None                       | `npm -w web run test:unit` |
| Integration     | `tests/api/integration` | Vitest via `scripts/run-mock-tests.mjs` | Built server               | Mock provider              | `npm run test:integration` |
| API E2E         | `tests/api/e2e`         | Vitest via `scripts/run-mock-tests.mjs` | Built server               | Mock provider              | `npm run test:e2e`         |
| Browser E2E     | `web/e2e`               | Playwright                              | `vite dev` via `webServer` | Mock provider              | `npm -w web run test:e2e`  |

Every suite is self-contained: it builds or starts what it needs against a
temporary config root and deletes it afterwards. Nothing has to be running
first, and no suite can touch the database you play on.

Shared helpers live in `tests/testkit`; the integration suite adds
`tests/api/integration/helpers.ts`. Integration and API E2E depend on the
blueprints committed in `blueprints/`, which are deterministic fixtures.

## Which Suite To Update

- shared contracts and schema validation; prompt construction, parsing, and
  AI-provider helpers; blueprint generation, evaluation, and image helpers; the
  local adapter (repositories, content loading, profile resolution, schema);
  mock provider behavior → **API/shared unit**
- parser and command normalization; retry classification; store and theme-store
  behavior; speaker mapping and other client-only transcript transforms →
  **web unit**
- endpoints, profile gating, session ownership, schema, content loading, API
  contracts, AI profile resolution and provider selection → **integration**
- multi-endpoint player journeys; session start/resume/endgame lifecycle →
  **API E2E**
- route protection and the profile picker; terminal rendering, command entry,
  loading states, retries; session list navigation; theme commands and
  persistence; image rendering and its failure UX → **browser E2E**

A change that crosses boundaries updates every affected suite. An AI output
contract change, for example, touches unit
(`packages/game-engine/src/ai-provider.ts`), integration (endpoint payloads,
profile resolution), API E2E (mock narration, session flow), and browser E2E
only if the rendered UX or retry behavior changes.

Prefer integration tests for backend behavior; reserve Playwright for
browser-specific journeys.

## Running

### The gate

`npm test` (alias `npm run test:gate`) runs `scripts/run-test-gate.mjs`.

Phase 1, parallel:

1. `npm run lint`
2. `npm run typecheck`
3. `npm -w web run check`
4. `npm run test:unit:coverage`
5. `npm -w web run test:unit:coverage`
6. `npm run check:curated-docs`

Phase 2, serial (each starts a server on the worktree's port), and only if all
of phase 1 passed:

7. `npm run test:integration`
8. `npm run test:e2e`
9. `npm -w web run test:e2e`

**Every step runs in every environment.** The gate needs nothing beyond this
repo — no Docker, no CLI, no seeding — so there is no waiver and no condition
under which a suite may be reported as skipped. A suite that cannot start is a
bug to fix, not a partial run to report.

Focused sub-scripts are for iteration only; they do not replace the gate. Run
the gate before finalizing any non-documentation change, and re-run it if you
edit after it passes.

Nothing needs restarting after an engine edit: the phase 2 scripts rebuild
before each run, and the browser suite's dev server reloads.

`check:curated-docs` verifies that the curated extracts in
`evaluation/generator-harness/template/docs/` still match the git blob hashes of
the docs they came from. On drift, regenerate the affected extract against its
current source and update the hash in the same change — refreshing the hash
alone silences the check without fixing the doc. See
`evaluation/generator-harness/template/README.md`.

### What the suite scripts do

`npm run test:integration` and `npm run test:e2e`
(`scripts/run-mock-tests.mjs`):

1. build the web app (`npm -w web run build`)
2. start `node build/index.js` against a temporary config root, on the
   worktree's port
3. wait for it to answer, failing fast if something else holds the port
4. run Vitest, passing `MYSTERY_TEST_API_URL` and `MYSTERY_TEST_CONFIG_ROOT`
5. stop the server and delete the config root

The production build is used rather than the dev server so that a bundling
failure is caught here.

`npm -w web run test:e2e` starts the dev server through Playwright's
`webServer` against a config root of its own, which `web/e2e/global-setup.ts`
empties first and `global-teardown.ts` removes.

### Concurrency

Integration, API E2E, and browser E2E share the worktree's port, so run only
one at a time within a checkout — a second fails fast rather than testing
against the first one's server. Across worktrees they can run concurrently;
each worktree gets its own port. See
[`docs/local-infrastructure.md`](local-infrastructure.md). Unit suites
parallelize safely.

### Playwright browsers

Install once per machine, and again after any `@playwright/test` version bump:

```bash
npx playwright install chromium webkit
```

Binaries are keyed to the Playwright version, so a bump invalidates them and
every browser test fails with `browserType.launch: Executable doesn't exist at
...`. CI reinstalls automatically — its cache key hashes `package-lock.json`
and `web/package.json`.

### Live-AI suites (opt-in)

Excluded from `npm test`, and never a substitute for it:

- `npm run test:integration:live:free` / `:paid`
- `npm run test:e2e:live:free` / `:paid`
- `npm run test:blueprint:live:free` / `:paid`
- `AI_LIVE=1 npm -w web run test:e2e -- web/e2e/live-ai.spec.ts`

They require `AI_LIVE=1`, a `.env.ai.free.local` or `.env.ai.paid.local`, and
tolerance of retriable `503`s. There is no profile to seed —
`scripts/run-live-ai.mjs` starts the server with the mode's AI env. See
[`docs/ai-configuration.md`](ai-configuration.md).

## Reading The Results

Each `npm test` run writes `test-results/<timestamp>/`, keeping the last 5:

- one log per step — `lint.log`, `typecheck.log`, `unit-api.log`, and so on
- `summary.log` — per-step status and timing, the `Total` verdict, then
  coverage
- `coverage.log` — the full per-file coverage breakdown

```
lint               4.2s  PASS
typecheck          8.1s  PASS
unit-api           2.3s  PASS
integration       18.4s  PASS
─────────────────────────────
Total             45.1s  PASS

=== Coverage ===

api   stmts 55.0%  branch 50.6%  funcs 72.4%
      14 file(s) at or below 60% statements:
    0.0%   128 uncovered  packages/game-engine/src/endpoints/game-search.ts
      ...and 13 more — see coverage.log
web   stmts 50.7%  branch 47.4%  funcs 56.1%
      no file at or below 60% statements
```

`Total` is the verdict. Everything below it is information; no coverage number
changes the exit code. Read this file rather than console scrollback.

For failures, also: the per-step log; the server's stdout, which the runner
inherits and which logs structured JSON per request; `readStoredSession()` and
`readStoredEvents()` for what was actually persisted; and, for Playwright,
`web/playwright-report/` and `web/test-results/` (`screenshot:
'only-on-failure'`, `trace: 'retain-on-failure'`).

## Coverage

Measured on every gate run, never enforced. You do not run anything extra: if
you ran `npm test`, you have it.

Machine-readable output, in the istanbul summary shape (`total` plus one entry
per absolute file path, each with `statements` / `branches` / `functions` /
`lines` carrying `total`, `covered`, `pct`):

- `coverage/api/coverage-summary.json`
- `web/coverage/coverage-summary.json`

`coverage/api/index.html` and `web/coverage/index.html` are the browsable
reports.

What is measured, per the `coverage.include` arrays in `vitest.config.ts` and
`web/vite.config.ts`:

- `packages/game-engine/src/**/*.ts`, `packages/shared/src/**/*.ts`
- `web/src/lib/**/*.ts`, `web/src/lib/**/*.svelte`

A new source directory outside those globs is invisible until it is added.

Files are listed at or below `LOW_FILE_THRESHOLD` in
`scripts/lib/coverage-report.mjs` (60% of statements), ranked by **uncovered
statements, not percentage**. A project whose unit step did not pass reads
`not measured` with the reason, never partial numbers; the gate deletes both
report directories before starting, so a missing report stays visibly missing.

**The numbers come from the unit suites alone.** Integration and E2E drive a
separate server process over HTTP, which this instrumentation does not observe.
So every file under `packages/game-engine/src/endpoints/` sits at 0% and is not
untested — the API E2E suite exercises all of them, as the browser E2E suite
does for `web/src/lib/components/*.svelte`. A file on the list is a reason to
act only when its boundary is unit; check [Which Suite To
Update](#which-suite-to-update) first.

To iterate without a full gate run:

```bash
npm run test:unit:coverage          # → coverage/api/
npm -w web run test:unit:coverage   # → web/coverage/
```

These write the directories the gate reads, so a stale hand-run report can be
picked up by a later inspection. The gate itself is immune; it clears them.

## Writing Tests

### Isolation

Each API suite run gets its own database in a temporary config root, deleted
afterwards. Within a run tests share it, so each must create its own profile
via `setupApiTestAuth(tag)`, scope assertions to its own identifiers, and avoid
unscoped global count assertions. There is no cleanup step because nothing is
left behind.

Anything that opens a database directly must be given an explicit path — never
`resolveDatabasePath()`, which points at the database you play on.

### Mock data

Fixtures are typed against the Zod schemas in
`packages/shared/src/mystery-api-contracts.ts` and
`packages/shared/src/blueprint-schema-v2.ts`.

- Use the factories and constants in `tests/testkit/src/fixtures.ts`; never
  hand-write inline objects for shapes that have a Zod schema.
- Factories call `Schema.parse()` at creation, so a renamed or newly required
  field fails immediately instead of passing against a stale shape.
- Pass only the overrides that differ from the defaults.
- Adding a response type to the shared schemas means adding its factory.
- For shapes with a TypeScript type but no Zod schema, annotate the mock
  explicitly so `npm run typecheck` catches drift.

### Boundaries that must stay proven

Ownership is enforced in the engine's repositories, with no database layer
underneath to catch a query that forgets. Integration must prove at minimum:

- profile A can create and read its own sessions
- profile B can neither read nor mutate profile A's session, through any
  endpoint taking a `game_id`
- image bytes are served only to a signed-in profile, and only for an image the
  blueprint references
- every endpoint rejects a missing cookie, and a cookie naming a profile that
  does not exist

That bar lives in `tests/api/integration/session-ownership.test.ts` and
`unauthenticated.test.ts`.

Integration and E2E never call OpenRouter. The server runs the mock provider;
assert persisted side effects instead.

If you change AI contracts, prompts, runtime context, or provider selection,
update `tests/api/unit/ai-provider.test.ts` alongside any affected integration
and API E2E assertions.

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and PRs targeting it. One
job, **gate**, running `npm test`; `concurrency.cancel-in-progress` cancels
stale runs on the same branch.

It uploads `test-results/` on every run — per-step logs, `summary.log`, and
`coverage.log`, so a run's coverage is readable from its artifacts — and
Playwright's HTML report on failure. Retention is 14 days. The browsable HTML
coverage reports under `coverage/` are not uploaded.

## Documentation-Only Changes

If a change touches only documentation and does not affect runtime code,
tooling, migrations, tests, or environment contracts, the code quality gates are
optional. Validate instead: command accuracy, path and link correctness,
cross-document consistency, and stale references to old suite names or
locations.
