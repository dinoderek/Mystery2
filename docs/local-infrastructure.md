# Running the game locally

The game is one Node process (Node 24, `npm ci`; `./dev doctor` checks both and
installs what is missing). `npm run dev` starts it; which AI narrates is
`docs/ai-configuration.md`. `./dev` with no verb lists its verbs.

## Where your data lives

| | |
|---|---|
| Databases | `$MYSTERY_CONFIG_ROOT/database/<name>/game.db` (gitignored) |
| Blueprints | `$MYSTERY_CONFIG_ROOT/blueprints/`, then the repo's `blueprints/` |
| Scenes | `$MYSTERY_CONFIG_ROOT/blueprint-scenes/` |
| Images | `$MYSTERY_CONFIG_ROOT/blueprint-images/` |
| AIs and keys | `ai.json`, `.env.local`, `.env.images.local` in the config root |

`MYSTERY_CONFIG_ROOT` is an absolute path that moves all of it outside the
repo, so clones and worktrees share blueprints and images that survive a
checkout being deleted. Unset, everything resolves from the repo
root.

Machine-specific files carry a `.local` suffix and are gitignored; when a
template is useful it is committed without the suffix (`.env.images.example`).

## Which database

Content is shared across worktrees; databases are not.

| | |
|---|---|
| `npm run dev` | `database/<worktree name>/game.db`, or `main` in the main checkout |
| `npm run prod` | `database/prod/game.db` |
| `--db <name>` or `MYSTERY_DATABASE` | `database/<name>/game.db` |
| the suites | a `test` database in a temporary config root, deleted after |

Nothing in the tests writes to your databases. The `db:*` scripts default to
this checkout's database, and `prod` needs `--force` to reset or overwrite.

Copy a database with `npm run db:copy`, never `cp`: it snapshots through
SQLite's backup API, safe while the game writes; `cp` can miss transactions
still in the `-wal`. `sqlite3` can read a database while the game runs.

## One port and one database per worktree

Each worktree gets its own port, `51000 + hash(worktree name) % 1000 + 1`
(`lib/worktree-ports.mjs`; the main checkout uses 51000), and its own database,
named from the same worktree (`lib/database-target.mjs`), so neither moves when
you switch branches.

The profile cookie is named for the database
(`packages/game-engine/src/player-cookie.ts`): a port is not part of a cookie's
identity, so a fixed name would let signing in on one server sign you out of
every other.

## Troubleshooting

**Blueprint edits are not showing up.** The content cache is keyed on mtime and
size; a file replaced by one of identical size in the same millisecond needs a
touch.

**"From before saves were started over."** That database is never read
(`docs/backend-conventions.md`): `npm run db:reset [name]` starts it again.
