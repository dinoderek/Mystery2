# Deployment Guide

## Scope

Production-like deploys are local/manual and run from one orchestrator script:

- `npm run deploy -- --env dev`
- `npm run deploy -- --env staging`
- `npm run deploy -- --env prod`

Optional flags:

- `--preflight`: runs `lint`, `typecheck`, `test:unit` before deploy
- `--dry-run`: validates config and prints command plan without executing
- `--skip-users`: skips non-prod auth user bootstrap and bootstrap-user smoke assertion
- `--skip-seed`: skips storage blueprint seeding step

## Environment Contracts

### 1) Non-secret target manifest (committed)

`deploy/targets.json` must define `dev`, `staging`, and `prod` with:

- `pagesProjectName`
- `pagesBranch`
- `supabaseProjectRef`
- `expectedFrontendUrl`
- `expectedSupabaseUrl`

### 2) Secret env file (uncommitted)

Create one file per environment:

- `.env.deploy.dev.local`
- `.env.deploy.staging.local`
- `.env.deploy.prod.local`

Required keys:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_DEFAULT_PROFILE_ID` (must be `default`)
- `AI_DEFAULT_PROFILE_PROVIDER` (`mock` or `openrouter`)
- `AI_DEFAULT_PROFILE_MODEL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Conditionally required:

- `AI_DEFAULT_PROFILE_OPENROUTER_API_KEY` when `AI_DEFAULT_PROFILE_PROVIDER=openrouter`

Optional (avoids interactive DB password prompt during `supabase link`):

- `SUPABASE_DB_PASSWORD`

### 3) Optional non-prod user bootstrap config (example committed, real file local-only)

- `deploy/bootstrap-users.dev.example.json`
- `deploy/bootstrap-users.staging.example.json`
- `deploy/bootstrap-users.dev.local.json`
- `deploy/bootstrap-users.staging.local.json`

The `.example.json` files are committed templates only. The real `.local.json` files are gitignored and must contain `users[]` entries with `email`, `password`, and optional `email_confirm`.

Create each local file by copying the matching example file and replacing all sample passwords before deploy.

## Deploy Flow

The orchestrator (`scripts/deploy.mjs`) executes in this order:

1. Validate args, target manifest, secret env file, and required variables.
2. Validate Cloudflare Pages project and Supabase project ref exist.
3. Optional preflight checks (`--preflight`).
4. Build static frontend (`npm -w web run build`).
5. Deploy web artifact to Pages (`wrangler pages deploy web/build ...`).
6. Link Supabase project and push migrations.
7. Upsert canonical `ai_profiles.id='default'` from deploy env (`provider`, `model`, `openrouter_api_key`).
8. Deploy all edge functions under `supabase/functions/*` excluding `_shared`.
9. Seed Storage blueprints (unless `--skip-seed`).
10. Bootstrap non-prod auth users from config (unless `--skip-users`).
11. Run smoke checks.

## Rollback

- **Frontend rollback**: redeploy a previous known-good web artifact/commit.
- **Edge function rollback**: redeploy previous function code.
- **Database rollback**: apply a forward-fix migration.
- **AI runtime rollback**: re-run deploy with previous `AI_DEFAULT_PROFILE_*` values.

## Troubleshooting

- `Missing required deploy environment variables`: confirm `.env.deploy.<env>.local` keys are present.
- `AI_DEFAULT_PROFILE_ID must be exactly "default"`: set `AI_DEFAULT_PROFILE_ID=default`.
- `AI_DEFAULT_PROFILE_OPENROUTER_API_KEY is required`: provide a key when provider is `openrouter`.
- `Target mismatch ... VITE_SUPABASE_URL`: ensure deploy env and `deploy/targets.json` point to the same project URL.
- `Missing bootstrap user config`: copy `deploy/bootstrap-users.<env>.example.json` to `deploy/bootstrap-users.<env>.local.json` and replace the sample passwords.
