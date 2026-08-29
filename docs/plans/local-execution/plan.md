# Plan: fully local execution

> **Status and progress live in [`status.md`](status.md).** Read that first — it
> records which phases have landed, their PRs, and what the next agent should
> pick up. This file is the design; `status.md` is the state.

## Context

The game runs on Supabase: 12 Deno Edge Functions, Postgres, Storage, and Auth,
with a static SvelteKit SPA in front and a hosted `dev` environment (Cloudflare
Pages + Supabase project `huvcyjsmmrtlmnggrujr`) deployed by CI on every push to
`main`.

That platform choice now costs more than it returns. Local development requires
Docker, a per-worktree port-slot allocator, a generated `config.toml`, garbage
collection of orphaned container stacks, a full stack restart after *every* edit
to `supabase/functions/`, three separate seed scripts, and a migration whose only
job is to re-grant table privileges the CLI stopped granting. The Edge Function
sandbox also forces two modules to be mirrored byte-for-byte into
`supabase/functions/_shared/`, policed by a dedicated gate step. Meanwhile
`staging` and `prod` in `deploy/targets.json` were never provisioned, Realtime is
unused, and there is no signup UI — Auth exists only to gate two seeded test
players.

The goal is a game that runs as **one Node process on the machine**, with no
containers and no cloud backend, while keeping remote models (OpenRouter) and
gaining a first-class way to persist and export played sessions for analysis.
Today the only export path is `evaluation/trace/extract.mjs --session <id>`, one
session at a time, and **there is no way to list sessions at all** — you must
already know the id.

Decisions locked with the repo owner:

- **Stack:** SvelteKit fullstack (`adapter-node`) + SQLite. Simplest end state.
- **Identity:** local player profiles, no passwords.
- **Cloud:** delete the deploy machinery outright.
- **Models:** unchanged — OpenRouter stays; offline play is a non-goal.
- **Existing session data is disposable.** Nothing in the current local or
  hosted database needs to survive the move, so there is no import tooling and
  no migration chain to carry forward. Export tooling is built for *future*
  sessions.

## Why this is cheaper than it looks

*The original survey, kept as the rationale for the phasing. Some of these files
no longer exist — P1 consumed several of them.*

- The web app has **no server tier today** and talks to the backend through one
  seam: 6 `supabase.functions.invoke()` calls in
  [store.svelte.ts](/web/src/lib/domain/store.svelte.ts) and
  [image-link-cache.ts](/web/src/lib/api/image-link-cache.ts), plus one raw GET.
- Of 8,094 LOC under `supabase/functions/`, the platform is touched in **three
  files**: [_shared/db.ts](/supabase/functions/_shared/db.ts),
  [_shared/auth.ts](/supabase/functions/_shared/auth.ts), and
  `_shared/blueprints/load.ts` (plus `images.ts`). There is exactly **one** remote import in the whole tree.
- Handlers are already `(req: Request) => Response` via
  [_shared/cors.ts](/supabase/functions/_shared/cors.ts) — the same signature
  SvelteKit `+server.ts` uses. The port is near-mechanical.
- Node **already** imports these `_shared/*.ts` modules directly (`evaluation/`
  does it today), so no transpile step is needed.
- The query vocabulary is tiny: 40 `.from()` sites over 3 tables using only
  `select/eq/order/update/insert/single/maybeSingle` — no joins, no deletes.
  It collapses into ~15 named repository functions.
- Storage is two folders of files that already exist on disk *before*
  `seed:storage` uploads them.
- Integration tests already speak HTTP (`fetch(\`${API_URL}/game-move\`)`), so
  test bodies survive; only auth setup and direct-DB assertions change.

## Target architecture

```
packages/game-engine/           # was supabase/functions/
  src/*.ts                      #   ex-_shared: ai-*, narration, clues, state-machine…
  src/endpoints/<name>.ts       #   ex-<name>/index.ts, exporting handle(req, ctx)
  src/db/                       #   schema.sql + client.ts (driver + migrate) + repositories
  src/content.ts                #   blueprints + images off the filesystem
  src/ai-profile.ts             #   AI profiles from the environment
  src/contract.ts               #   EngineContext: { player, sessions, events, content, aiProfiles }
  src/context-local.ts          #   the local implementation of it

web/
  svelte.config.js              # adapter-node
  src/hooks.server.ts           # resolves the player cookie into locals.player
  src/routes/api/[endpoint]/+server.ts          # dispatches to engine handlers
  src/routes/api/images/[blueprint]/[image]/+server.ts
```

The **`EngineContext` interface is the pivot of this plan.** Endpoint handlers
take it instead of a Supabase client, which is what lets the engine be extracted
and validated against the *existing* backend before the local one exists.

Concrete substitutions:

| Today | Local |
|---|---|
| `requireAuth(req)` → JWT | `ctx.player` from a `mystery-player-id` cookie |
| `userClient.from("game_sessions")…` | `ctx.db.sessions.*` |
| `client.storage.from("blueprints").download()` | `ctx.content.loadBlueprint(id)` |
| `blueprint-image-link` → signed URL | `/api/images/<bp>/<img>` serving bytes |
| `ai_profiles` table + service-role read | `AI_PROVIDER`/`AI_MODEL`/`OPENROUTER_API_KEY` from `.env.local` |
| RLS policies | `where player_id = ?` in the repository |
| `/functions/v1/<name>` | `/api/<name>` |

Type mapping for SQLite: `uuid` → `TEXT` (`crypto.randomUUID()`), `timestamptz`
→ ISO-8601 `TEXT`, `jsonb` and `text[]` → `TEXT` holding JSON.

**Database location:** `$MYSTERY_CONFIG_ROOT/game.db` when set (so worktrees
share one history to mine), else `./data/game.db`, gitignored. Tests always get a
fresh temp file per run — never the dev database.

## SQLite strategy

**Driver: `better-sqlite3`, pinned to `13.0.3`.**

`node:sqlite` was evaluated first, since it is built in and needs no dependency.
It works, but Node 24.13.1 still emits
`ExperimentalWarning: SQLite is an experimental feature and might change at any
time`. An experimental API sitting under a mandatory quality gate can break on a
Node *patch* bump, and every command prints a warning. That fails the
stable-versions bar, so it is rejected for now.

`better-sqlite3` is the most widely deployed SQLite binding for Node, ships
prebuilt binaries (so `npm ci` needs no compiler on common platforms), and is
**synchronous** — which is a genuine fit rather than a compromise. Every query
here is a local file read; the handlers are already `async` for the OpenRouter
calls, so an async driver would buy nothing and cost ceremony at ~15 call sites.

Containment, so this stays a reversible decision:

- The driver is imported in **exactly one file**,
  `packages/game-engine/src/db/client.ts`. Repositories receive a typed handle
  and never see the driver. Leave a comment there naming `node:sqlite` as the
  intended replacement once it stabilises — it is then a one-file change.
- **Prebuilds verified (P0).** `better-sqlite3@13.0.3` installs in ~0.5s with
  two packages and no compile step, shipping N-API prebuilds for
  `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `linuxmusl-*`, and
  `win32-*`. N-API is ABI-stable, so no per-Node-version rebuild is needed and
  CI needs no compiler.

On open, set: `journal_mode = WAL` (so `npm run dump` and ad-hoc `sqlite3`
queries don't block the running game), `foreign_keys = ON` (**off by default in
SQLite** — the `game_events → game_sessions` cascade depends on it), and
`busy_timeout = 5000`.

**No ORM.** Fifteen named queries over three tables do not justify Drizzle or
Prisma, and both would reintroduce exactly the schema-migration ceremony this
move exists to delete.

## Dependency strategy

Two real problems exist today, independent of this move:

- **The runtime is inconsistent.** This machine runs Node v24.13.1, CI pins
  `node-version: 22`, and `@types/node` is on the **25.x** line in both the root
  and `web/`. The types describe APIs neither runtime has. Standardise on the
  Node 24 LTS line: add `"engines": { "node": ">=24 <25" }` and an `.nvmrc`, set
  CI to 24, and move `@types/node` to 24.x.
- **Every range is a caret, several are extremely loose** (`typescript: ^5.0.0`,
  `eslint: ^9.0.0`, `prettier: ^3.0.0`). Pin **exact** versions everywhere so the
  manifests and lockfile agree and CI cannot drift.

Installed → target (all pinned exact):

| Package | Installed | Target | Note |
|---|---|---|---|
| `vitest`, `@vitest/coverage-v8` | 4.1.2 | 4.1.11 | keep both identical |
| `prettier` | 3.8.1 | 3.9.6 | |
| `typescript-eslint` | 8.56.1 | 8.68.0 | peer already allows ESLint 10 |
| `eslint` | 9.39.3 | **10.9.1** | the whole 9.x line is deprecated — see below |
| `@eslint/js` | *(transitive)* | 10.0.1 | ESLint 10 no longer provides it |
| `svelte` | 5.53.7 | 5.57.0 | |
| `@sveltejs/kit` | 2.53.4 | 2.70.3 | |
| `svelte-check` | 4.4.4 | 4.7.6 | |
| `tailwindcss` (+ `@tailwindcss/vite`) | 4.2.1 | 4.3.3 | bump together |
| `@playwright/test` | 1.58.2 | 1.62.1 | browser cache key must be refreshed |
| `@types/node` | 25.3.4 | 24.x | match the runtime |
| `@sveltejs/adapter-static` | 3.0.10 | — | replaced by `@sveltejs/adapter-node` 5.5.7 |
| `@sveltejs/adapter-auto` | declared | — | **dead** — `svelte.config.js` never used it |
| `@supabase/supabase-js` | 2.98.0 | — | removed from *both* root and `web/` |
| `wrangler` | 4.71.0 | — | removed with Cloudflare |
| — | — | `better-sqlite3` 13.0.3 | new |

**Deliberately deferred majors.** Latest is not the same as stable-for-us, and
bundling four ecosystem majors into a backend rewrite makes any failure
unattributable. Each of these is its own PR, after this work lands:

- **TypeScript 5.9.3 → 7.0.2** — the native-port rewrite. Highest risk; do not
  touch during this work.
- **Vite 7.3.6 → 8.2.2** (needs Kit and `vite-plugin-svelte` alignment).
- **zod 3.25.76 → 4.5.2** — touches
  [blueprint-schema-v2.ts](/packages/shared/src/blueprint-schema-v2.ts) and every
  contract schema, and would let `zod-to-json-schema` be dropped in favour of the
  built-in `z.toJSONSchema`. Coupled enough to deserve its own change.

**ESLint 10 is not deferred.** Planning assumed staying on ESLint 9 was the
conservative choice; it is not. npm reports *every* 9.x release, including the
installed 9.39.3, as `This version is no longer supported` — the line is EOL,
and `typescript-eslint@8.68.0` already declares `eslint: ^10.0.0` support. A
deprecation sweep across all other pins came back clean, so ESLint was the only
one. Pinning to an unsupported line would defeat the point of this phase, so the
bump lands in P0. Two consequences to expect: ESLint 10 stopped providing
`@eslint/js` transitively (it must now be declared — the config was already
relying on a transitive dep), and `no-useless-assignment` is now in
`eslint:recommended`.

Going forward: bump dependencies deliberately in a dedicated PR, never as a side
effect of feature work. Removing `@supabase/supabase-js` and `wrangler` — two
large trees — should also make installs noticeably smaller.

## Work breakdown

Six phases, each independently shippable, each ending with a green gate.

### P0 — Dependency and runtime baseline (~½ day, do this first)

Low-risk hygiene that gives the port a clean, non-drifting foundation. Nothing
here depends on the architecture change, so it can merge immediately.

- Pin every dependency to an exact version per the table above; drop the dead
  `@sveltejs/adapter-auto`.
- Standardise on Node 24: `engines`, `.nvmrc`, and `node-version: 24` in
  [.github/workflows/ci.yml](/.github/workflows/ci.yml); move `@types/node` to the
  24.x line in both manifests.
- Refresh the Playwright browser cache key after the version bump.
- Full gate green on the existing Supabase stack before touching anything else —
  this separates "a dependency bump broke it" from "the port broke it" for the
  rest of the work.

### P1 — Introduce the `EngineContext` seam, in place (~3–4 days)

Pure refactor, zero behavior change, still running on Supabase.

> **Correction.** Planning had this phase *move* `_shared/` to
> `packages/game-engine/`. That is impossible while Supabase is still the
> runtime: an Edge Function **cannot import out of `supabase/functions`**,
> because the local edge-runtime container bind-mounts only that directory — a
> relative path escaping it resolves to nothing inside the container. This is
> documented in `docs/backend-conventions.md` §2 and in the header of
> `scripts/sync-shared.mjs`, and it is the entire reason the mirroring exists.
> Moving the files and keeping the gate green on Supabase are mutually
> exclusive, and the green gate is the property worth having. So P1 refactors
> **in place**; the physical move happens in P3, once SvelteKit serves the
> endpoints and Deno is no longer the runtime.

- Define `EngineContext` in `supabase/functions/_shared/context.ts` and a
  **Supabase-backed adapter** implementing it.
- Convert each `supabase/functions/<name>/index.ts` to export
  `handle(req, ctx)`, leaving a thin `serveWithCors` wrapper that builds the
  Supabase context and calls it. Bodies stay byte-identical apart from
  `requireAuth`/`.from()`/`loadBlueprint` becoming `ctx.*`.
- The full gate must stay green on Supabase at the end of this phase — that is
  what makes every later phase safe.

Deferred to P3/P5 as a consequence: `scripts/sync-shared.mjs`, the
`shared-sync` gate step, the `MIRRORED_FILES` machinery, and the duplicated
196-LOC `supabase/functions/_shared/blueprints/blueprint-schema-v2.ts` all
survive until `supabase/` itself is deleted, since the sandbox constraint that
created them is still in force.

### P2 — Local adapters (~3–4 days)

Build the local implementation alongside the Supabase one, in
`packages/game-engine/`.

> **Correction.** Planning had this phase also stand up the SvelteKit server
> tier. It cannot: a `+server.ts` route is only worth adding once it has
> handlers to dispatch to, and the handlers cannot leave
> `supabase/functions/<name>/index.ts` while Deno is still the runtime — the
> same bind-mount constraint that already forced P1 to refactor in place. The
> two consequences are that the adapter would have nothing to serve, and that
> flipping `adapter-static` → `adapter-node` changes `web/build`'s shape and so
> breaks the CI deploy job, which is not retired until P5. So the SvelteKit
> work moves wholesale to P3, where the handlers arrive, the client cuts over
> and the deploy story changes together. P2 is the adapter and its tests.

- `src/db/schema.sql` — a clean single file, no migration chain. Read the 14
  existing migrations only to derive the *end state* of the columns
  (`players`, `game_sessions`, `game_events`); `ai_profiles` is dropped,
  `game_sessions.user_id` becomes `player_id`, and `game_events.clues_revealed`
  goes too (the runtime has never written it). Add a forward-only runner keyed
  on `PRAGMA user_version` for future schema changes.
- Repositories: `sessions.ts` (create / getById / listByPlayer / update),
  `events.ts` (append-with-next-sequence / listBySession), `players.ts`.
  Ownership checks (`player_id = ?`) live here — this is where RLS goes.
- `src/content.ts` reading blueprint JSON and `blueprint-images/*` off disk via
  `getBlueprintsDir()` / `getBlueprintImagesDir()` in
  [scripts/local-config.mjs](/scripts/local-config.mjs), with an in-memory
  cache. Two details the survey missed: blueprints come from **two**
  directories (the config root's, then the repo's `supabase/seed/blueprints`,
  exactly as `seed-storage.mjs` collects them), so ids have to be de-duplicated;
  and authored blueprints are not reliably named `<id>.json`, so the
  scan-for-embedded-id fallback matters locally too. Preserve the parse-failure
  logging semantics of `load.ts` even though transient-download retry is no
  longer needed.
- AI config from env, replacing `getAIProfileById()` with `resolveAIProfile()`.
  Keep `game-start`'s optional `ai_profile` body param mapping to named profiles
  (`mock`/`free`/`paid`) so `dev:ai:free` / `dev:ai:paid` keep working — now
  with no DB round-trip and no restart. Retain the resolved label on the session
  row for provenance, since the eval pipeline reads it.
- Prove the adapter against the contract with unit suites over a temporary
  database, since no server exercises it yet: ownership isolation, sequence
  allocation, the `game_events` cascade, blueprint precedence and parse
  failures, and profile resolution.

### P3 — Cut over client and tests (~2–3 days)

- **Move the engine**: `supabase/functions/_shared/*` →
  `packages/game-engine/src/`, and each endpoint handler →
  `packages/game-engine/src/endpoints/<name>.ts`. Now that Node serves the
  endpoints the sandbox constraint is gone, so the engine imports `@my2/shared`
  directly. `src/contract.ts` stops re-exporting `EngineContext` from the
  Supabase tree and becomes its definition.
- **Stand up the server tier** (moved here from P2): `adapter-node`,
  `hooks.server.ts` resolving the player cookie into `locals.player`,
  `routes/api/[endpoint]/+server.ts` dispatching to the handlers, and
  `routes/api/images/[blueprint]/[image]/+server.ts` serving bytes from
  `resolveImageFile()`. Keep `ssr = false` in `+layout.ts` — the app stays a
  SPA that happens to be served by a Node process.
- Replace the 6 `supabase.functions.invoke(name, {body})` calls with a
  `callApi(name, body)` helper that returns `{ data, error }`, so call sites in
  `store.svelte.ts` barely change. `FUNCTIONS_BASE_URL` → `/api`.
- Delete [web/src/lib/api/supabase.ts](/web/src/lib/api/supabase.ts) and drop
  `@supabase/supabase-js` from the web app.
- **Images simplify sharply:** with plain URLs there is no expiry, so
  [image-link-cache.ts](/web/src/lib/api/image-link-cache.ts) (including its
  5-minute refresh sweep and expiry buffer) is deleted and `SignedImage.svelte`
  becomes a plain `<img src>`.
- Replace the login route, `LoginForm.svelte`, and `auth-store.svelte.ts` with a
  small profile picker. `VITE_E2E_AUTH_BYPASS` and `web/e2e/test-auth.ts` go
  away — there is nothing left to bypass.
- Tests: integration/e2e bodies survive; rewrite `setupApiTestAuth` →
  `createTestPlayer()` returning a cookie header, and replace the ~12 per-file
  admin Supabase clients with direct repository access to the test DB.
  `auth-rls.test.ts` becomes `session-ownership.test.ts` (player A cannot read
  player B's session, now enforced in the repository).
  `cors-preflight.test.ts` is deleted — same-origin.
  `web/e2e/global-setup.ts` starts the Node server instead of
  `ensureSupabaseRunning()`.

### P4 — Mining and export (~1–2 days)

The capability the user asked for, built once the local DB is the real one.

- `scripts/dump-sessions.mjs` → `npm run dump`. Writes `sessions.jsonl`,
  `events.jsonl`, and `traces/<session_id>.json`, where each trace is the *same
  self-contained shape* `evaluation/trace/extract.mjs` already emits — so
  `npm run eval:trace -- --trace <file>` and `npm run eval:cases-from-trace`
  work on the output unchanged. Reuses `normalizeSessionTrace` from
  [evaluation/trace/lib/normalize.mjs](/evaluation/trace/lib/normalize.mjs).
  Filters: `--since`, `--player`, `--outcome`, `--blueprint`. Default output
  `$MYSTERY_CONFIG_ROOT/dumps/<timestamp>/`, with the `game.db` file copied
  alongside.
- `npm run sessions:ls` — bulk enumeration, which does not exist today at all.
- Wire `createLocalTraceSource()` into
  [evaluation/trace/lib/datasource.mjs](/evaluation/trace/lib/datasource.mjs) —
  it already has a clean 4-method injectable seam, so `extract.mjs` needs no
  change. Repoint `evaluation/runtime/lib/backends/endpoint.mjs`,
  `seed-session.mjs`, and `auth.mjs` at the local server and repository.

### P5 — Demolition and governance (~1–2 days)

- Delete `supabase/`, `deploy/`, `scripts/{deploy*,supabase-*,seed-storage,seed-auth-users,seed-ai,seed-all,gc-worktree-supabase,tail-edge-logs,update-bootstrap-passwords}.mjs`,
  and the port-slot allocation in `scripts/worktree-ports.mjs` (only the Vite
  port survives).
- CI collapses from four jobs to one: no Docker, no `supabase/setup-cli`, no
  pinned CLI version, no deploy job. The gate drops from ~25 min to a few
  minutes.
- `scripts/run-test-gate.mjs`: Phase 2 no longer needs Docker, so the
  `MYSTERY_CLOUD_SESSION` waiver becomes dead — remove it **and** the
  corresponding policy block in [AGENTS.md](/AGENTS.md).
- **Constitution amendment.** Principle IV pins the architecture to "Supabase
  Auth/Postgres/Storage/Edge Functions". Per the repo's own versioning policy,
  redefining a principle is MAJOR: `1.3.0` → `2.0.0`, with a Sync Impact Report
  and same-change updates to `.specify/templates/*`.
- Rewrite `docs/architecture.md`; heavily cut `docs/local-infrastructure.md` and
  `QUICKSTART.md`; delete `docs/deployment.md`; update
  `docs/backend-conventions.md`, `docs/testing.md`, `docs/ai-configuration.md`,
  `docs/ai-runtime.md`, `docs/project-structure.md`, and the
  `CLAUDE.md` rules for `supabase:restart`, mirrored modules, and worktree-safe
  commands.

## What disappears

Docker; the 9-service port table and slot allocator; `config.toml` generation;
orphaned-stack GC; `supabase:restart` after every function edit; `seed:auth`,
`seed:storage`, `seed:ai`; the table-grants migration; RLS policies; JWT
handling; signed URLs and their refresh sweep; `sync:shared` and the mirrored
modules; the 196-LOC duplicated blueprint schema; the service-role client (its
only use was reading an API key from a Postgres table); the CI deploy job and
two placeholder environments; the cloud-session test waiver; and the
`@supabase/supabase-js`, `wrangler`, and `@sveltejs/adapter-auto` dependencies.

## Verification

Per phase, `npm test` must pass — Phase 2 of the gate genuinely runs, never
waived.

End-to-end, after P3:

```bash
npm run dev
```

Then confirm by hand and with the suites:

- Start a mystery, move, search, talk, ask, end talk, accuse — win and lose paths.
- Kill the process, restart, resume the session from the in-progress list; the
  transcript must rebuild identically from `narration_events`.
- Blueprint artwork renders (no signed-URL expiry path left).
- Switch models without a restart: `npm run dev:ai:free`, `npm run dev:ai:paid`.
- Ownership: a second local profile cannot see the first profile's sessions.

Export path, after P4 — play a couple of sessions first so there is real data:

```bash
npm run sessions:ls
```

```bash
npm run dump
```

Then verify the round trip on real data:

```bash
npm run eval:trace -- --trace "$(ls -t "$MYSTERY_CONFIG_ROOT"/dumps/*/traces/*.json | head -1)"
```

And confirm ad-hoc mining works against the single file:

```bash
sqlite3 "$MYSTERY_CONFIG_ROOT/game.db" "select outcome, count(*) from game_sessions group by 1;"
```

Finally, `npm run eval:runtime` on the `endpoint` backend must pass against the
local server, proving the harness still reaches real handlers.

## Risks

- **P1 is the load-bearing phase.** If the engine extraction lands with the full
  suite green on Supabase, everything after it is adapter-swapping. If it is
  rushed, the later phases lose their reference implementation. Do not merge P1
  with a partially-green gate.
- ~~**`better-sqlite3` is a native addon.**~~ Closed in P0: N-API prebuilds ship
  for every platform this project targets, including CI's `linux-x64`, so no
  compiler is required.
- **Losing the hosted dev URL** means nobody plays without running the repo.
  This is accepted, and `adapter-node` leaves a single deployable server if that
  changes — more portable than the current design, not less.
- **The OpenRouter key moves from a Postgres column to `.env.local`.** Confirm
  the file is covered by the existing `.local` gitignore convention before P2
  lands.
