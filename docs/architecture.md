# Mystery Game Architecture

## Decision summary

The game runs as **one Node process on the player's machine**. There is no
cloud backend, container or separate API service.

- **Server**: SvelteKit on `adapter-node`. One process serves the SPA and `/api`.
- **Engine**: `packages/game-engine/`. The state machine, clue graph, prompts,
  AI provider, endpoint handlers and the adapter they run against.
- **Database**: SQLite (`better-sqlite3`), one file.
- **Content**: blueprints and images, read off disk.
- **Identity**: local profiles, a name and an id. No passwords.
- **Model provider**: OpenRouter, or the local `claude` CLI, called from the
  server. A key never reaches the browser.

Goals: **one command** (`npm run dev` starts everything; nothing else is
installed, started, seeded or restarted); **testability** (the full gate runs
against a real server and database, with no external dependencies); **a
queryable history** (every session is a row you can export).

Non-goals: hosting, offline play, and multi-user access control. Profiles keep
one person's cases apart from another's on a shared machine. They are not a
security boundary.

## Repository layout

| Directory | Holds |
|---|---|
| `web/` | The SvelteKit server and SPA (`docs/ui.md`) |
| `packages/game-engine/` | The game (`docs/backend-conventions.md`) |
| `packages/shared/` | Zod schemas both sides import |
| `packages/blueprint-generator/` | Blueprint generation, for operator scripts |
| `blueprints/` | Committed blueprints, including the suites' fixtures |
| `scripts/`, `lib/` | Starting the game, test runners, databases, generation |
| `tests/` | API unit, integration and E2E suites, and `testkit/` |
| `evaluation/` | Evaluation (`docs/evaluation-pipeline.md`) |
| `database/` | Local databases, gitignored (`docs/local-infrastructure.md`) |

## Components

**The server (`web/`).** `src/routes/api/[endpoint]/+server.ts` dispatches to the
engine's endpoint registry: it checks the method, builds the context the endpoint
needs, and delegates. `src/hooks.server.ts` resolves the profile cookie into
`locals.player`. The browser reaches all of it through `src/lib/api/client.ts`,
on the same origin, with no base URL.

A few routes sit outside the registry: `player` and `players` (how you get a
profile) and `ai-settings` (installation configuration). They reach the engine
through `getEngine()`. A route belongs here only when the registry cannot
express it.

**The engine (`packages/game-engine/`).** Handlers take an `EngineContext` and
reach the outside world only through it, which keeps storage substitutable
(`docs/backend-conventions.md`).

**Data.** `packages/game-engine/src/db/schema.ts` is the whole schema, always the
current end state. Existing databases move forward through numbered steps keyed
on `PRAGMA user_version`. Play uses `players`, `game_sessions` (one per case,
owned by a player) and `game_events` (the append-only transcript, unique on `(session_id, sequence)`). AI
configuration is per installation: `ai_keys`, `ai_models` and `app_settings`
(`docs/ai-configuration.md`).

The database is `<config root>/database/<name>/game.db`, one per worktree plus
`prod` (`docs/local-infrastructure.md`). Tests never touch any of them.

**Content.** Blueprints are JSON, searched in the config root's `blueprints/`
and then the committed ones. A malformed blueprint is skipped and logged, never
failing the whole catalog. Blueprints and images are cached on mtime and size, so edits take effect without a restart.

**AI.** Four profiles: `mock` (built in), `free` and `paid` (`.env.ai.<mode>.local`
files), and `default`, the only one the browser plays as. `default` resolves per
request from the environment, then the settings page, then mock.
`docs/ai-configuration.md` owns the detail.

## Identity and access

Signing in names a profile. It is created if missing, and the answer is a
cookie holding its id. The server has two behaviours, and every route picks one:

- **Per profile.** The request manages or plays a session. Without a profile it
  is refused. With one, it gets a context scoped to that profile's sessions and
  events.
- **No profile.** The request reads only content every profile shares. It is
  served to anyone, and its context holds nothing owned.

**The criterion is ownership, not secrecy.** Does this touch somebody's
sessions? If so it is per profile. The question is never how sensitive the data
looks: shared content stays shared, and a session stays scoped even when it is
dull. Endpoints declare which they are in `packages/game-engine/src/endpoints/index.ts`.

## Request lifecycle

A turn, end to end:

1. The browser calls `POST /api/game-turn` with the session cookie and the line
   as typed.
2. `hooks.server.ts` resolves the cookie into `locals.player`.
3. The dispatcher finds `game-turn`, checks the method, and builds a per-profile
   `EngineContext`.
4. The engine decides what the line means. A refusal, view or quit is answered
   at once. An action loads the scoped session, checks the mode, loads the
   blueprint, and calls the AI provider.
5. One transaction saves the session change and its events. The answer comes
   from that save, and the browser parses it with the shared schema.

Every step is in-process except the model call.

## What this architecture does not have

No CORS, tokens, expiring image links, privileged database client, object
storage, migration chain, mirrored modules, containers, port allocator beyond
one port per worktree, or deploy pipeline. A single-player game on one machine
needs none of them.
