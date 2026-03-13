# Quickstart Guide

## Prerequisites

Install:

- [Node.js](https://nodejs.org/) 18+
- [npm](https://www.npmjs.com/)
- [Docker](https://www.docker.com/) for local Supabase
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Deno](https://deno.land/) for Edge Function tooling

## First-Time Setup

Run from the repo root:

```bash
npm run setup:local
```

This command:

1. Ensures the local Supabase stack is running.
2. Seeds blueprint storage if the bucket is empty.
3. Seeds the local auth users.
4. Seeds AI profiles in Postgres (`mock`, optional `free` / `paid`, and canonical `default`).

## Run Locally With a Profile

### Deterministic local development

```bash
npm run dev
```

Use this for normal development and tests. It:

- ensures Supabase is running
- seeds blueprint storage if missing
- reseeds AI so `ai_profiles.id='default'` points to `mock`
- starts the SvelteKit dev server at `http://localhost:5173`

### Live AI using a named profile

Create one or both gitignored env files if you want live provider calls.

`.env.ai.free.local`

```bash
AI_PROVIDER="openrouter"
AI_MODEL="z-ai/glm-4.5-air:free"
OPENROUTER_API_KEY="<server-only-secret>"
```

`.env.ai.paid.local`

```bash
AI_PROVIDER="openrouter"
AI_MODEL="google/gemini-3-flash-preview"
OPENROUTER_API_KEY="<server-only-secret>"
```

Then run one of:

```bash
npm run dev:ai:free
npm run dev:ai:paid
```

Those commands use the selected profile to reseed `ai_profiles.id='default'` before starting the web app.

### Switching profiles without restarting Supabase

Changing AI profile data is a database operation, not a container restart operation.

After editing `.env.ai.<mode>.local`, apply it with:

```bash
npm run seed:ai -- --only <mock|free|paid>
```

New sessions use the current `default` profile. Existing sessions stay pinned to their stored `ai_profile_id`.

For the canonical rules behind that behavior, see [`docs/ai-configuration.md`](/Users/dinohughes/Projects/my2/w2/docs/ai-configuration.md).

## Seeded Local Users

`npm run setup:local` and `npm run seed:auth` ensure these users exist in local Supabase Auth:

| Email                | Password      | Purpose                          |
| -------------------- | ------------- | -------------------------------- |
| `player1@test.local` | `password123` | Primary local player             |
| `player2@test.local` | `password123` | Second local player / RLS checks |

Log in at `http://localhost:5173/login` or the redirected login screen.

## Supabase Operations

### Check status

```bash
npx supabase status
```

### Restart the local stack

```bash
npm run supabase:restart
```

Use a restart when:

- the local Supabase containers are unhealthy or stuck
- you changed Supabase config that is only picked up on container restart
- you changed Edge Function or other Deno-backed code and need to guarantee the shared local runtime picks it up

This repo is configured with `edge_runtime.policy = "per_worker"`, but because multiple agents can share the same local Supabase project on one machine, do not rely on hot reload. In practice, treat `npm run supabase:restart` as the safe path for Deno and Edge Function changes.

### Reset the local database

```bash
npx supabase db reset --local --yes
```

Use this when you need a clean local database with all migrations reapplied.

After a reset, restore local app data with:

```bash
npm run seed:storage -- --if-missing
npm run seed:auth
npm run seed:ai
```

If you want the full bootstrap again instead of running those individually:

```bash
npm run setup:local
```

### Reseed specific parts

Blueprint storage:

```bash
npm run seed:storage
npm run seed:storage -- --if-missing
```

Auth users:

```bash
npm run seed:auth
```

AI profiles:

```bash
npm run seed:ai
npm run seed:ai -- --only <mock|free|paid>
```

### Stop the local stack

```bash
npx supabase stop
```

## Logs

Tail local Edge Function logs with:

```bash
npm run logs:edge
```

## Testing

Run the full quality gate before finishing code changes:

```bash
npm run test:all
```

Or run tiers individually:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm -w web run test:e2e
```
