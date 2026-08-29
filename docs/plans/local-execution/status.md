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
| P2 | Local adapters (SQLite + filesystem + SvelteKit `/api`) | **NEXT** |
| P3 | Cut over client and tests; move engine to `packages/game-engine/` | pending ← P2 |
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

## Starting P2

P2 builds the local `EngineContext` implementation alongside the Supabase one.
See `plan.md` § "P2 — Local adapters" for the full scope. Concretely:

1. Read [`supabase/functions/_shared/context.ts`](/supabase/functions/_shared/context.ts)
   — it is the contract to implement, and it is short. Then skim
   [`context-supabase.ts`](/supabase/functions/_shared/context-supabase.ts),
   the reference implementation you are writing a local twin of.
2. Implement it over `better-sqlite3` (pinned 13.0.3) + the filesystem. The
   driver must be confined to **one file** so `node:sqlite` can replace it later;
   see `plan.md` § "SQLite strategy" for the required pragmas
   (`journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`) and why no ORM.
3. Derive `schema.sql` from the *end state* of the 14 files in
   `supabase/migrations/` — three tables (`players`, `game_sessions`,
   `game_events`), no migration chain, `ai_profiles` dropped,
   `game_sessions.user_id` → `player_id`. Existing session data is disposable;
   there is no import tooling by design.
4. Blueprints and images are read straight off disk — they already exist there
   before `seed:storage` uploads them. Reuse `resolveBlueprintsDir()` /
   `resolveBlueprintImagesDir()` from
   [`scripts/local-config.mjs`](/scripts/local-config.mjs).
5. Add the SvelteKit `/api` routes on `adapter-node`. Endpoint handlers are
   already `(req, ctx) => Response`, the same shape `+server.ts` uses.

## Kickoff prompt for a fresh agent

Paste this into a new session to start the next phase. Replace the phase number
if the table above has moved on.

```text
Continue the "fully local execution" work in this repo.

Read docs/plans/local-execution/status.md first, then plan.md. Work the phase
marked NEXT in the status table (currently P2 — local adapters).

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
  working around it. Two phases have already been corrected this way.
```

## Environment and workflow notes

Things that cost time to rediscover:

- **Reading gate results.** `npm test` is ~30s warm, minutes on a cold start
  (Docker image pulls). Run it backgrounded to a log and read the log; never
  block on `tail -f` (it does not return) and note `timeout` is not on macOS.
  Check `GATE_EXIT`, not the task's exit code, and check the `Total` line, not
  the last line printed. Full detail is in `AGENTS.md` § Agent Execution Rules.
- **`tsc` does not cover the endpoint files.** It reaches only `_shared` modules
  that tests import; the endpoint files use `Deno.serve` and an `https://esm.sh`
  import and cannot be checked from Node. Integration + E2E is the real safety
  net until P3 moves them.
- **Prettier is not applied to `supabase/functions/**`.** Those files already
  fail `prettier --check` on `main`. Do not run `npm run format` over that tree
  — it produces an enormous unrelated diff. Several `docs/*.md` files are the
  same.
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
- The `MYSTERY_CLOUD_SESSION` gate waiver becomes dead once Phase 2 of the gate
  no longer needs Docker; remove it **and** its policy block in `AGENTS.md`.
