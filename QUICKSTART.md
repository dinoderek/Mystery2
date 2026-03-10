# Quickstart Guide

## Prerequisites
Install:
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [npm](https://www.npmjs.com/)
- [Docker](https://www.docker.com/) (required for local Supabase)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Deno](https://deno.land/) (for Edge Functions language tooling)

## First-Time Local Setup
Run from repo root:

```bash
npm run setup:local
```

This:
1. Ensures local Supabase is running.
2. Seeds blueprint storage (if missing).
3. Seeds auth test users.
4. Seeds AI profiles in Postgres (`mock`, optional `free`/`paid`, and canonical `default`).

Then start the app:

```bash
npm run dev
```

## AI Mode Model (DB-First)

- Canonical default profile id is always `default`.
- `game-start` uses `ai_profiles.id='default'` when `ai_profile` is not provided.
- Existing sessions keep their stored `ai_profile_id`.
- New sessions use the current `default` row.

## Daily Local Workflows

### Deterministic local (mock)
```bash
npm run dev
```

This keeps Supabase running and refreshes `default` to mock config.

### Local live AI (free/paid)
Create mode files (gitignored):

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
- `npm run dev:ai:free`
- `npm run dev:ai:paid`

These commands upsert the selected mode profile and update `default` to that configuration.

## Switch AI Config Without Restart

No Supabase restart is needed.

- Update model/key in `.env.ai.<mode>.local`
- Apply it:

```bash
npm run seed:ai -- --only <mock|free|paid>
```

This updates both the named profile and canonical `default` row.

## Optional Controls

```bash
npm run seed:storage
npm run seed:storage -- --if-missing
npm run supabase:restart
```

## Testing

Run all quality gates:

```bash
npm run test:all
```

Or run tiers separately:
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`

## Deploy AI Default Profile

Deploy now configures AI mode by writing `ai_profiles.id='default'`.

In `.env.deploy.<env>.local`, set:
- `AI_DEFAULT_PROFILE_ID=default`
- `AI_DEFAULT_PROFILE_PROVIDER=<mock|openrouter>`
- `AI_DEFAULT_PROFILE_MODEL=<model-id>`
- `AI_DEFAULT_PROFILE_OPENROUTER_API_KEY=<secret>` (required only for openrouter)

Then run:

```bash
npm run deploy -- --env <dev|staging|prod>
```

## Logs

```bash
npm run logs:edge
```

## Local Service Status

```bash
npx supabase status
```
