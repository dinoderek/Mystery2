# `@my2/game-engine`

The engine's **local platform adapter**: a SQLite + filesystem implementation of
`EngineContext`, the seam every endpoint handler talks to.

It is the twin of `supabase/functions/_shared/context-supabase.ts`. Handlers see
only the interface, so the two are interchangeable — that is the whole point of
the seam, and the reason the move off Supabase can happen underneath a green
test suite.

## What is here

| | |
|---|---|
| `src/context-local.ts` | `createLocalEngine()` — opens the database and assembles a context per player |
| `src/db/schema.ts` | the whole database: `players`, `game_sessions`, `game_events` |
| `src/db/client.ts` | the **only** file that imports a SQLite driver |
| `src/db/{players,sessions,events}.ts` | repositories; ownership checks live here |
| `src/content.ts` | blueprints and images off disk |
| `src/ai-profile.ts` | AI profiles from the environment, replacing the `ai_profiles` table |
| `src/paths.ts` | where the database and content live |
| `src/contract.ts` | re-export of the `EngineContext` types |

## What is *not* here yet

The rest of the engine. The shared modules and the twelve endpoint handlers are
still under `supabase/functions/`, because an Edge Function cannot import out of
that directory (see `docs/backend-conventions.md` §2) and Supabase is still the
runtime serving gameplay. P3 of the local-execution plan moves them in and puts
SvelteKit in front of them; until then this package is exercised by the
`tests/api/unit/local-engine-*.test.ts` suites rather than by a running server.

Progress and next steps: [`docs/plans/local-execution/status.md`](../../docs/plans/local-execution/status.md).

## Notes worth knowing

- **The driver is confined to one file.** `node:sqlite` is the intended
  eventual replacement for `better-sqlite3`, once it stops emitting
  `ExperimentalWarning`. Repositories are handed a `Db` interface and never see
  the driver, so that swap is a change to `db/client.ts` and nothing else.
- **There is no migration chain.** `schema.ts` is the current shape and is
  applied to a fresh database in one shot; existing databases move forward
  through the numbered steps in `client.ts`, keyed on `PRAGMA user_version`. The
  14 files in `supabase/migrations/` were read for their *end state* only —
  existing session data is disposable by design.
- **Three pragmas are load-bearing**: `journal_mode = WAL` (so a reader does not
  block the running game), `foreign_keys = ON` (off by default in SQLite; the
  `game_events` cascade depends on it), and `busy_timeout = 5000`.
- **The database is never the test database.** `resolveDatabasePath()` returns
  `$MYSTERY_CONFIG_ROOT/game.db` when that is set and `./data/game.db`
  otherwise. Tests pass an explicit path under a temporary directory.
