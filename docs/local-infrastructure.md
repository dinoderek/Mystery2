# Running the game locally

The game is one Node process (Node 24; `./dev doctor` checks the host and
installs what is missing). `npm run dev` starts it on loopback; which AI
narrates is `docs/ai-configuration.md`.

## Where your data lives

| | |
|---|---|
| Databases | `$MYSTERY_CONFIG_ROOT/database/<name>/game.db` (gitignored) |
| Blueprints | `$MYSTERY_CONFIG_ROOT/blueprints/`, then the repo's `blueprints/` |
| Scenes | `$MYSTERY_CONFIG_ROOT/blueprint-scenes/` |
| Images | `$MYSTERY_CONFIG_ROOT/blueprint-images/` |
| AIs and keys | `ai.json`, `.env.local`, `.env.images.local` in the config root |

`MYSTERY_CONFIG_ROOT`, an absolute path, moves all of it outside the repo, so
clones and worktrees share content that outlives a checkout; unset, everything
resolves from the repo root. Machine-specific files carry a `.local` suffix and
are gitignored.

`MYSTERY_LIST_FIXTURES=1` shows `mock-case` in the menu.

## Which database

Content is shared across worktrees; databases are not.

| | |
|---|---|
| `npm run dev` | `database/<worktree name>/game.db`, or `main` in the main checkout |
| `npm run prod` | `database/prod/game.db` |
| `--db <name>` or `MYSTERY_DATABASE` | `database/<name>/game.db` |
| the suites | a `test` database in a temporary config root, deleted after |

The `db:*` scripts default to this checkout's database; `prod` needs `--force`
to reset or overwrite.

Copy one with `npm run db:copy`; `cp` can miss the `-wal`.

## One port per worktree

Each worktree's port is `51000 + hash(worktree name) % 1000 + 1`
(`lib/worktree-ports.mjs`; the main checkout uses 51000), and its database is
named from the same worktree (`lib/database-target.mjs`). The profile cookie is
named for the database (`packages/game-engine/src/player-cookie.ts`), since
cookies ignore the port.

## Playing from other devices

`./dev run --lan` (`--ai`, `--db` as for `run`) serves a build on every
interface, port 50000, on `prod`, and prints each LAN, `.local` and Tailscale
address, or says Tailscale is not running; `./dev doctor` reports them too. It
answers IP addresses, `localhost` and those names only
(`packages/game-engine/src/allowed-hosts.ts`); add others in
`MYSTERY_ALLOWED_HOSTS`.

Profiles have no passwords and `/settings` is open: serve home WiFi and a
private tailnet only, never a public interface, a forwarded port or Tailscale
Funnel. It is plain http (no `tailscale serve`), so a browser microphone, which
needs a secure context, works only on this machine.

## Troubleshooting

**Blueprint edits not showing?** Touch the file: the content cache keys on
mtime and size.

**"From before saves were started over."** A database older than schema 7 is never read
(`docs/backend-conventions.md`): `npm run db:reset [name]` starts it again.
