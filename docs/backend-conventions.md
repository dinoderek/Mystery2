# Backend Conventions

The rules for building the game engine and managing its data.

## The API boundary

The engine holds the full `Blueprint`, solution included; the UI receives
sanitized views of it.

- Every shape crossing the boundary is a Zod schema in
  `packages/shared/src/mystery-api-contracts.ts`. Change the schema **first**.
- Every endpoint that takes fields parses its request with its schema and
  answers `400` naming the bad field. The server does not check its responses;
  the browser parses every answer it reads, and the integration suite parses the
  real ones.

## The `EngineContext` seam

Handlers do **not** touch a database, a file path or an HTTP detail. They reach
the host only through `EngineContext` (`packages/game-engine/src/context.ts`);
`context-local.ts` is the only file that knows the state is a SQLite file and the
content is filesystem directories. A direct file or driver reference in a handler is a
bug: a second adapter must fit beside the first.

- Add a **named operation** to the store interface rather than reaching past
  the seam.
- **Errors:** a genuine backend failure **throws**; "does not exist" returns
  `null` or empty. Handlers map a throw to `500` and a `null` to `404`/`400`;
  a session saved with a case format no longer read throws `410`.
- **One save per turn.** `ctx.sessions.saveTurn` writes the session change and
  every event in one transaction, after the model has answered, so a failed
  turn writes nothing and a session never disagrees with its history; a stale
  expected sequence (a concurrent turn) writes nothing and answers `409`. Never write a session and its
  events separately.
- A turn's rules live in `packages/game-engine/src/turn/` and nowhere else.
- Whether an endpoint needs a profile is decided by ownership, when it is
  added: "Identity and access" in `docs/architecture.md`.

## The database

- **Ownership is the repository's job.** Every statement in `db/sessions.ts`,
  `db/events.ts` and `db/profile.ts` (a profile's own settings) is scoped to one
  player, with nothing underneath to catch a query that forgets. That is why the
  two contexts are separate types: a handler without a profile has no session
  store to get wrong.
- **Scope is a decision, not a default.** `db/players.ts` and
  `db/ai-settings.ts` are app-global. An app-global store that should have been
  scoped is the bug above.
- **One driver import.** Only `db/client.ts` imports `better-sqlite3` (via
  `createRequire`, so no bundler inlines a native addon), and only
  `context-local.ts` and `db/` import `db/`; the `imports` gate step checks
  both.
- **`schema.ts`, not `schema.sql`:** only a module loads the same under Vite's
  SSR bundle, vitest and plain `node`.
- **Three pragmas are load-bearing:** `journal_mode = WAL` (a reader does not
  block the running game), `foreign_keys = ON` (off by default in SQLite; the
  `game_events` cascade depends on it), and `busy_timeout = 5000` (a second
  writer waits instead of failing).
- **Stored text is narrowed in one place:** `readGameMode()` alone turns a
  stored mode into a `GameMode`.
- **Schema versions.** A `SCHEMA_VERSION` bump upgrades each existing database,
  `prod` included, the first time any checkout opens it, with no undo; older
  code then refuses that file, and `npm run db:reset` (`--force` for `prod`)
  starts it again.

## Content

Blueprints, scene recipes and images are files. `content.ts` logs and skips anything
unparseable rather than failing the catalog, and `paths.ts` alone decides where
they live.
