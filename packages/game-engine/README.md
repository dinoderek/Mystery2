# `@my2/game-engine`

The game: the state machine, the clue graph, prompt assembly, the AI provider,
the twelve endpoint handlers, and the SQLite + filesystem adapter they run
against.

What it deliberately does not contain is a server. Handlers take an
`EngineContext` and reach the outside world only through it, so this package
knows nothing about HTTP, cookies, or the process it runs in — that is
`web/src/routes/api/`.

## What is here

| | |
|---|---|
| `src/context.ts` | `EngineContext` — the boundary. ~15 named operations. |
| `src/context-local.ts` | `createLocalEngine()` — opens the database and assembles a context per player |
| `src/endpoints/` | `handle(req, ctx)` per endpoint, and the registry the server dispatches through |
| `src/db/schema.ts` | the whole database: `players`, `game_sessions`, `game_events` |
| `src/db/client.ts` | the **only** file that imports a SQLite driver |
| `src/db/{players,sessions,events}.ts` | repositories; ownership checks live here |
| `src/content.ts` | blueprints and images off disk |
| `src/ai-profile.ts` | AI profiles from the environment |
| `src/ai-*.ts`, `src/role-request.ts` | prompt assembly, contracts, provider |
| `src/state-machine.ts`, `src/clues.ts`, `src/clue-discovery.ts`, `src/forced-endgame.ts`, `src/narration.ts`, `src/speaker.ts` | game rules |
| `src/paths.ts` | where the database and content live |

## Notes worth knowing

- **Ownership is enforced here, not underneath.** Every statement in
  `db/sessions.ts` and `db/events.ts` is scoped to one player. Nothing below
  this package will catch a query that forgets, so a repository method without
  a `player_id` filter is a security bug.
- **The driver is confined to one file.** `node:sqlite` is the intended
  eventual replacement for `better-sqlite3`, once it stops emitting
  `ExperimentalWarning`. Repositories are handed a `Db` interface and never see
  the driver, so that swap is a change to `db/client.ts` and nothing else. It
  is loaded through `createRequire` because a native addon must not be bundled.
- **`schema.ts`, not `schema.sql`.** The engine has to load identically under
  Vite's SSR bundle, vitest, and plain `node`, and only a module works in all
  three: a bundled chunk cannot read a sibling `.sql` file, and `?raw` is
  Vite-only.
- **There is no migration chain.** `schema.ts` is the current shape and is
  applied to a fresh database in one shot; existing databases move forward
  through the numbered steps in `client.ts`, keyed on `PRAGMA user_version`.
- **Three pragmas are load-bearing**: `journal_mode = WAL` (so a reader does not
  block the running game), `foreign_keys = ON` (off by default in SQLite; the
  `game_events` cascade depends on it), and `busy_timeout = 5000`.
- **The database is never the test database.** `resolveDatabasePath()` returns
  `<config root>/database/<name>/game.db`, naming it after the worktree so two
  checkouts cannot upgrade each other's schema; `MYSTERY_DATABASE` overrides the
  name. Tests pass an explicit path under a temporary directory.
