# status: fully local execution

Progress log for [`plan.md`](plan.md). `plan.md` is the design; this file is the
state. Newest entries at the bottom.

**If you are a fresh agent picking this up: read this file, then `plan.md`, then
start at the first phase below marked NEXT.**

## Goal in one line

Run the game as one Node process on the machine — no Docker, no cloud backend —
still calling OpenRouter for models, with sessions persisted to SQLite and an
easy export path for mining past play.

## Phase state

| Phase | What | State |
|---|---|---|
| P0 | Dependency and runtime baseline | **MERGED** — [#138](https://github.com/dinoderek/Mystery2/pull/138) |
| P1 | `EngineContext` seam, in place | **MERGED** — [#139](https://github.com/dinoderek/Mystery2/pull/139) |
| P2 | Local adapters (SQLite + filesystem) | **MERGED** — [#142](https://github.com/dinoderek/Mystery2/pull/142) |
| P3 | Move engine to `packages/game-engine/`, stand up SvelteKit `/api`, cut over client and tests | **MERGED** — see below |
| P5 | Demolition and governance (delete `supabase/`, amend constitution) | **MERGED** — see below |
| P4 | Mining and export (`npm run dump`, `sessions:ls`) | **NEXT** |

## What landed

### P0 — merged (#138)

Pinned every dependency to an exact version across all six manifests,
standardised the runtime on Node 24 (`engines`, `.nvmrc`, CI 22 → 24,
`@types/node` corrected down from the 25.x line), and dropped the declared-but-
unused `@sveltejs/adapter-auto`.

Two corrections to the original plan, both recorded in `plan.md`:

- **ESLint 9 is end-of-life.** The plan deferred the ESLint major as the
  conservative choice. npm reports *every* 9.x release as
  `This version is no longer supported`, including the 9.39.3 that was
  installed, and `typescript-eslint@8.68.0` already supports ESLint 10. Pinning
  to an unsupported line defeats the point, so ESLint 10.9.1 landed here. A
  deprecation sweep of every other pin came back clean.
  - Fallout 1: `@eslint/js` was an **undeclared transitive dependency**; ESLint
    10 no longer provides it. Now pinned explicitly at 10.0.1 (it is versioned
    independently of ESLint itself).
  - Fallout 2: `no-useless-assignment` is now in `eslint:recommended` and caught
    a dead assignment in `tests/api/integration/game-accuse.test.ts`.
- **`better-sqlite3`'s native-addon risk is closed.** Verified before committing
  to the driver: installs in ~0.5s with two packages and no compile step,
  shipping N-API prebuilds for `darwin-arm64`, `linux-x64` (CI), and the rest.
  N-API is ABI-stable, so no per-Node-version rebuild and no compiler in CI.

Still deferred as separate PRs, deliberately: **TypeScript 7** (genuinely
blocked — `typescript-eslint@8` caps at `typescript <6.1.0`), **Vite 8**, and
**zod 4**.

### P1 — merged (#139)

Handlers now reach the outside world only through `EngineContext`. Each endpoint
exports `handle(req, ctx)` behind a thin `serveWithCors` wrapper that checks the
HTTP method, calls `requireEngineContext(req)`, and delegates.

- `supabase/functions/_shared/context.ts` — the whole boundary: `sessions`,
  `events`, `content`, `aiProfiles`, `player`. ~15 named operations, not a query
  builder.
- `supabase/functions/_shared/context-supabase.ts` — the only file that speaks
  the Supabase query builder, holds a service-role client, or knows what a
  storage bucket is. **This is the file P2 replaces.**
- Error convention everywhere: a genuine backend failure **throws**; "does not
  exist" returns `null`/empty. Handlers map a throw to 500 and a null to
  404/400.

**Correction to the plan:** this phase was supposed to *move* `_shared/` into
`packages/game-engine/`. That is impossible while Deno is the runtime — an Edge
Function cannot import out of `supabase/functions`, because the local edge
runtime bind-mounts only that directory. Documented in
`docs/backend-conventions.md` §2 and in `scripts/sync-shared.mjs`'s header; it is
the entire reason the file mirroring exists. The engine is therefore refactored
**in place**, and the move is now part of P3.

Deleted along the way: `_shared/ai-profile.ts`, `_shared/blueprints/load.ts`, two
byte-identical hand-rolled `DatabaseClient` interfaces, the uncalled
`getNextNarrationSequence` and `insertNarrationEvents`, the entirely dead
`_shared/narration-parts.ts` (its `NarrationPart` shape had drifted from the live
one), and four separate copies of the same list→download→parse blueprint loop.
Net −346 lines under `supabase/functions/`.

One deliberate behaviour change: a real database error while fetching a session
used to return `400 Game session not found` (the guard was
`if (sessionError || !session)`); it is now a 500. Missing sessions still 400/404.

### P2 — merged (#142)

`packages/game-engine/` now holds a complete local `EngineContext` — SQLite plus
the filesystem — sitting alongside the Supabase one. Handlers are untouched:
they still see only the interface, so the two adapters are interchangeable by
construction.

- `src/db/client.ts` — the only file that imports a SQLite driver
  (`better-sqlite3` 13.0.3), the three load-bearing pragmas (`journal_mode=WAL`,
  `foreign_keys=ON`, `busy_timeout=5000`), and a forward-only schema runner
  keyed on `PRAGMA user_version`. Repositories get a `Db` interface and never
  see the driver, so the eventual swap to `node:sqlite` is a one-file change.
- `src/db/schema.sql` — three tables, no migration chain, derived from the end
  state of the 14 files in `supabase/migrations/`.
- `src/db/{players,sessions,events}.ts` — repositories. **Ownership is the
  repository's job now**: every statement is scoped to one player, which is
  where migration 0004's RLS policies went.
- `src/content.ts` — blueprints and images off disk, cached on mtime+size so an
  edit lands without a restart.
- `src/ai-profile.ts` — the `ai_profiles` table replaced by `.env.ai.<mode>.local`
  and the process environment. This deletes the engine's one privileged read,
  and with it the last reason a service-role client exists.
- `src/contract.ts` — a type-only re-export of `EngineContext` from the Supabase
  tree, so P3 changes one file rather than every import.

Verified by 50 test cases across five `tests/api/unit/local-engine-*.test.ts`
suites, each against a throwaway database: ownership isolation both ways,
sequence allocation, the `game_events` cascade, the narration-parts check
constraint, transaction rollback, blueprint precedence, parse-failure
tolerance, stable catalog order, path traversal, and profile resolution
including its failure modes.

**Correction to the plan:** P2 was supposed to stand up the SvelteKit server
tier as well. It cannot, for the same reason P1 could not move `_shared/`: a
`+server.ts` route needs handlers to dispatch to, and the handlers cannot leave
`supabase/functions/` while Deno is the runtime. Flipping
`adapter-static` → `adapter-node` early would also change `web/build`'s shape
and break the CI deploy job, which is not retired until P5. The SvelteKit work
therefore moved wholesale into P3, where the handlers arrive, the client cuts
over and the deploy story changes together. `plan.md` records this.

Three smaller things the survey had wrong, now fixed in `plan.md`:

- The helpers are `getBlueprintsDir()` / `getBlueprintImagesDir()`, not
  `resolveBlueprintsDir()` / `resolveBlueprintImagesDir()`.
- Blueprints come from **two** directories — the config root's `blueprints/`
  and the repo's `supabase/seed/blueprints` — exactly as `seed-storage.mjs`
  collects them, so ids must be de-duplicated (the config root wins). Authored
  blueprints are also not reliably named `<id>.json`, so the
  scan-for-embedded-id fallback matters locally, not just for legacy objects.
- `game_events.clues_revealed` was dropped rather than carried over. The
  runtime has never written it — `evaluation/lib/game-events.mjs` says so in a
  comment — and reveals live in `payload`.

Two changes outside the new package, both small and both green on Supabase:

- `GameSessionRow`/`NewGameSession` now name the owner `player_id`. Postgres
  still calls the column `user_id`; `context-supabase.ts` maps between them.
- `toRelativeSignedUrl()` returns an already-relative URL unchanged, so
  `blueprint-image-link` works against either adapter (the local content store
  serves a same-origin `/api/images/...` path, which has no origin to strip).

### P3 + P5 — merged

Shipped together, because the cutover and the demolition could not be separated
without a phase in the middle where the suite could not be green: the moment
the engine leaves `supabase/functions/`, Deno has nothing to serve, and the test
scripts that started Supabase have nothing to start.

**The engine moved.** `supabase/functions/_shared/*` → `packages/game-engine/src/`,
each `<name>/index.ts` → `src/endpoints/<name>.ts` as a bare `handle(req, ctx)`,
and `src/endpoints/index.ts` is the registry that replaced twelve copies of the
same `Deno.serve` bootstrap. `auth.ts`, `db.ts`, `context-supabase.ts` and
`cors.ts` were deleted rather than moved, along with both mirrored duplicates,
`scripts/sync-shared.mjs`, the `shared-sync` gate step and its two tests.

**Three defects fell out of type-checking the endpoints for the first time.**
They were previously unreachable from Node, so nothing checked them:

- `game-enter` never sent `destination_history_json`, which the ambience prompt
  interpolates — every first location description was preceded by the literal
  text `Destination history: undefined`.
- `GameSessionRow.mode` was `string` while every consumer wanted `GameMode`.
- `AIContext` was an interface, so it was not assignable to the
  `Record<string, unknown>` every provider takes.

**The server tier.** `adapter-node`, `hooks.server.ts` resolving the
`mystery-player-id` cookie, `api/[endpoint]` dispatching to the registry,
`api/images/[blueprint]/[image]` serving bytes off disk, and `api/player` /
`api/players` replacing Supabase Auth. Signing in is naming a profile.

**The client.** `supabase.functions.invoke(name, {body})` became
`callApi(name, body)` with the same `{ data, error }`, so `store.retry.ts` and
the call sites barely moved. `image-link-cache.ts` and its five-minute refresh
sweep are gone; `SignedImage` is `BlueprintImage`, a plain `<img src>`.

**The tests.** `scripts/lib/test-server.mjs` builds the game and runs it against
a temporary config root, so a suite can never touch the database you play on.
`setupApiTestAuth()` returns a cookie; `readStoredSession()`/`readStoredEvents()`
replaced twelve service-role clients. `auth-rls.test.ts` became
`session-ownership.test.ts` and asserts the same property through the API,
`cors-preflight.test.ts` is deleted, and the browser suite picks a profile the
way a player does.

**The demolition.** `supabase/`, `deploy/`, eleven scripts, the nine-service
port table (one port survives), `wrangler`, `@supabase/supabase-js` from both
manifests, the `MYSTERY_CLOUD_SESSION` waiver, and leak detection — there are no
auth users left to leak. CI went from four jobs to one.

**Constitution amended to 2.0.0.** Principle IV named the platform, so
redefining it is MAJOR under the document's own policy. It now names three
constraints instead of a vendor: secrets stay out of the browser, ownership is
enforced in the repositories, and the engine does not know how it is hosted.

Two things worth knowing about the build, both found by running the artefact
rather than trusting that it compiled:

- `better-sqlite3` has to load through `createRequire`. Bundled, its binding
  loader reaches `require.main` inside an ES module and the server dies at
  boot. Marking it external does not work: the engine is a linked workspace
  package, so Vite treats its whole dependency graph as source.
- `schema.sql` became `schema.ts`. The engine has to load identically under
  Vite's SSR bundle, vitest, and plain `node`; a bundled chunk cannot read a
  sibling `.sql` file, and `?raw` is Vite-only.

**Correction to the plan:** P4 was sequenced after P3 and is now the only phase
left. Its `evaluation/` half was pulled forward — `createLocalTraceSource()`,
`seed-session.mjs` and the runtime harness had to stop using Supabase for the
demolition to be real — so what remains of P4 is the export tooling proper:
`npm run dump` and `npm run sessions:ls`.

## Starting P4

Everything P4 depended on exists. `evaluation/trace/lib/datasource.mjs` already
reads `game.db` directly (`--db <file>` points it at a copy), so
`npm run eval:trace -- --session <id>` works on real sessions today. What is
left is the bulk tooling from `plan.md` § "P4 — Mining and export":

1. `scripts/dump-sessions.mjs` → `npm run dump`, writing `sessions.jsonl`,
   `events.jsonl`, and `traces/<session_id>.json` in the shape
   `extractSessionTrace()` already emits, with `--since` / `--player` /
   `--outcome` / `--blueprint` filters and the `game.db` file copied alongside.
2. `npm run sessions:ls` — bulk enumeration, which still does not exist.

Both are reads against a file. Neither needs the game running.

## Kickoff prompt for a fresh agent

Paste this into a new session to start the next phase.

```text
Continue the "fully local execution" work in this repo.

Read docs/plans/local-execution/status.md first, then plan.md. Work the phase
marked NEXT in the status table (currently P4 — mining and export).

Ground rules:
- Follow AGENTS.md and .specify/memory/constitution.md.
- Finish with the full `npm test` gate, green. Every step runs everywhere now;
  there is no waiver and nothing to start first.
- Run the gate backgrounded to a log file and read the log; never block on
  `tail -f`. Check GATE_EXIT and the `Total` line, not the task exit code or
  the last line printed.
- Update status.md in the same PR as the phase, then open a PR against main.
- If reality contradicts the plan, fix the plan and say so plainly rather than
  working around it. Four phases have already been corrected this way.
```

## Environment and workflow notes

Things that cost time to rediscover:

- **Reading gate results.** `npm test` takes about a minute. Run it
  backgrounded to a log and read the log; never block on `tail -f` (it does not
  return) and note `timeout` is not on macOS. Check `GATE_EXIT`, not the task's
  exit code, and check the `Total` line, not the last line printed. Full detail
  is in `AGENTS.md` § Agent Execution Rules.
- **Gate the tree you ship.** Three separate P2 runs went green on trees that
  were each edited a moment later; the first genuinely frozen run failed on a
  real bug. Commit, then run the gate, then do nothing to the tree until it
  finishes.
- **Localhost is not 127.0.0.1 here.** `localhost` resolves to `::1` first on
  this machine. `vite.config.ts` pins `server.host` to `127.0.0.1` and the
  Playwright `baseURL` matches, because a server bound to one and a client
  reaching for the other looks exactly like a server that failed to start.
- **A stale server is worse than no server.** `startTestServer()` checks
  whether the child exited before polling for readiness — otherwise a leftover
  server on the same port answers the probe and the whole suite runs against a
  stale database, failing in ways that look like product bugs.
- **`scripts/local-config.mjs` is typed twice, deliberately.** The web
  workspace enables `checkJs` and reads the JSDoc in the `.mjs` itself; the root
  tsconfig does not, and reads `tests/local-config-module.d.ts`. Keep the two in
  step. (Turning on `allowJs` at the root would unify them, and would also
  surface about a dozen pre-existing `possibly undefined` errors in tests that
  import `evaluation/*.mjs` — worth doing, but on its own.)
- **Everything is under `tsc` now.** The endpoint files were unreachable from
  Node while Deno served them, so nothing type-checked or linted them. Moving
  them surfaced three real defects immediately.
- **Prettier is not in the gate, and most of the repo fails it.**
  `supabase/functions/**`, `packages/shared/src/**` and several `docs/*.md`
  files already fail `prettier --check` on `main`. Do not run `npm run format`
  over them — it produces an enormous unrelated diff. Match the surrounding
  style by hand instead.
- **`web/e2e/search-resume.test.ts` has flaked under full-suite parallelism.**
  Timing-sensitive and pre-existing; passes in isolation and on re-run.
- **Playwright browsers are version-keyed.** After an `@playwright/test` bump,
  run `npx playwright install chromium` locally or every browser test fails
  with `browserType.launch: Executable doesn't exist`. CI reinstalls
  automatically. Documented in `docs/testing.md`.
- **Curated docs carry source hashes.** Editing `docs/ai-runtime.md` or
  `docs/blueprint-generation-flows.md` fails the `curated-docs` gate step until
  the pointer in `evaluation/generator-harness/template/docs/` is refreshed with
  `git hash-object <source>`. Only regenerate the extract's *content* if the
  change actually affects blueprint authoring.

## Open items

- **`specs/` and `plan/` are historical and were left alone.** They record what
  each shipped milestone built, and several describe the Supabase architecture.
  `.agent/rules/specify-rules.md` now says so at the top. Rewriting them would
  be revisionism; deleting them would lose the record.
- **Turning on `allowJs` at the root tsconfig** would let one set of JSDoc types
  serve both workspaces, and would surface about a dozen real `possibly
  undefined` narrowing gaps in tests that import `evaluation/*.mjs`. Its own PR.
- **The deferred dependency majors from P0 are still deferred**: TypeScript 7,
  Vite 8, and zod 4. Each is its own PR.
