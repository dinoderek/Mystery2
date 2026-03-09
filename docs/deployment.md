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
- `OPENROUTER_API_KEY`
- `AI_PROVIDER`
- `AI_MODEL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Optional (avoids interactive DB password prompt during `supabase link`):

- `SUPABASE_DB_PASSWORD`

### 3) Optional non-prod user bootstrap config (committed)

- `deploy/bootstrap-users.dev.json`
- `deploy/bootstrap-users.staging.json`

Each file contains `users[]` entries with `email`, `password`, and optional `email_confirm`.
`email_confirm: true` marks the user as already email-verified at creation time (useful for pre-provisioned non-prod test accounts).

`prod` does not bootstrap default users unless explicitly changed.

## Deploy Flow

The orchestrator (`scripts/deploy.mjs`) executes in this order:

1. Validate args, target manifest, secret env file, required variables.
2. Validate Cloudflare Pages project and Supabase project ref exist.
3. Optional preflight checks (`--preflight`).
4. Build static frontend (`npm -w web run build`).
5. Deploy web artifact to Pages (`wrangler pages deploy web/build ...`).
6. Link Supabase project and push migrations.
7. Set Supabase function secrets (`AI_PROVIDER`, `AI_MODEL`, `OPENROUTER_API_KEY`).
8. Deploy all edge functions under `supabase/functions/*` excluding `_shared`.
9. Seed Storage blueprints (unless `--skip-seed`).
10. Bootstrap non-prod auth users from config (unless `--skip-users`).
11. Run smoke checks:
- frontend URL reachable
- blueprints bucket has seeded JSON files
- authenticated `blueprints-list` returns data
- expected non-prod bootstrap users exist (unless skipped)

## Rollback

- **Frontend rollback**: redeploy a previous known-good web artifact/commit to the same Pages project/branch.
- **Edge function rollback**: redeploy previous function code for impacted endpoints.
- **Database rollback**: apply a forward-fix migration; avoid manual schema edits on hosted DB.
- **Seed/user provisioning rollback**: remove accidental auth users with admin API and re-seed blueprints as needed.

## Troubleshooting

- `Missing required deploy environment variables`: confirm `.env.deploy.<env>.local` exists and contains all required keys.
- `Cloudflare Pages project ... not found`: verify token/account scope and `pagesProjectName` in `deploy/targets.json`.
- `Supabase project ref ... not found`: verify `SUPABASE_ACCESS_TOKEN` and `supabaseProjectRef` mapping.
- `supabase link` prompts for DB password: add `SUPABASE_DB_PASSWORD` to the env file.
- `blueprints-list` smoke check 401/403: confirm `VITE_SUPABASE_ANON_KEY` and auth-enabled function deployment.
- empty blueprint smoke check: ensure storage seeding succeeded and bucket policies permit reads.
