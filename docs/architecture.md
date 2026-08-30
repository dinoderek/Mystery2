# Mystery Game Architecture

## Decision summary

The game runs as **one Node process on the player's machine**. There is no
cloud backend, no container, and no separate API service.

- **Server**: SvelteKit on `adapter-node`. The same process serves the SPA and
  its `/api` routes.
- **Engine**: `packages/game-engine/` — the state machine, clue graph, prompt
  assembly, AI provider, twelve endpoint handlers, and the adapter they run
  against.
- **Database**: SQLite (`better-sqlite3`), one file.
- **Content**: blueprints and images read off disk.
- **Identity**: local profiles. A name, an id, and a cookie. No passwords.
- **Model provider**: OpenRouter, called from the server with a key that never
  reaches the browser.

Primary goals:

- **One command.** `npm run dev` starts everything. Nothing else has to be
  installed, started, seeded, or restarted.
- **Testability.** The full gate — unit, integration, API E2E, browser E2E —
  runs against a real server and a real database with no external dependencies.
- **A history worth mining.** Every session is a row in a file you can query
  with `sqlite3` and export for evaluation.

Non-goals:

- Hosting. Nobody plays without running the repo. `adapter-node` leaves a
  single deployable server if that changes.
- Offline play. Live narration still calls OpenRouter.
- Multi-user access control. Profiles separate one person's cases from
  another's on a shared machine; they are not a security boundary.

---

## Components and responsibilities

### The server (`web/`)

One SvelteKit app, `adapter-node`, `ssr = false`. It stays a SPA — it is simply
served by a process that also answers its API calls.

| Route | Responsibility |
|---|---|
| `src/routes/api/[endpoint]/+server.ts` | Dispatches to the engine's endpoint registry: checks the method, resolves the profile, builds an `EngineContext`, delegates. |
| `src/routes/api/images/[blueprint]/[image]/+server.ts` | Serves blueprint artwork off disk, gated on a signed-in profile and on the image being referenced by the blueprint. |
| `src/routes/api/player/+server.ts` | The current profile: read it, sign in, sign out. |
| `src/routes/api/players/+server.ts` | Every profile on this machine, for the picker. |
| `src/hooks.server.ts` | Resolves the `mystery-player-id` cookie into `locals.player`. |
| `src/lib/server/engine.ts` | Opens the engine once for the process. |

The browser talks to all of it through `src/lib/api/client.ts` — `callApi(name,
body)` returning `{ data, error }`. Same origin, so there is no CORS, no bearer
token, and no base URL to configure.

### The engine (`packages/game-engine/`)

The engine is the game. It does not know how it is hosted: handlers take an
`EngineContext` and reach the outside world only through it.

```
src/context.ts          EngineContext — the boundary. ~15 named operations.
src/context-local.ts    The implementation: SQLite + the filesystem.
src/endpoints/          handle(req, ctx) per endpoint, plus the registry.
src/db/                 schema.ts, client.ts (the only driver import), repositories.
src/content.ts          Blueprints and images off disk.
src/ai-profile.ts       AI profiles resolved from the environment.
src/ai-*.ts             Prompt assembly, contracts, provider.
src/state-machine.ts    Legal transitions.
src/clues.ts, clue-discovery.ts, forced-endgame.ts, narration.ts, speaker.ts
```

That boundary is what makes the storage substitutable: an adapter can be
written and tested alongside the current one, and the handlers cannot tell
which they have.

### Data

Three tables, no migration chain. `packages/game-engine/src/db/schema.ts` is
the whole schema; existing databases move forward through numbered steps keyed
on `PRAGMA user_version`.

- `players` — id, name. This is the whole of identity.
- `game_sessions` — one per case played, owned by a player.
- `game_events` — the append-only transcript, unique on `(session_id, sequence)`.

**Ownership lives in the repositories.** Every session and event statement is
scoped to one player. There is no row-level security underneath to catch a
query that forgets, which is why `docs/backend-conventions.md` treats a
repository method without a `player_id` filter as a bug.

Three connection pragmas are load-bearing: `journal_mode = WAL` so a reader
does not block the running game, `foreign_keys = ON` because SQLite defaults it
off and the `game_events` cascade depends on it, and `busy_timeout = 5000`.

**Where the database lives:** `<config root>/database/<name>/game.db`, where the
config root is `$MYSTERY_CONFIG_ROOT` when set and the repo root otherwise, and
the name is this worktree's — `main` in the main checkout, `prod` under
`npm run prod`. Blueprints and images stay shared across worktrees; the database
does not, because it is the one thing here carrying a schema version, and a
branch that bumps `SCHEMA_VERSION` upgrades a file no other branch can then
open. Tests never touch any of them: they are given an explicit path under a
temporary directory.

### Content

Blueprints are JSON files, searched for in the config root's `blueprints/`
first and then the ones committed to `blueprints/`. Images are files named by
image id. Both are parsed and cached in memory on mtime and size, so editing a
blueprint takes effect without a restart.

A malformed blueprint is skipped and logged rather than failing the catalog:
one bad file must not take the whole list down.

### AI

Profiles come from the environment, not a database:

| Profile | Source |
|---|---|
| `mock` | Built in. No configuration, no network. |
| `free` / `paid` | `.env.ai.<mode>.local` in the config root. |
| `default` | Whatever the running process is configured with, falling back to mock. |

`npm run dev:ai:free` is therefore a different command, not a different
database state — switching models needs no seeding and no restart. A session
records the profile *label* it was started with for provenance; the model
actually used is on each event's `model` column.

---

## Request lifecycle

A turn, end to end:

1. The browser calls `POST /api/game-move` with the session cookie.
2. `hooks.server.ts` resolves the cookie into `locals.player`.
3. `api/[endpoint]` finds `game-move` in the registry, checks the method,
   builds an `EngineContext` scoped to that player, and calls its handler.
4. The handler loads the session (scoped), validates the transition, loads the
   blueprint from disk, assembles the prompt, and calls the AI provider.
5. It appends a `game_events` row and updates the session in the same database
   file, then returns the turn response.

Every step is in-process except the model call.

---

## What this architecture does not have

No CORS, no tokens, no expiring image links, no privileged database
client, no object storage, no migration chain, no mirrored modules, no
containers, no port allocator beyond one port per worktree, and no deploy
pipeline. A single-player game on one machine needs none of it.
