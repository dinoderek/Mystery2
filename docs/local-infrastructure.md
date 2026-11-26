# Running the game locally

One Node 24 process on loopback (`npm run dev`). AIs and keys:
`docs/ai-configuration.md`.

## Data

| | |
|---|---|
| Databases | `$MYSTERY_CONFIG_ROOT/database/<name>/game.db` |
| Blueprints | `$MYSTERY_CONFIG_ROOT/blueprints/`, then the repo's `blueprints/` |
| Scenes and images | `$MYSTERY_CONFIG_ROOT/blueprint-scenes/`, `blueprint-images/` |
| Playtests | `$MYSTERY_CONFIG_ROOT/playtests/<date>/` |

`MYSTERY_CONFIG_ROOT` (absolute) moves all of it outside the repo, so clones and
worktrees share content. `.local` files are machine-specific and gitignored.
`MYSTERY_LIST_FIXTURES=1` shows the test cases.

## Which database

Content is shared across worktrees; databases are not. `db:*` scripts default to
this checkout's database; `prod` needs `--force` to reset or overwrite.
`npm run db:copy` copies one (`cp` can miss the `-wal`).

| | |
|---|---|
| `npm run dev` | `database/<worktree name>/game.db`, or `main` in the main checkout |
| `npm run prod` | `database/prod/game.db` |
| `--db <name>` or `MYSTERY_DATABASE` | `database/<name>/game.db` |

`./dev sessions` lists a database's games (`--since <date>`, `--profile <name>`,
`--database <name or file>`, `--json`) read-only, with no server running.

## Playtests

Serving `prod` (`npm run prod`, `./dev run --lan`) records into
`playtests/<date>/`: `ai-calls.jsonl` (unless `AI_CALL_LOG` is set) and
`server.log`, appended; when the server stops, `game.db` (a snapshot) and
`notes.md`, a heading per game played that day. `./dev sessions bundle [<date>]`
redoes the last two after a `kill -9` or a closed terminal. Other databases record nothing. A bundle holds the
solution and everything typed: set `MYSTERY_CONFIG_ROOT` to keep it outside the repo.

## One port per worktree

Each worktree's port is hashed from its name (`lib/worktree-ports.mjs`; main
uses 51000); its database is named from it (`lib/database-target.mjs`). Profile
cookies are per database, not per port (`packages/game-engine/src/player-cookie.ts`).

## Other devices

`./dev run --lan` (`--ai`, `--db` as for `run`) serves `prod` on every interface,
port 50000, and prints each LAN, `.local` and Tailscale address, or says
Tailscale is not running. It answers IP addresses, `localhost`, the names it prints
and any in `MYSTERY_ALLOWED_HOSTS` only (`packages/game-engine/src/allowed-hosts.ts`,
`scripts/lib/lan-server.mjs`).

Profiles have no passwords and `/settings` is open: serve home WiFi or a private
tailnet only, never a public interface, forwarded port or Tailscale Funnel.
Plain http (no `tailscale serve`): a browser microphone needs a secure context,
so it works only here.

## Troubleshooting

**Blueprint edits not showing?** Touch the file: the cache keys on mtime and size.

**"From before saves were started over."** Databases older than schema 7 are
never read (`docs/backend-conventions.md`): `npm run db:reset [name]` restarts one.
