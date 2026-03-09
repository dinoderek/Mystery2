# Quickstart Guide

## Prerequisites
Install:
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [npm](https://www.npmjs.com/)
- [Docker](https://www.docker.com/) (required for local Supabase)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Deno](https://deno.land/) (for Edge Functions language tooling)

## First-Time Local Setup (Human)
Run one command from repo root:

```bash
npm run setup:local
```

This does the initial bootstrap:
1. Ensures local Supabase is running.
2. Seeds blueprint storage (only if bucket is empty).
3. Seeds auth test users.
4. Seeds AI profiles in Postgres:
   - always seeds `mock`,
   - seeds `free` / `paid` only when `.env.ai.free.local` / `.env.ai.paid.local` exist.

Then start the app:

```bash
npm run dev
```

## Daily Development Workflows

### Deterministic local development (mock AI)
```bash
npm run dev
```
- Uses `VITE_AI_PROFILE=mock` in the web app.
- Does not restart Supabase if already running.
- Seeds storage if missing and refreshes the `mock` AI profile.

### Local development against real AI profiles
Configure mode files (gitignored):

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

Run:
- Free: `npm run dev:ai:free`
- Paid: `npm run dev:ai:paid`

These commands:
- keep Supabase running by default (no restart),
- sync the selected profile row in `ai_profiles`,
- start the web app with `VITE_AI_PROFILE` set to that mode.

### Switching AI profile without restart
You do not need to restart Supabase to switch modes.
- Start with `npm run dev` (`mock`) or `npm run dev:ai:free|paid`.
- `game-start` stores the selected profile on the new session.
- Existing sessions keep their stored `ai_profile_id`; new sessions use current selection.

## Updating Keys/Models (No Restart Required)
When a model id or key changes:
1. Edit `.env.ai.<mode>.local` (`free` or `paid`).
2. Sync that profile to Postgres:
   ```bash
   npm run seed:ai -- --only <mode>
   ```
   Example:
   ```bash
   npm run seed:ai -- --only free
   ```
3. Continue testing. Supabase restart is not required.

Notes:
- OpenRouter key resolves from `ai_profiles.openrouter_api_key` first.
- If profile key is null, runtime falls back to `OPENROUTER_API_KEY` env.

## Optional Reseed / Restart Controls

Manual storage reseed:
```bash
npm run seed:storage
```

Seed storage only when empty:
```bash
npm run seed:storage -- --if-missing
```

Force Supabase restart (manual only):
```bash
npm run supabase:restart
```

## Testing
Run all quality gates:
```bash
npm run test:all
```

Run suites individually:
- Unit: `npm run test:unit`
- Integration: `npm run test:integration`
- API E2E: `npm run test:e2e`

By default, integration/E2E scripts:
- ensure Supabase is running (no restart),
- seed storage if missing,
- seed required AI profiles.

You can opt into restart/reseed flags when needed:
```bash
npm run test:integration -- --restart --seed-storage=always
```

## Optional Live-AI Suites
Live suites are opt-in:
- `npm run test:integration:live:free`
- `npm run test:integration:live:paid`
- `npm run test:e2e:live:free`
- `npm run test:e2e:live:paid`

They use profile-based selection (`free`/`paid`) and larger timeout budgets.

## Accessing Edge Function Logs
```bash
npm run logs:edge
```

Optional tail length:
```bash
npm run logs:edge -- --tail 500
```

## Cloud Supabase Secrets
For hosted Supabase environments, set runtime env secrets per project:

```bash
supabase secrets set OPENROUTER_API_KEY=<secret> --project-ref <project-ref>
```

Model/provider selection can still be driven by DB `ai_profiles` rows in that environment.

## Viewing Local Database/Services
```bash
npx supabase status
```
