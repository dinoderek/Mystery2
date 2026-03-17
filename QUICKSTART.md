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
3. Creates `supabase/seed/auth-users.local.json` if missing, then seeds the local auth users.
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

For the canonical rules behind that behavior, see [`docs/ai-configuration.md`](/Users/dinohughes/Projects/my2/w1/docs/ai-configuration.md).

### Shared local env template

Copy `.env.local.example` to `.env.local` for local script/test defaults.

The root `.env.local` template now also carries the shared OpenRouter operator settings for:

- `npm run generate:images`
- `npm run generate:blueprints`
- `npm run judge:blueprint`

Relevant keys:

- `OPENROUTER_API_KEY`
- `OPENROUTER_IMAGE_MODEL`
- `OPENROUTER_BLUEPRINT_GENERATION_MODEL`
- `OPENROUTER_BLUEPRINT_VERIFIER_MODEL`

## Seeded Local Users

`npm run setup:local` and `npm run seed:auth` ensure these users exist in local Supabase Auth.

- Seed emails come from the committed template: `supabase/seed/auth-users.example.json`
- Real passwords are generated into the gitignored local file: `supabase/seed/auth-users.local.json`
- The first `seed:auth` run prints the generated credentials once and later runs continue using the same local file

Default local users:

| Email                | Purpose                          |
| -------------------- | -------------------------------- |
| `player1@test.local` | Primary local player             |
| `player2@test.local` | Second local player / RLS checks |

Find the current passwords in `supabase/seed/auth-users.local.json`, then log in at `http://localhost:5173/login` or the redirected login screen.

## Blueprint Authoring Tools

Blueprint V2 authoring is a local operator workflow. The generation, verification, and judge commands write draft artifacts under `blueprints/drafts/` and never promote files into top-level `blueprints/` automatically.

### Generate draft candidates

Generation requires `OPENROUTER_API_KEY`, which can come from shell env or `.env.local`.

1. Write a brief in Markdown, for example `blueprints/briefs/school-mystery/brief.md`.
2. Run the generator:

```bash
npm run generate:blueprints -- \
  --brief blueprints/briefs/school-mystery/brief.md \
  --count 3
```

Optional flags:

- `--count <n>`: number of candidates to request
- `--model <id>`: override the default model (`openai/gpt-4.1-mini` unless `OPENROUTER_BLUEPRINT_GENERATION_MODEL` or fallback `OPENROUTER_MODEL` is set)

Output layout:

- copied brief: `blueprints/drafts/<slug>/<run-id>/brief.md`
- valid candidates: `blueprints/drafts/<slug>/<run-id>/candidate-01.blueprint.json`
- invalid JSON/raw-only outputs: `blueprints/drafts/<slug>/<run-id>/candidate-01.raw-model-output.txt`

If no valid Blueprint V2 candidates are produced, the command exits non-zero.

### Verify a candidate deterministically

Run the verifier against a generated candidate or any local blueprint path:

```bash
npm run verify:blueprint -- \
  --blueprint-path blueprints/drafts/school-mystery/<run-id>/candidate-01.blueprint.json
```

This writes a deterministic report next to the blueprint:

- candidate drafts: `candidate-01.deterministic-report.json`
- canonical blueprints: `<name>.deterministic-report.json`

The verifier exits non-zero when blocking findings are present.

### Judge a candidate with AI

The AI judge also requires `OPENROUTER_API_KEY`, which can come from shell env or `.env.local`.

```bash
npm run judge:blueprint -- \
  --blueprint-path blueprints/drafts/school-mystery/<run-id>/candidate-01.blueprint.json
```

Optional flags:

- `--model <id>`: override the default model (`openai/gpt-4.1-mini` unless `OPENROUTER_BLUEPRINT_VERIFIER_MODEL` or fallback `OPENROUTER_MODEL` is set)

This writes an AI review artifact next to the blueprint:

- candidate drafts: `candidate-01.ai-judge-report.json`
- canonical blueprints: `<name>.ai-judge-report.json`

### Recommended review loop

1. Generate one or more candidates from a `brief.md`.
2. Open the generated `.blueprint.json` files in `blueprints/drafts/<slug>/<run-id>/`.
3. Run deterministic verification on the best candidate.
4. Run AI judging on the same candidate.
5. Manually decide whether to copy the candidate into top-level `blueprints/`.

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

## Deploy To Dev

Create `.env.deploy.dev.local` with:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_DEFAULT_PROFILE_ID=default`
- `AI_DEFAULT_PROFILE_PROVIDER`
- `AI_DEFAULT_PROFILE_MODEL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `AI_DEFAULT_PROFILE_OPENROUTER_API_KEY` when `AI_DEFAULT_PROFILE_PROVIDER=openrouter`

If you want non-prod bootstrap users during deploy, also copy:

- `deploy/bootstrap-users.dev.example.json` -> `deploy/bootstrap-users.dev.local.json`

Replace the sample passwords in the local file before running deploy.

Then run:

```bash
npm run deploy -- --env dev --preflight
```

If you also want to upload generated blueprint images during deploy, add `--image-dir generated/blueprint-images`.

## Image Generation

Shared env file:

- copy `.env.local.example` to `.env.local`
- optional: copy `.env.images.example` to `.env.images.local` only if you want image-specific overrides

Supported keys:

- `OPENROUTER_API_KEY`
- optional: `OPENROUTER_IMAGE_MODEL` (defaults to `openai/gpt-image-1`)
- optional: `OPENROUTER_BLUEPRINT_GENERATION_MODEL` (defaults to `openai/gpt-4.1-mini`)
- optional: `OPENROUTER_BLUEPRINT_VERIFIER_MODEL` (defaults to `openai/gpt-4.1-mini`)

`OPENROUTER_API_KEY` is not required when using `--dry-mode`.

Resolution order for `npm run generate:images`:

1. shell env at invocation time
2. `.env.images.local`
3. `.env.local`
4. built-in model default (`openai/gpt-image-1`) when no model is set anywhere

Resolution order for blueprint authoring commands (`generate:blueprints`, `judge:blueprint`):

1. shell env at invocation time
2. `.env.local`
3. command-specific model env (`OPENROUTER_BLUEPRINT_GENERATION_MODEL` or `OPENROUTER_BLUEPRINT_VERIFIER_MODEL`)
4. fallback model env (`OPENROUTER_MODEL`)
5. built-in default (`openai/gpt-4.1-mini`)

Gameplay/runtime OpenRouter config stays DB-first and profile-driven. The image-generation CLI is separate operator tooling and does not read from `ai_profiles`.

Keep live AI opt-in. `npm run dev` and `npm run setup:local` stay on the mock profile unless you explicitly create `.env.ai.<mode>.local` and switch to it.

Critical flags:

- `--blueprint-path <path>`: source blueprint JSON
- target selection: `--all`, `--blueprint`, `--characters "Alice,Bob"`, `--locations "Kitchen,Garden"`, or repeated `--character` / `--location` flags for a custom subset
- `--output-dir <dir>`: where generated images are written
- optional: `--model <id>` to override the default image model

Generate all blueprint images:

```bash
npm run generate:images -- \
  --blueprint-path blueprints/spring-treats-6yo.json \
  --output-dir generated/blueprint-images \
  --model openai/gpt-image-1 \
  --all
```

Generate selected targets only:

```bash
npm run generate:images -- \
  --blueprint-path blueprints/spring-treats-6yo.json \
  --output-dir generated/blueprint-images \
  --model openai/gpt-image-1 \
  --character "Alice" \
  --location "Kitchen"
```

Dry mode prints prompts and request payloads without calling OpenRouter or writing files:

```bash
npm run generate:images -- \
  --blueprint-path blueprints/spring-treats-6yo.json \
  --output-dir generated/blueprint-images \
  --all \
  --dry-mode
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
