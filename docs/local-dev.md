# Local Development

## Goals

- One command starts the entire stack:
  - Supabase local (DB/Auth/Storage/Functions)
  - Web UI dev server (SvelteKit/Vite)
- Reuse running Supabase instances to support parallel dev/test agents efficiently.
- Local runs mirror cloud architecture: static UI talking to Supabase + Edge Functions.

## Prerequisites

- Docker (for Supabase local)
- Supabase CLI installed and authenticated for project linking
- Node.js + pnpm (or npm/yarn)

## Local run: one command

We provide a script at `scripts/dev` which:
1) checks if Supabase is already running, and starts local services only if not
2) starts the SvelteKit dev server

Example behavior:
- UI available at `http://localhost:<ui-port>`
- Supabase local gateway/services on ports printed by `supabase start`

### Start
```bash
./scripts/dev
```

### Stop
- Ctrl+C stops the web server.
- Supabase can be stopped via:
```bash
supabase stop
```

## Local Edge Functions

- Edge Functions run locally as part of the Supabase local stack.
- UI should call functions via the Supabase origin using the URL shape:
  `http(s)://<supabase-origin>/functions/v1/<function-name>`

## Environment variables

We keep a `.env.example` at repo root and/or per app.

Principles:
- UI needs only:
  - `PUBLIC_SUPABASE_URL`
  - `PUBLIC_SUPABASE_ANON_KEY`
- OpenRouter key must never be in UI env.
  - It is configured as an Edge Function secret in Supabase.

## Database migrations and seeds

- All schema changes go into `supabase/migrations/`.
- Seeds live under `supabase/seed/` (if used).
- For testing, we avoid deterministic resets (like `scripts/db-reset`) to allow parallel agents to use the same database. Instead, tests use logically isolated setup and teardown.

## Developer workflows

### Typical dev loop
1) `./scripts/dev`
2) Edit UI and/or Edge Function code
3) Use UI in browser and rely on local Supabase

### When changing schema
1) Create migration in `supabase/migrations/`
2) Apply locally via the reset script or migration tooling
3) Add/update tests that validate RLS and data invariants
