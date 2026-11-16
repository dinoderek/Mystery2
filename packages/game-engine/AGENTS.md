# Game engine: what bites on touch

- **AI changes carry the mock.** Changing a contract, prompt, runtime context
  or provider selection updates the mock provider and its tests in the same
  change, or every mock suite drifts from live play (`docs/ai-runtime.md`).
- **Tests name their database.** A test that opens a database passes an
  explicit path, never `resolveDatabasePath()`, which names the play database
  (`docs/testing.md`).
- **`SCHEMA_VERSION` bumps reach `prod`.** The first branch to open `prod`
  upgrades it, and older checkouts are then locked out. This is a local game
  and the database can be wiped: say so in the PR and proceed; no migration
  or backup work (`docs/backend-conventions.md`).
