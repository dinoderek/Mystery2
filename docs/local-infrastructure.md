# Running the game locally

The game is one Node process. This document is what is left of a chapter that
used to describe nine Docker containers, a port allocator, generated config,
and orphaned-stack garbage collection.

## Prerequisites

Node 24 (`.nvmrc`), and `npm ci`. That is the list.

## Starting it

```bash
npm run dev
```

Mock narration, no network, no API key. `npm run dev:ai:free` and
`npm run dev:ai:paid` start the same server with a real model, reading
`.env.ai.free.local` / `.env.ai.paid.local` from the config root.

Switching between them is switching command. There is nothing to reseed and
nothing to restart, because a profile is env, not a database row.

## Where your data lives

| | |
|---|---|
| Database | `$MYSTERY_CONFIG_ROOT/game.db`, or `./data/game.db` (gitignored) |
| Blueprints | `$MYSTERY_CONFIG_ROOT/blueprints/`, then the repo's `blueprints/` |
| Images | `$MYSTERY_CONFIG_ROOT/blueprint-images/` |
| Env | `.env.local`, `.env.ai.<mode>.local`, `.env.images.local` in the config root |

`MYSTERY_CONFIG_ROOT` is an absolute path that moves all of it outside the
repo, so several clones and worktrees share one set of blueprints and one
history worth mining. Unset, everything resolves from the repo root.

Nothing in the tests writes to your database. The suites start the server
against a temporary config root and delete it afterwards.

## Worktrees

Each worktree gets its own port so two checkouts can run side by side:

```
web   51000 + slot     slot = hash(worktree name) % 1000 + 1
```

`lib/worktree-ports.mjs` derives it. The main checkout uses 51000. There is
nothing else to isolate — no database server, no containers, no project ids.

## Poking at the database

It is a SQLite file, so the usual tools work while the game is running (WAL
mode is on for exactly this reason):

```bash
sqlite3 "${MYSTERY_CONFIG_ROOT:-.}/game.db" "select id, mode, outcome, updated_at from game_sessions order by updated_at desc limit 10;"
```

To pull one session out as a self-contained artifact for the evaluation
pipeline:

```bash
npm run eval:trace:extract -- --session <id>
```

That reads the database directly, so the game does not have to be running, and
`--db <file>` points it at a copy.

## Troubleshooting

**Something is already listening on the port.** Another checkout of this repo,
or a server left running from a previous session. The test runner detects this
and fails with a clear message rather than testing against the wrong server;
for `npm run dev`, stop the other one.

**`better-sqlite3` failed to install.** It ships prebuilt binaries for macOS,
Linux, and Windows on x64 and arm64, so this should not happen — but if a
platform has no prebuild, npm falls back to compiling and needs a toolchain.

**The database is from a newer version of the engine.** `openDatabase()`
refuses to open a file whose `PRAGMA user_version` is ahead of the code rather
than corrupting it. Update the checkout, or start from a fresh database.

**Blueprint edits are not showing up.** The content cache is keyed on mtime and
size, so a saved edit is picked up on the next request. If you replaced a file
with one of identical size in the same millisecond, touch it.
