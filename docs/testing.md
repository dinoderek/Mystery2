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

`npm test` runs `scripts/run-test-gate.mjs`, whose `STEPS` list is the
definitive set. Phase 1 runs in parallel: lint, typecheck, `svelte-check`, both
unit suites with coverage, and the two doc checks. Phase 2 runs only if all of
phase 1 passed, one step at a time because each starts a server on the
worktree's port: integration, API E2E, browser E2E.

**Every step runs in every environment.** The gate needs nothing beyond this
repo — no Docker, no CLI, no seeding — so there is no waiver and no condition
under which a suite may be reported as skipped. A suite that cannot start is a
bug to fix, not a partial run to report. Focused scripts are for iteration;
re-run the gate if you edit after it passes.

Integration and API E2E run against the production build (`node build/index.js`),
not the dev server, so a bundling failure is caught. Before starting it, the
runner fails if anything already holds the port: otherwise that process would
answer the readiness poll and the suite would test the wrong server. The
browser suite starts `vite dev` through Playwright's `webServer`. Each gets a
config root of its own, deleted afterwards, so nothing needs restarting after
an engine edit.

The two doc checks:

- `check:curated-docs` holds the curated extracts in
  `evaluation/generator-harness/template/docs/` to the doc sections they
  summarise. On drift it names the commit to diff against; fix the extract if
  it no longer holds, then record the new hash — a refreshed hash over stale
  prose silences the check without fixing anything. Details:
  `evaluation/generator-harness/template/README.md`.
- `check:doc-refs` fails when `AGENTS.md`, `QUICKSTART.md`, `docs/` or a README
  names a path, an `npm run` script or a relative link that does not exist. A
  code span counts as a path only when its first segment is a real directory;
  gitignored paths are skipped; `docs/design/` and the harness templates are not
  checked.

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

Each `npm test` run writes `test-results/<timestamp>/` (the last five are
kept): one log per step, `summary.log`, and `coverage.log`. In `summary.log`,
the `Total` line is the verdict; the coverage section after it is information
and never changes the exit code. Read the file, not console scrollback.

For a failure, also look at the server's stdout (structured JSON per request),
`readStoredSession()` and `readStoredEvents()` in
`tests/api/integration/helpers.ts` for what was actually persisted, and for
Playwright `web/playwright-report/` and `web/test-results/` (screenshots and
traces are kept on failure).

## Coverage

Measured on every gate run, never enforced. The measured globs are the
`coverage.include` arrays in `vitest.config.ts` and `web/vite.config.ts`; a new
source directory outside them is invisible until added. `summary.log` lists
files at or below `LOW_FILE_THRESHOLD` (`scripts/lib/coverage-report.mjs`),
ranked by uncovered statements, not percentage. A project whose unit step
failed reads `not measured`, never partial numbers.

**The numbers come from the unit suites alone.** Integration and E2E drive a
separate server process, which this instrumentation does not see, so every file
under `packages/game-engine/src/endpoints/` reads 0% while API E2E exercises all
of them — as browser E2E does for `web/src/lib/components/`. A listed file is a
reason to act only when its boundary is unit ([Which Suite To
Update](#which-suite-to-update)).

`npm run test:unit:coverage` and `npm -w web run test:unit:coverage` write the
same reports (`coverage/api/`, `web/coverage/`) for iteration.

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

That bar lives in `tests/api/integration/session-ownership.test.ts` and
`unauthenticated.test.ts`.

Integration and E2E never call a real model. The server runs the mock provider;
assert persisted side effects instead.

Mock is chosen by absence — the server's config root has no `.env.ai.*` and
its settings row is empty — but the settings row can be changed over the API,
and it belongs to the installation, not a profile. **A test that switches the
server to live switches it for every test sharing that server**, and their
calls go to the real API with whatever throwaway key was stored. When that
happened, the integration suite failed on an unexplained 500 and CI hit its
fifteen-minute cap.

So no suite that shares a server with game-playing tests may switch the mode to
live; assert that in the unit suites (`ai-settings-store.test.ts`,
`local-engine-ai-profile.test.ts`). The suites that do change the row
(`tests/api/integration/ai-settings.test.ts`, `web/e2e/ai-settings.spec.ts`)
reset it around each test and leave it on mock. As a backstop,
`scripts/run-mock-tests.mjs` and `web/playwright.config.ts` point
`OPENROUTER_URL` at a closed port and `CLAUDE_CLI_PATH` at a file that does not
exist, so a slip fails in milliseconds instead of hanging or spending credits.

`tests/api/integration/ai-profile-runtime.test.ts` proves profiles are resolved
per request: it writes a `free` profile, plays a turn, breaks the file, and
asserts the next turn fails.

Changing an AI contract, prompt, context or provider selection updates the mock
provider and its tests in the same change ("The mock provider" in
`docs/ai-runtime.md`).

## CI

`.github/workflows/ci.yml` runs the gate on pushes to `main` and on pull
requests, and uploads `test-results/` (with the coverage summary) on every run
and Playwright's report on failure.

## Documentation-Only Changes

If a change touches only documentation, the code suites are optional locally,
but run `npm run check:curated-docs` and `npm run check:doc-refs`: CI runs the
whole gate, and both fail it. Check the rest by hand — command accuracy, and
consistency with the doc that owns each topic.
