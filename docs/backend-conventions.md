# Backend Conventions

The rules for building the game engine and managing its data.

## 1. The Shared Boundary (API Contracts)

The boundary is the data exchanged between the UI and the engine's endpoints.
The engine holds the full `Blueprint`, solution included; the UI receives
sanitized views of it.

- All shapes at that boundary MUST be Zod schemas.
- The single source of truth is `packages/shared/src/mystery-api-contracts.ts`.
- Update those schemas **first** whenever the API boundary changes.
- Every endpoint that takes fields parses its request with its schema
  (`packages/game-engine/src/request.ts`) and answers `400` naming the bad
  field. The server does not check its responses; the browser parses every
  answer it reads, and the integration suite parses the real ones.

## 2. The Engine (`packages/game-engine/`)

All game logic runs in the engine, imported by the SvelteKit server.

- Endpoint handlers live in `packages/game-engine/src/endpoints/<name>.ts` and are listed in
  `packages/game-engine/src/endpoints/index.ts`; an unlisted name is a 404. The
  six are `game-start`, `game-enter`, `game-turn`, `game-get`,
  `game-sessions-list` and `blueprints-list`.
- The engine calls the AI provider with a server-side key; the UI never does.
- The engine imports `packages/shared` directly, with no build step between.

### The `EngineContext` seam

Handlers do **not** touch a database, a file path, or an HTTP detail. Each
exports `handle(req, ctx)`, and `web/src/routes/api/[endpoint]/+server.ts` does
the rest once for all of them: check the method, build the context, delegate.

`EngineContext` (`packages/game-engine/src/context.ts`) is the engine's whole boundary against its
host: `ctx.sessions`, `ctx.events`, `ctx.content`, `ctx.aiProfiles`, and
`ctx.player`. `packages/game-engine/src/context-local.ts` is the implementation, and it is the only
file that knows the state is a SQLite file and the content is two directories.

Rules:

- Add a **named operation** to the relevant store interface rather than
  reaching past the seam. If a handler needs a query that does not exist yet,
  extend `context.ts` and implement it in `context-local.ts`.
- Error convention: a genuine backend failure **throws**, and "does not exist"
  returns `null`/empty. Handlers map a throw to `500` and a `null` to
  `404`/`400`.
- A turn is saved by one operation, `ctx.sessions.saveTurn`: the session change
  and every event in one `Db.transaction`, sequences assigned inside it, after
  the model has answered. A stale expected sequence writes nothing and throws
  `SaveConflictError` (`409`). Never write a session and its events separately.
- Register the endpoint's allowed methods in `packages/game-engine/src/endpoints/index.ts`. The
  route returns `405` from that list; handlers do not re-check.

A direct file or driver reference in a handler is a bug: a second adapter must
be able to sit beside the first.

### The turn function

`game-turn` hands a typed line to `playTurn` in `packages/game-engine/src/turn/`, the one
place a turn's rules live. It parses the line with `command-grammar.ts` and
answers a refusal, a view or quit without loading the narrator. An action is
checked against the mode, resolved by its own resolver (the narrator call), and
costed by `effect.ts`, pure data in and out: the turn spent, the accusation the
last one forces, the patch and the events. It is saved once and answered from
the save. The action's event stores the line under `input`; transcripts fall
back to a rebuilt line for events without one.

### Access

There are two contexts, because the server has two behaviours — see "Identity
and access" in `docs/architecture.md` for why. An endpoint declares which one it
runs under in `packages/game-engine/src/endpoints/index.ts`:

- `access: "profile"` gets an `EngineContext`, and the route refuses the
  request without a profile.
- `access: "catalog"` gets a `CatalogContext` — content, and nothing owned by
  anybody — and the route does not ask for a profile at all.

The criterion is ownership: **does the endpoint touch somebody's sessions?** If
so it is `"profile"`; otherwise it needs none. Decide when you add the endpoint;
nothing can infer it. Write the narrower type in the handler's signature: a
`"catalog"` handler that later needs a session will not compile until somebody
changes its access on purpose.

`tests/api/unit/endpoint-access.test.ts` holds the registry to the criterion,
and `tests/api/integration/unauthenticated.test.ts` proves both behaviours over
HTTP. A new endpoint fails both until it is listed.

## 3. The Database

Six tables, defined once in `packages/game-engine/src/db/schema.ts`: three for
play, three for AI configuration.

- **Ownership is the repository's job.** Every statement in `db/sessions.ts`
  and `db/events.ts` is scoped to one player, with nothing underneath to catch a
  query that forgets: a method without a `player_id` filter crosses profiles.
  That is why the two contexts are separate types: a handler without a profile
  has no session store to get wrong.
- **One driver import.** Only `db/client.ts` imports `better-sqlite3` (via
  `createRequire`, so no bundler can inline a native addon), and only
  `context-local.ts` and `db/` import `db/`; the `imports` gate step checks
  both. Repositories receive a `Db` interface.
- **`schema.ts`, not `schema.sql`.** Only a module loads identically under
  Vite's SSR bundle, vitest and plain `node`.
- **Three pragmas are load-bearing:** `journal_mode = WAL` (a reader does not
  block the running game), `foreign_keys = ON` (off by default in SQLite; the
  `game_events` cascade depends on it), and `busy_timeout = 5000`.
- **Schema changes are forward-only.** Edit `schema.ts` so a fresh database is
  correct, add a matching entry to `MIGRATIONS` in `client.ts` so an existing
  one is upgraded, and bump `SCHEMA_VERSION`. A new database and an upgraded
  one must end up identical. `planMigrations()` refuses to cross a version with
  no step; nothing else catches a wrong step, since every suite builds its
  database from scratch. A bump reaches the `prod` database
  the first time any branch opens it and cannot be undone, so take a copy first
  (`npm run db:copy -- prod prod-backup`).
- **Types are honest at the boundary.** `GameSessionRow.mode` is a `GameMode`;
  `readGameMode()` in `state-machine.ts` alone narrows stored text.
- **Scope is a decision, not a default.** `db/sessions.ts` and `db/events.ts`
  are player-scoped; `db/players.ts` and `db/ai-settings.ts` are app-global, on
  `LocalEngine`. An app-global store that should have been scoped is the bug
  above.

## 4. Content

Blueprints and images are files. `packages/game-engine/src/content.ts` reads them, caches on mtime
and size, and skips-and-logs anything unparseable rather than failing the
catalog. `packages/game-engine/src/paths.ts` is the only place that decides where they are.

## 5. AI Profiles

`mock`, `free` and `paid` are environment, not data. `default` — the only one
the browser ever plays as — is chosen on the settings page and stored in
`app_settings`, though a process started with `AI_PROVIDER`/`AI_MODEL` still
outranks it. See `packages/game-engine/src/ai-profile.ts` and `docs/ai-configuration.md`.

A misconfigured profile throws; an unconfigured one returns `null`, which
handlers turn into `400 Invalid ai_profile`. A *stored* choice cannot be
misconfigured: `updateSettings` refuses live narration without both a key and a
model, so the invariant is kept at the write rather than repaired at the read.
