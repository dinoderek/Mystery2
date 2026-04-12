# Local Infrastructure

This document explains the worktree-isolated local Supabase architecture.

For day-to-day commands such as restart, reset, seeding, and profile switching,
use [`QUICKSTART.md`](../QUICKSTART.md). This file focuses on why the local
stack behaves the way it does, which scripts make it safe in worktrees, and how
to troubleshoot odd cases.

## Overview

The local stack runs Supabase services in Docker containers. The base
configuration lives in `supabase/config.toml.template` (checked in) with
`project_id = "mystery"` and default ports. The actual `supabase/config.toml`
is generated from this template at startup and is gitignored.

The repo is designed so that separate git worktrees can run isolated local
Supabase stacks at the same time without clobbering each other's containers,
ports, Edge Function mounts, or test state.

## Why Worktree Isolation Exists

Without isolation, all worktrees would share the same `project_id` and ports.
The first worktree to run `supabase start` would effectively win, causing later
worktrees to reuse the wrong containers. That creates three major failures:

- Edge Functions serving stale code from another worktree
- migrations and seeded state drifting from the current checkout
- tests passing or failing against the wrong codebase

## How Isolation Works

Each worktree gets a derived `project_id` and an offset port range.

1. `scripts/worktree-ports.mjs` detects whether the current directory is the
   main checkout or a git worktree.
2. For worktrees, it hashes the worktree name into a deterministic slot.
3. `patchConfigToml()` generates `supabase/config.toml` from
   `config.toml.template` with the derived `project_id` and ports.
4. `injectWorktreeEnv()` exports the matching `API_URL`, `SUPABASE_URL`,
   `VITE_SUPABASE_URL`, and `VITE_DEV_PORT` so scripts and the web app point at
   the right local services.
5. `ensureSupabaseRunning()` wires this into the normal startup flow, so repo
   scripts can safely target the current worktree.

### Port Layout

Ports are divided into three bands. Supabase services share the 54xxx range
with stride 10 per slot. Vite and edge inspector each get their own band with
stride 1, giving 1000 usable slots.

| Service | Base (main) | Stride | Slot 1 | Slot 2 |
| --- | --- | --- | --- | --- |
| Vite dev server | 51000 | +1 | 51001 | 51002 |
| Edge Inspector | 53000 | +1 | 53001 | 53002 |
| API (functions) | 54331 | +10 | 54341 | 54351 |
| Database | 54332 | +10 | 54342 | 54352 |
| Shadow DB | 54330 | +10 | 54340 | 54350 |
| Studio | 54333 | +10 | 54343 | 54353 |
| Inbucket | 54334 | +10 | 54344 | 54354 |
| Analytics | 54337 | +10 | 54347 | 54357 |
| DB Pooler | 54339 | +10 | 54349 | 54359 |

### Key Files

| File | Role |
| --- | --- |
| `supabase/config.toml.template` | Checked-in base config; source of truth for `config.toml` |
| `scripts/worktree-ports.mjs` | Worktree detection, port derivation, config generation |
| `scripts/supabase-utils.mjs` | Startup orchestration, readiness checks, env injection |
| `scripts/gc-worktree-supabase.mjs` | Garbage-collects orphaned worktree stacks |

## Operational Rules

- In worktrees, prefer the repo wrapper scripts (`npm run supabase:*`,
  `npm run seed:*`, repo test scripts) over raw `npx supabase` commands.
- Raw `npx supabase` commands are risky in worktrees because `config.toml` may
  not have been generated yet for the current worktree.
- If you truly need a raw CLI command such as `supabase status` or
  `supabase migration new`, run `npm run supabase:patch` first.
- Test and dev scripts use `ensureSupabaseRunning()` plus
  `injectWorktreeEnv()`, so they automatically inherit the correct worktree
  ports.

## Garbage Collection

Worktree stacks can outlive the worktree directory that created them. Cleanup
happens in three layers:

1. opportunistic GC inside `ensureSupabaseRunning()`
2. manual cleanup with `npm run supabase:gc`
3. machine restart, since these containers are not configured with
   `--restart=always`

The opportunistic GC pass looks for `mystery-wt-*` containers and stops stacks
whose worktree no longer exists.

## Main Checkout Behavior

Outside a worktree, the system behaves like a normal single-checkout setup:

- `project_id` stays `mystery`
- default ports remain unchanged
- `config.toml` is generated as an unmodified copy of the template
- inherited env vars are preserved

## Troubleshooting

### Edge Functions appear stale

1. Verify which Supabase containers are running:

   ```bash
   docker ps --filter "label=com.supabase.cli.project" --format "{{.Names}}"
   ```

2. Restart the stack from the affected checkout with `npm run supabase:restart`.

This is especially important after changing files under `supabase/functions/`
or `supabase/functions/_shared/`.

### Port conflicts

Inspect running containers and project labels:

```bash
docker ps --filter "label=com.supabase.cli.project" \
  --format "table {{.Names}}\t{{.Labels}}"
```

If stale worktree stacks are present, clean them up with `npm run supabase:gc`.

The slot allocator has 1000 buckets, so collisions are extremely rare (~0.3%
with 3 concurrent worktrees). If one does occur, recreating the worktree under
a different name will move it to a new slot.

### A new worktree has an empty database

Each worktree gets its own database. After first startup, seed it from that
worktree with `npm run seed:all`.

### You need a clean local database

Use `npm run supabase:reset`, then reseed with `npm run seed:all`.

### You need raw `npx supabase` in a worktree

Generate the config first with `npm run supabase:patch`.
