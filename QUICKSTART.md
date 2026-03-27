# Quickstart Guide

## Prerequisites

Install:

- [Node.js](https://nodejs.org/) 18+
- [npm](https://www.npmjs.com/)
- [Docker](https://www.docker.com/) for local Supabase
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Deno](https://deno.land/) for Edge Function tooling

## First-Time Setup

Optional: if you want one shared local-config directory across multiple clones or worktrees, export an absolute `MYSTERY_CONFIG_ROOT` first:

```bash
export MYSTERY_CONFIG_ROOT="/absolute/path/to/mystery-config"
```

When set, local-only files are read from that directory instead of this repo. When unset, the repo root keeps the current behavior.

Shared config layout mirrors the repo-local filenames:

```text
$MYSTERY_CONFIG_ROOT/
  .env.local
  .env.ai.free.local
  .env.ai.paid.local
  .env.images.local
  .env.deploy.dev.local
  .env.deploy.staging.local
  .env.deploy.prod.local
  deploy/bootstrap-users.dev.local.json
  deploy/bootstrap-users.staging.local.json
  supabase/seed/auth-users.local.json
```

Run from the repo root:

```bash
npm run seed:all
```

This command:

1. Ensures the local Supabase stack is running (starts it if needed).
2. Seeds auth users (creates `supabase/seed/auth-users.local.json` if missing).
3. Seeds AI profiles in Postgres (`mock`, optional `free` / `paid`, and canonical `default`).
4. Seeds blueprint storage and images (missing local images produce warnings, not errors).

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

For the canonical rules behind that behavior, see [`docs/ai-configuration.md`](/Users/dinohughes/Projects/my2/w3/docs/ai-configuration.md).

## Generate Blueprints Locally

Create a structured brief JSON file, for example:

```json
{
  "brief": "A child-friendly mystery in a school library where a special bookmark goes missing before story time.",
  "targetAge": 8,
  "timeBudget": 14,
  "mustInclude": ["at least three suspects", "one red herring motive"]
}
```

Then run:

```bash
npm run generate:blueprint -- \
  --brief-file path/to/story-brief.json \
  --model openai/gpt-4.1-mini
```

Optional:

- provide `--openrouter-api-key` explicitly, or rely on `OPENROUTER_API_KEY`
- provide `--output path/to/blueprint.json` to write a single job to an exact file instead of printing JSON to stdout
- provide `--output-file path/to/blueprint` to write composed output files as `path/to/blueprint.<model>.<brief filename>.json`
- repeat `--brief-file` and/or `--model` to generate every brief/model combination in one run; multi-job runs require `--output-file`
- optionally set `--verification-model <model>` to choose the verifier separately; default is `google/gemini-3-flash-preview`
- add `--parallel` to run all queued jobs concurrently, or `--parallelism <n>` to cap concurrency
- when a blueprint file is written, the CLI also writes a sibling verification file as `path/to/blueprint.<...>.verification.json`
- verification runs after the blueprint JSON is written; if verification fails, both files still remain on disk and the CLI reports the failure in the final summary without failing the process
- if generator-side schema validation fails after the model returns JSON, the CLI still writes that raw generated JSON to the blueprint file and writes the sibling verification/error file, then reports the failure in the final summary without failing the process
- when `--output` or `--output-file` is used, stdout prints only a final per-job summary with blueprint path and verification status
- set `OPENROUTER_BLUEPRINT_MODEL` in `.env.local` to avoid repeating `--model`; comma-separated values are supported for multi-model runs

## Seeded Local Users

`npm run seed:all` and `npm run seed:auth` ensure these users exist in local Supabase Auth.

- Seed emails come from the committed template: `supabase/seed/auth-users.example.json`
- Real passwords are generated into the gitignored local file: `supabase/seed/auth-users.local.json`
  - or `$MYSTERY_CONFIG_ROOT/supabase/seed/auth-users.local.json` when `MYSTERY_CONFIG_ROOT` is set
- The first `seed:auth` run prints the generated credentials once and later runs continue using the same local file

Default local users:

| Email                | Purpose                          |
| -------------------- | -------------------------------- |
| `player1@test.local` | Primary local player             |
| `player2@test.local` | Second local player / RLS checks |

Find the current passwords in `supabase/seed/auth-users.local.json`, or in `$MYSTERY_CONFIG_ROOT/supabase/seed/auth-users.local.json` when using a shared config root, then log in at `http://localhost:5173/login` or the redirected login screen.

## Supabase Operations

For in-depth details on local infrastructure, worktree isolation, and garbage
collection see [`docs/local-infrastructure.md`](docs/local-infrastructure.md).

### Important: use `npm run` scripts in worktrees

When working inside a git worktree, always prefer the `npm run supabase:*`
scripts over raw `npx supabase` commands. The npm scripts patch
`supabase/config.toml` with the worktree's project_id and ports before
invoking Supabase CLI, ensuring commands target the correct isolated stack.

Running `npx supabase ...` directly in a worktree may target the wrong
instance if the config has not been patched yet. If you must run a raw
command, patch first:

```bash
npm run supabase:patch
```

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

### Worktree isolation

When running inside a git worktree (e.g. Claude Code parallel tasks), each
worktree automatically gets its own Supabase stack with unique ports and
project_id. No manual configuration needed — `ensureSupabaseRunning()` handles
config patching and orphan cleanup transparently.

Clean up stale worktree stacks manually:

```bash
npm run supabase:gc
```

### Reset the local database

```bash
npm run supabase:reset
```

Use this when you need a clean local database with all migrations reapplied.
This script patches `supabase/config.toml` for worktree isolation before
running the reset, so it is safe to use in both the main checkout and
worktrees. Avoid calling `npx supabase db reset` directly in a worktree — the
config may not be patched yet.

After a reset, restore local app data with:

```bash
npm run seed:all
```

### Reseed everything at once

```bash
npm run seed:all
```

This ensures Supabase is running, then runs all seed steps (auth, AI profiles, blueprint storage with images) with upsert semantics.

Missing local images produce `[WARN]` lines but do not fail the command. Pass `--skip-seed-images` to skip image seeding entirely, or `--skip-seed-storage` to skip blueprint/image seeding. Pass `--restart` to force a Supabase restart before seeding.

### Reseed specific parts

Blueprint storage:

```bash
npm run seed:storage
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

- at the repo root by default, or
- at `$MYSTERY_CONFIG_ROOT/.env.deploy.dev.local` when using a shared config root

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
  - or `deploy/bootstrap-users.dev.example.json` -> `$MYSTERY_CONFIG_ROOT/deploy/bootstrap-users.dev.local.json` when using a shared config root

Replace the sample passwords in the local file before running deploy.

Then run:

```bash
npm run deploy -- --env dev --preflight
```

If you also want to upload generated blueprint images during deploy, add `--image-dir <path>` (defaults to `$MYSTERY_CONFIG_ROOT/blueprint-images/` when set, otherwise `blueprint-images/` under the repo root).

## Image Generation

Preferred env file:

- copy `.env.images.example` to `.env.images.local`

Supported keys:

- `OPENROUTER_API_KEY`
- optional: `OPENROUTER_IMAGE_MODEL` (defaults to `openai/gpt-image-1`)

`OPENROUTER_API_KEY` is not required when using `--dry-mode`.

Resolution order for `npm run generate:images`:

1. shell env at invocation time
2. `.env.images.local`
3. `.env.local`
4. built-in model default (`openai/gpt-image-1`) when no model is set anywhere

When `MYSTERY_CONFIG_ROOT` is set, those local-only files resolve from that directory instead of the repo root.

Gameplay/runtime OpenRouter config stays DB-first and profile-driven. The image-generation CLI is separate operator tooling and does not read from `ai_profiles`.

Keep live AI opt-in. `npm run dev` and `npm run seed:all` stay on the mock profile unless you explicitly create `.env.ai.<mode>.local` and switch to it.

Critical flags:

- `--blueprint-path <path>`: source blueprint JSON. Relative paths are resolved against `$MYSTERY_CONFIG_ROOT/blueprints/` first; if the file is not found there the path is used as-is (relative to cwd). Absolute paths are used directly.
- target selection: `--all`, `--blueprint`, `--characters "Alice,Bob"`, `--locations "Kitchen,Garden"`, or repeated `--character` / `--location` flags for a custom subset
- `--output-dir <dir>`: where generated images are written
- optional: `--model <id>` to override the default image model

Generate all blueprint images (resolved from `$MYSTERY_CONFIG_ROOT/blueprints/`):

```bash
npm run generate:images -- \
  --blueprint-path spring-treats-6yo.json \
  --model openai/gpt-image-1 \
  --all
```

Generate selected targets only:

```bash
npm run generate:images -- \
  --blueprint-path spring-treats-6yo.json \
  --model openai/gpt-image-1 \
  --character "Alice" \
  --location "Kitchen"
```

Dry mode prints prompts and request payloads without calling OpenRouter or writing files:

```bash
npm run generate:images -- \
  --blueprint-path spring-treats-6yo.json \
  --all \
  --dry-mode
```

`--output-dir` defaults to `$MYSTERY_CONFIG_ROOT/blueprint-images/` when set, otherwise `blueprint-images/` under the repo root. Pass `--output-dir <path>` to override.

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
npm test
```

Or run tiers individually:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm -w web run test:e2e
```
