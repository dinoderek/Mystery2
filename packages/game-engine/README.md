# `@my2/game-engine`

The game: the state machine, the clue graph, prompt assembly, the AI provider,
the endpoint handlers, and the SQLite + filesystem adapter they run
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
| `src/db/schema.ts` | the whole database: `players`, `game_sessions`, `game_events`, plus `ai_keys`, `ai_models`, `app_settings` |
| `src/db/client.ts` | the **only** file that imports a SQLite driver |
| `src/db/{players,sessions,events}.ts` | repositories; ownership checks live here |
| `src/db/ai-settings.ts` | labelled keys and models, and the row that selects among them |
| `src/content.ts` | blueprints and images off disk |
| `src/ai-profile.ts` | AI profiles: `mock`/`free`/`paid` from the environment, `default` from the settings row |
| `src/ai-settings-env.ts` | the labelled keys and models the environment contributes at startup |
| `src/ai-*.ts`, `src/role-request.ts` | prompt assembly, contracts, provider |
| `src/state-machine.ts`, `src/clues.ts`, `src/clue-discovery.ts`, `src/forced-endgame.ts`, `src/narration.ts`, `src/speaker.ts` | game rules |
| `src/paths.ts` | where the database and content live |

## Notes worth knowing

The rules for working in here — ownership in the repositories, the
`EngineContext` seam, forward-only schema changes — are
`docs/backend-conventions.md`. What the code alone does not explain:

- **`schema.ts`, not `schema.sql`.** The engine has to load identically under
  Vite's SSR bundle, vitest and plain `node`, and only a module works in all
  three: a bundled chunk cannot read a sibling `.sql` file, and `?raw` is
  Vite-only.
- **Three pragmas are load-bearing:** `journal_mode = WAL` (a reader does not
  block the running game), `foreign_keys = ON` (off by default in SQLite; the
  `game_events` cascade depends on it), and `busy_timeout = 5000`.
- **The driver is confined to `db/client.ts`** and loaded through
  `createRequire`, because a native addon must not be bundled. `node:sqlite` is
  the intended replacement for `better-sqlite3` once it stops emitting
  `ExperimentalWarning`; the swap touches that file only.
