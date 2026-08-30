# Backend Conventions

The rules for building the game engine and managing its data.

## 1. The Shared Boundary (API Contracts)

The "Shared Boundary" is **specifically the data exchanged between the UI and
the engine's endpoints**.

- The engine holds comprehensive models internally (the full `Blueprint`, with
  its solution and internal reasoning).
- The frontend receives specific, sanitized _views_ via API payloads.
- All shapes at that boundary MUST be Zod schemas.
- The single source of truth is `packages/shared/src/mystery-api-contracts.ts`.
- Update those schemas **first** whenever the API boundary changes.

## 2. The Engine (`packages/game-engine/`)

All game logic runs in the engine, imported by the SvelteKit server.

- Endpoint handlers live in `src/endpoints/<name>.ts` and are listed in
  `src/endpoints/index.ts`. An unlisted name is a 404.
- The engine wraps the AI provider (OpenRouter) using a server-side key. The UI
  never calls OpenRouter directly.
- The engine imports `packages/shared` directly. There is no mirroring, no
  sandbox, and no build step between the source and the running game.

### The `EngineContext` seam

Handlers do **not** touch a database, a file path, or an HTTP detail. Each
endpoint exports

```ts
export async function handle(req: Request, ctx: EngineContext): Promise<Response>
```

and `web/src/routes/api/[endpoint]/+server.ts` does the rest once for all of
them: check the method, resolve the profile, build the context, delegate.

`EngineContext` (`src/context.ts`) is the engine's whole boundary against its
host: `ctx.sessions`, `ctx.events`, `ctx.content`, `ctx.aiProfiles`, and
`ctx.player`. `src/context-local.ts` is the implementation, and it is the only
file that knows the state is a SQLite file and the content is two directories.

Rules:

- Add a **named operation** to the relevant store interface rather than
  reaching past the seam. If a handler needs a query that does not exist yet,
  extend `context.ts` and implement it in `context-local.ts`.
- Error convention: a genuine backend failure **throws**, and "does not exist"
  returns `null`/empty. Handlers map a throw to `500` and a `null` to
  `404`/`400`.
- Register the endpoint's allowed methods in `src/endpoints/index.ts`. The
  route returns `405` from that list; handlers do not re-check.

This exists so the engine can be re-hosted without touching game logic: a
second adapter can be written and tested alongside the first, with the handlers
unable to tell which they have. Treat a direct file or driver reference in a
handler as a bug.

## 3. The Database

Three tables, defined once in `packages/game-engine/src/db/schema.ts`.

- **Ownership is the repository's job.** Every statement in `db/sessions.ts`
  and `db/events.ts` is scoped to one player. There is no row-level security
  underneath to catch a query that forgets, so a repository method without a
  `player_id` filter is a security bug, not a style problem.
- **One driver import.** `db/client.ts` is the only file that imports
  `better-sqlite3`, and it loads it through `createRequire` so no bundler can
  inline a native addon. Repositories receive a `Db` interface.
- **Schema changes are forward-only.** Edit `schema.ts` so a fresh database is
  correct, add a matching entry to `MIGRATIONS` in `client.ts` so an existing
  one is upgraded, and bump `SCHEMA_VERSION`. The two must agree: a new
  database and an upgraded one have to end up identical. Forgetting the
  `MIGRATIONS` entry is caught: `planMigrations()` refuses to cross a version
  with no step, naming it, rather than stamping one nothing produced. Nothing
  catches it afterwards, and no suite can — they all build their databases from
  scratch and never take the upgrade path. A bump reaches the `prod` database
  the first time any branch opens it and cannot be undone, so take a copy first
  (`npm run db:copy -- prod prod-backup`).
- **Types are honest at the boundary.** `GameSessionRow.mode` is a `GameMode`,
  not a string; `readGameMode()` in `state-machine.ts` is the single place that
  narrows text read back out of storage.

## 4. Content

Blueprints and images are files. `src/content.ts` reads them, caches on mtime
and size, and skips-and-logs anything unparseable rather than failing a whole
catalog. `src/paths.ts` is the only place that decides where they are.

## 5. AI Profiles

Profiles are environment, not data — see `src/ai-profile.ts` and
`docs/ai-configuration.md`. A misconfigured profile throws; an unconfigured one
returns `null`, which handlers turn into `400 Invalid ai_profile`.
