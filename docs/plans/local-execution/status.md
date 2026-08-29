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
| P2 | Local adapters (SQLite + filesystem) | **MERGED** — see below |
| P3 | Move engine to `packages/game-engine/`, stand up SvelteKit `/api`, cut over client and tests | **NEXT** |
| P4 | Mining and export (`npm run dump`, `sessions:ls`) | pending ← P3 |
| P5 | Demolition and governance (delete `supabase/`, amend constitution) | pending ← P4 |

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

### P2 — merged

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

## Starting P3

P3 is the cutover, and it is now the biggest phase — it absorbed P2's SvelteKit
work. See `plan.md` § "P3 — Cut over client and tests". In rough order:

1. **Move the engine.** `supabase/functions/_shared/*` →
   `packages/game-engine/src/`, each `<name>/index.ts` →
   `src/endpoints/<name>.ts` exporting `handle(req, ctx)`. The bind-mount
   constraint dies with the move, so the engine can import `@my2/shared`
   directly and `src/contract.ts` becomes the definition of `EngineContext`
   instead of a re-export. `sync:shared`, the `shared-sync` gate step and the
   duplicated 196-LOC `blueprint-schema-v2.ts` can go with it.
2. **Stand up the server.** `adapter-node`, `hooks.server.ts` resolving the
   `mystery-player-id` cookie through `engine.players`,
   `routes/api/[endpoint]/+server.ts` dispatching to the handlers, and
   `routes/api/images/[blueprint]/[image]/+server.ts` serving bytes via
   `resolveImageFile()`. `createLocalEngine()` is the one call that opens
   everything.
3. **Cut over the client**, then the tests. Note that the CI deploy job and
   `web/build`'s shape both change here; P5 deletes them.

It is worth considering splitting this in two — (1) move the engine and stand
up the server, with the Supabase functions still serving the app, and (2) point
the client and the tests at it — so that neither PR is a rewrite of both tiers
at once. The suite cannot be green in between, though, which is an argument for
keeping it whole. Judgement call for whoever picks it up.

## Kickoff prompt for a fresh agent

Paste this into a new session to start the next phase. Replace the phase number
if the table above has moved on.

```text
Continue the "fully local execution" work in this repo.

Read docs/plans/local-execution/status.md first, then plan.md. Work the phase
marked NEXT in the status table (currently P3 — move the engine, stand up
SvelteKit, cut over the client and tests).

Ground rules:
- Follow AGENTS.md and .specify/memory/constitution.md.
- Finish with the full `npm test` gate, green, no waiver. Start the local
  Supabase stack yourself if it is not running — that is a setup step, not a
  reason to skip a suite.
- Run the gate backgrounded to a log file and read the log; never block on
  `tail -f`. Check GATE_EXIT and the `Total` line, not the task exit code or
  the last line printed.
- Update status.md in the same PR as the phase, then open a PR against main.
- If reality contradicts the plan, fix the plan and say so plainly rather than
  working around it. Three phases have already been corrected this way.
```

## Environment and workflow notes

Things that cost time to rediscover:

- **Reading gate results.** `npm test` is ~30s warm, minutes on a cold start
  (Docker image pulls). Run it backgrounded to a log and read the log; never
  block on `tail -f` (it does not return) and note `timeout` is not on macOS.
  Check `GATE_EXIT`, not the task's exit code, and check the `Total` line, not
  the last line printed. Full detail is in `AGENTS.md` § Agent Execution Rules.
- **`packages/game-engine` leans on a `.d.ts` under `tests/`.**
  `tests/local-config-module.d.ts` is what types
  `scripts/local-config.mjs`, and ambient module declarations are keyed on the
  literal specifier — `../../../scripts/local-config.mjs` happens to resolve to
  the same file from both `tests/api/unit/` and `packages/game-engine/src/`.
  Declaring it a second time is a duplicate-identifier error, so the engine
  reuses the existing declaration. If the tests' copy moves, `paths.ts` and
  `ai-profile.ts` stop typechecking.
- **`tsc` does not cover the endpoint files.** It reaches only `_shared` modules
  that tests import; the endpoint files use `Deno.serve` and an `https://esm.sh`
  import and cannot be checked from Node. Integration + E2E is the real safety
  net until P3 moves them.
- **Prettier is not in the gate, and most of the repo fails it.**
  `supabase/functions/**`, `packages/shared/src/**` and several `docs/*.md`
  files already fail `prettier --check` on `main`. Do not run `npm run format`
  over them — it produces an enormous unrelated diff. Match the surrounding
  style by hand instead.
- **Two tests flake under full-suite parallelism**, both timing-sensitive and
  both pre-existing: `tests/api/integration/cors-preflight.test.ts` (deleted in
  P3 — same-origin makes CORS moot) and
  `web/e2e/search-resume.test.ts`. Each passes in isolation and on re-run.
- **Playwright browsers are version-keyed.** After an `@playwright/test` bump,
  run `npx playwright install chromium webkit` locally or every browser test
  fails with `browserType.launch: Executable doesn't exist`. CI reinstalls
  automatically. Documented in `docs/testing.md`.
- **Curated docs carry source hashes.** Editing `docs/ai-runtime.md` or
  `docs/blueprint-generation-flows.md` fails the `curated-docs` gate step until
  the pointer in `evaluation/generator-harness/template/docs/` is refreshed with
  `git hash-object <source>`. Only regenerate the extract's *content* if the
  change actually affects blueprint authoring.

## Open items for later phases

- **The constitution must be amended in P5.** Principle IV pins the architecture
  to "Supabase Auth/Postgres/Storage/Edge Functions". Per the repo's own
  versioning policy, redefining a principle is MAJOR: `1.3.0` → `2.0.0`, with a
  Sync Impact Report and same-change updates to `.specify/templates/*`.
- `scripts/sync-shared.mjs`, the `shared-sync` gate step, and the duplicated
  196-LOC `blueprint-schema-v2.ts` survive until `supabase/` is deleted, because
  the sandbox constraint that created them is still in force.
- **The seed blueprints need a home before P5.** `supabase/seed/blueprints/`
  holds `mock-blueprint.json` and `the-missing-heartwood.json`, which the local
  content store reads as its second source directory. Deleting `supabase/`
  deletes them; move them to `blueprints/` (or somewhere else committed) in the
  same change, and update `resolveBlueprintDirs()`.
- **`seed:ai` has nothing left to do once P3 lands.** Profiles resolve from the
  environment, so the script, its `--only` plumbing in `dev-ai.mjs`/`dev-mock.mjs`,
  and the `ai_profiles` reseeding in the test scripts all go in P5.
- **`evaluation/trace/lib/datasource.mjs` calls `fetchProfile(ai_profile_id)`**
  against the `ai_profiles` table. P4 wires `createLocalTraceSource()` in; that
  method has to resolve labels through `resolveAIProfile()` instead.
- The `MYSTERY_CLOUD_SESSION` gate waiver becomes dead once Phase 2 of the gate
  no longer needs Docker; remove it **and** its policy block in `AGENTS.md`.
