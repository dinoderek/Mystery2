# Game engine: what bites on touch

- **AI changes carry the mock.** Changing a contract, prompt, runtime context
  or provider selection updates the mock provider and its tests in the same
  change, or every mock suite drifts from live play (`docs/ai-runtime.md`).
- **Tests name their database.** A test that opens a database passes an
  explicit path, never `resolveDatabasePath()`, which names the play database
  (`docs/testing.md`).
- **`SCHEMA_VERSION` bumps reach `prod`.** The first branch to open `prod`
  upgrades it, and older checkouts are then locked out. A bump still needs its
  `MIGRATIONS` step in `src/db/client.ts`. This is a local game and the
  database can be wiped (`docs/backend-conventions.md`): state the bump in the
  PR and proceed, with no effort on preserving data or backups.
