# Mystery Game Architecture

## Decision summary

The game runs as **one Node process on the player's machine**. There is no
cloud backend, no container, and no separate API service.

- **Server**: SvelteKit on `adapter-node`. The same process serves the SPA and
  its `/api` routes.
- **Engine**: `packages/game-engine/` — the state machine, clue graph, prompt
  assembly, AI provider, endpoint handlers, and the adapter they run
  against.
- **Database**: SQLite (`better-sqlite3`), one file.
- **Content**: blueprints and images read off disk.
- **Identity**: local profiles. A name, an id, and a cookie. No passwords —
  signing in exists to *create and pick a profile*, not to keep anyone out.
- **Model provider**: OpenRouter, or the local `claude` CLI, called from the
  server; a key never reaches the browser.

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
  another's on a shared machine; they are not a security boundary, and there is
  nothing on the other side of them to protect — the database is a file the
  player owns and the content is a directory they can read.

---

## Repository layout

| Directory | Holds |
|---|---|
| `web/` | The SvelteKit server and SPA (`docs/ui.md`) |
| `packages/game-engine/` | The game (`docs/backend-conventions.md`) |
| `packages/shared/` | Zod schemas both sides import: the blueprint and the API contracts |
| `packages/blueprint-generator/` | Blueprint generation, used by the operator scripts |
| `blueprints/` | Committed blueprints, including the fixtures the suites play |
| `scripts/`, `lib/` | Starting the game, the test runners, databases, generation |
| `tests/` | API unit, integration and E2E suites, and `testkit/` |
| `evaluation/` | Blueprint and game-master evaluation (`docs/evaluation-pipeline.md`) |
| `database/` | Local databases, gitignored (`docs/local-infrastructure.md`) |

## Components and responsibilities

### The server (`web/`)

One SvelteKit app, `adapter-node`, `ssr = false`. It stays a SPA — it is simply
served by a process that also answers its API calls.

| Route | Responsibility |
|---|---|
| `src/routes/api/[endpoint]/+server.ts` | Dispatches to the engine's endpoint registry: checks the method, builds the context the endpoint's access calls for, delegates. |
| `src/routes/api/images/[blueprint]/[image]/+server.ts` | Serves blueprint artwork off disk, confined to images the blueprint references. |
| `src/routes/api/player/+server.ts` | The current profile: read it, sign in, sign out. |
| `src/routes/api/players/+server.ts` | Every profile on this machine, for the picker. |
| `src/hooks.server.ts` | Resolves the profile cookie into `locals.player`. |
| `src/lib/server/engine.ts` | Opens the engine once for the process, and names the profile cookie for the database it opened. |

The browser talks to all of it through `src/lib/api/client.ts` — `callApi(name,
body)` returning `{ data, error }`. Same origin, so there is no CORS, no bearer
token, and no base URL to configure.

### Identity and access

Signing in is naming a profile: it is created if it does not exist, the answer
is a cookie holding its id, and there is no password, because there is nothing
to protect — the player owns the machine, the database file and the content. A
profile keeps one person's cases apart from another's, and that is all.

So the server has **two behaviours**, and every route picks one:

- **Per profile.** The request manages or plays a game session, so it has to
  run as somebody. Without a profile it is refused; with one it is handed a
  context whose session and event stores are scoped to that profile and cannot
  reach past it.
- **No profile.** The request only reads content every profile shares. It is
  served to anyone, and the context it is given holds nothing owned, so there
  is no scope to get wrong.

**The criterion is ownership, not secrecy:** does this touch somebody's
sessions? If it does, it is per profile; if it does not, it needs none. The
question is never how sensitive the data looks — shared content stays shared
even when it would be tidier to gate it, and a session stays scoped even when
its contents are dull.

Endpoints declare which they are in the engine's registry
(`packages/game-engine/src/endpoints/index.ts`), which is where the split is
written down for everything the game itself serves;
`docs/backend-conventions.md` covers how to add one.

A few routes sit outside the registry under `web/src/routes/api/`: `player`
and `players` (how you get a profile) and `ai-settings` (installation
configuration). They take no profile by the same criterion, but need more than
a `CatalogContext` holds, so they reach the engine through `getEngine()`. Keep
that list short: a route here is one the registry cannot express, not a
shortcut around it. The browser is stricter than the server on purpose
(`docs/ui.md`).

### The engine (`packages/game-engine/`)

The engine is the game. It does not know how it is hosted: handlers take an
`EngineContext` and reach the outside world only through it. That boundary is
what makes the storage substitutable — an adapter can be written and tested
alongside the current one, and the handlers cannot tell which they have. How
to work inside it is `docs/backend-conventions.md`.

### Data

Six tables. `packages/game-engine/src/db/schema.ts` is the whole schema, always
describing the current end state; existing databases move forward through
numbered steps keyed on `PRAGMA user_version`.

Play:

- `players` — id, name. This is the whole of identity.
- `game_sessions` — one per case played, owned by a player.
- `game_events` — the append-only transcript, unique on `(session_id, sequence)`.

AI configuration, which is per-installation rather than per-player:

- `ai_keys`, `ai_models` — labelled OpenRouter keys and models, either typed on
  the settings page or re-read from the environment on every start.
- `app_settings` — one row, holding the mock/live choice and which key and model
  it selects. See `docs/ai-configuration.md`.

Ownership is enforced in the session and event repositories, with nothing
underneath to catch a query that forgets (`docs/backend-conventions.md`).

The database is `<config root>/database/<name>/game.db`, one per worktree plus
`prod`; content is shared across worktrees. `docs/local-infrastructure.md`
explains why and how to manage them. Tests never touch any of them.

### Content

Blueprints are JSON files, searched for in the config root's `blueprints/`
first and then the ones committed to `blueprints/`. Images are files named by
image id. Both are parsed and cached in memory on mtime and size, so editing a
blueprint takes effect without a restart.

A malformed blueprint is skipped and logged rather than failing the catalog:
one bad file must not take the whole list down.

### AI

Four profiles. `mock` is built in; `free` and `paid` are `.env.ai.<mode>.local`
files in the config root; `default` — the only one the browser plays as —
resolves per request from `AI_PROVIDER`/`AI_MODEL` in the process environment,
then the choice stored on the settings page, then mock. A session records the
profile *label* it started with; the model actually used is on each event's
`model` column. `docs/ai-configuration.md` owns the detail.

---

## Request lifecycle

A turn, end to end:

1. The browser calls `POST /api/game-move` with the session cookie.
2. `hooks.server.ts` resolves the cookie into `locals.player`.
3. `api/[endpoint]` finds `game-move` in the registry, checks the method, sees
   it runs per profile, builds an `EngineContext` scoped to that player, and
   calls its handler.
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
