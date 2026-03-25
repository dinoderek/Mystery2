# Local Infrastructure

This document covers how the local Supabase development stack is managed,
including the worktree isolation system that enables concurrent development
across multiple git worktrees.

## Overview

Every developer (and every Claude Code agent) runs a local Supabase stack via
`supabase start`.  The stack includes Postgres, Auth, Storage, Edge Functions,
Studio, and supporting services — all as Docker containers.

The project uses `project_id = "mystery"` in `supabase/config.toml`.  Docker
containers are labelled with this project_id, which determines container names
and avoids collisions with other Supabase projects on the same machine.

## The Worktree Problem

Git worktrees let you check out multiple branches simultaneously in separate
directories.  Claude Code uses worktrees extensively for parallel task
execution.

**Without isolation**, all worktrees share the same `project_id` and ports.
The first worktree to run `supabase start` "wins" — its Docker containers
mount *its* `supabase/functions/` directory.  All other worktrees silently
reuse those containers, which means:

- Edge Functions serve **stale code** from whichever worktree started first.
- Database migrations may be out of sync.
- Tests pass or fail based on another worktree's code.

## Worktree Isolation Architecture

The solution gives each worktree its own fully isolated Supabase stack with a
unique `project_id` and port range.

### How It Works

1. **Detection:** `scripts/worktree-ports.mjs` uses `git rev-parse` to detect
   whether the current directory is a worktree or the main checkout.

2. **Port allocation:** For worktrees, a deterministic slot (1–50) is computed
   from a SHA-256 hash of the worktree name.  Each port in the base config
   gets offset by `slot × 100`:

   | Service           | Main checkout | Worktree slot 1 | Worktree slot 2 |
   | ----------------- | ------------- | --------------- | --------------- |
   | API (functions)   | 54331         | 54431           | 54531           |
   | Database          | 54332         | 54432           | 54532           |
   | Shadow DB         | 54330         | 54430           | 54530           |
   | Studio            | 54333         | 54433           | 54533           |
   | Inbucket          | 54334         | 54434           | 54534           |
   | Analytics         | 54337         | 54437           | 54537           |
   | DB Pooler         | 54339         | 54439           | 54539           |
   | Edge Inspector    | 8083          | 8183            | 8283            |
   | Vite dev server   | 5173          | 5273            | 5373            |

3. **Config patching:** Before `supabase start`, `patchConfigToml()` rewrites
   `supabase/config.toml` in the worktree with the derived project_id and
   ports.  Since worktrees have their own working tree, this does not affect
   the main checkout or other worktrees.

4. **Env propagation:** `injectWorktreeEnv()` sets `API_URL`, `SUPABASE_URL`,
   `VITE_SUPABASE_URL`, and `VITE_DEV_PORT` so that seed scripts, test
   runners, and the dev server all point at the correct ports.  In a worktree
   these values are **authoritative** — they override any inherited env vars
   to prevent scripts from accidentally targeting the main checkout's
   Supabase instance or Vite port.

5. **Automatic in `ensureSupabaseRunning()`:** All of this is wired into the
   existing startup flow — no manual steps required.

### Key Files

| File                              | Role                                                 |
| --------------------------------- | ---------------------------------------------------- |
| `scripts/worktree-ports.mjs`      | Worktree detection, port derivation, config patching |
| `scripts/gc-worktree-supabase.mjs`| Garbage collection of orphaned worktree stacks       |
| `scripts/supabase-utils.mjs`      | Startup orchestration (calls the above)              |

## Garbage Collection

Worktrees are ephemeral — they get deleted when a task is done.  But their
Docker containers keep running.  Three cleanup layers handle this:

### Layer 1: Opportunistic GC (automatic)

Every call to `ensureSupabaseRunning()` runs a fast GC pass (~100 ms):

1. Lists Docker containers with `mystery-wt-*` project labels.
2. Compares against `git worktree list`.
3. Stops containers whose worktree directory no longer exists.

This means stale stacks are cleaned up the next time *any* worktree starts
Supabase.

### Layer 2: Manual GC

```bash
npm run supabase:gc
```

Run this any time to force a cleanup sweep.  Useful after bulk worktree
deletion or when Docker resources feel bloated.

### Layer 3: Machine restart

Supabase containers are not configured with `--restart=always`, so a machine
reboot clears all local stacks.

## Main Checkout Behavior

When not in a worktree (the normal `git clone` directory), everything works
exactly as before:

- `project_id` stays `mystery`.
- Ports stay at their defaults (54331, etc.).
- No config patching or GC runs.
- The `injectWorktreeEnv()` call is a no-op that preserves existing env values.

## Port Collisions

The hash-based slot allocation provides 50 slots.  A collision between two
concurrent worktrees is possible but unlikely (~2% chance with 2 worktrees,
~10% with 3).  If you see port-in-use errors, delete and recreate the
worktree — a different name will almost certainly get a different slot.

## Migrating From project_id "w1"

The project was previously configured with `project_id = "w1"`.  After pulling
this change:

1. Stop the old stack: `npx supabase stop` (from the main checkout).
2. If Docker still has `supabase_*_w1` containers, remove them:
   `docker ps -a --filter "label=com.supabase.cli.project=w1" -q | xargs docker rm -f`
3. Run `npm run setup:local` to start the new `mystery` stack.

## Troubleshooting

### Edge Functions serving stale code

This should no longer happen with worktree isolation.  If it does:

1. Verify the worktree has its own containers:
   `docker ps --filter "label=com.supabase.cli.project" --format "{{.Names}}"`
2. Restart Supabase in the affected worktree: `npm run supabase:restart`

### Port conflicts

Check which containers are running and their project labels:

```bash
docker ps --filter "label=com.supabase.cli.project" \
  --format "table {{.Names}}\t{{.Labels}}"
```

Force-cleanup all worktree stacks:

```bash
npm run supabase:gc
```

### Database needs reseeding after worktree creation

Each worktree stack has its own database.  After the first `supabase start` in
a new worktree, run:

```bash
npm run setup:local
```

This seeds blueprints, auth users, and AI profiles into the worktree's
database.
