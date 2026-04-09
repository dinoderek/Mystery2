# Deployment Guide

## Scope

Production-like deploys are local/manual and run from one orchestrator script:

- `npm run deploy -- --env dev`
- `npm run deploy -- --env staging`
- `npm run deploy -- --env prod`

Optional flags:

- `--preflight`: runs `lint`, `typecheck`, `test:unit` before deploy
- `--dry-run`: validates config and prints command plan without executing
- `--serial`: disables deploy parallelism and forces Supabase function deploy jobs to `1`
- `--function-jobs <n>`: overrides Supabase Edge Function deploy concurrency (default `4`, clamped to the number of discovered functions)
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

When `MYSTERY_CONFIG_ROOT` is set to an absolute path, these local-only files are read from that directory instead of the repo root:

- `$MYSTERY_CONFIG_ROOT/.env.deploy.dev.local`
- `$MYSTERY_CONFIG_ROOT/.env.deploy.staging.local`
- `$MYSTERY_CONFIG_ROOT/.env.deploy.prod.local`

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

When `MYSTERY_CONFIG_ROOT` is set, these local-only bootstrap manifests are read from:

- `$MYSTERY_CONFIG_ROOT/deploy/bootstrap-users.dev.local.json`
- `$MYSTERY_CONFIG_ROOT/deploy/bootstrap-users.staging.local.json`

The `.example.json` files are committed templates only. The real `.local.json` files are gitignored and must contain `users[]` entries with `email`, `password`, and optional `email_confirm`.

Create each local file by copying the matching example file and replacing all sample passwords before deploy.

The deploy bootstrap step only creates missing users. If a bootstrap user already exists, deploy leaves the existing account unchanged and does not reset its password.

## Updating Bootstrap User Passwords

To rotate passwords for the existing non-prod bootstrap users:

1. Edit `deploy/bootstrap-users.<env>.local.json` with the new passwords.
2. Run `npm run users:update-passwords -- --env <dev|staging>`.

Optional flag:

- `--dry-run`: validates config, confirms the target users exist, and prints which emails would be updated without changing passwords

Behavior:

- The script reads `.env.deploy.<env>.local` for `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- It matches users by email from `deploy/bootstrap-users.<env>.local.json`.
- When `MYSTERY_CONFIG_ROOT` is set, both of those local-only files are resolved from that directory instead of the repo root.
- It updates passwords in place and preserves user ids.
- It fails before making changes if any configured email does not already exist in Supabase Auth.

## Deploy Flow

The orchestrator (`scripts/deploy.mjs`) executes in staged order:

1. Validate args, target manifest, secret env file, and required variables.
2. Validate Cloudflare Pages project and Supabase project ref exist.
3. Optional preflight checks (`--preflight`).
4. Build static frontend (`npm -w web run build`).
5. Run two deploy lanes in parallel by default:
   - Pages lane: deploy web artifact to Pages (`wrangler pages deploy web/build ...`)
   - Supabase lane:
     - link project
     - push migrations
     - upsert canonical `ai_profiles.id='default'`
     - deploy all edge functions in one CLI call with `--use-api --jobs <resolved-count>`
     - seed Storage blueprints (unless `--skip-seed`)
     - bootstrap non-prod auth users (unless `--skip-users`)
6. Run smoke checks only after both lanes succeed.

`--dry-run` now prints grouped serial/parallel phases. Child-process output in live deploys is prefixed with `[pages]` or `[supabase]` while the lanes are running concurrently.

## GitHub Actions CI/CD

The workflow at `.github/workflows/ci-cd.yml` runs on every push and PR to
`main`. It has two jobs:

1. **Quality gates** — `npm ci`, `npm run lint`, `npm run typecheck`,
   `npm -w web run check`, `npm run test:unit`. Runs on pushes and PRs.
2. **Deploy (dev)** — runs only on pushes to `main`, after quality gates pass.
   It reconstructs the local deploy config from secrets, then runs
   `npm run deploy:dev`.

### One-time GitHub setup

1. In the repo on GitHub, go to **Settings → Environments** and create an
   environment named `dev`. Optionally add required reviewers here for
   manual approval before the deploy job runs.
2. Go to **Settings → Secrets and variables → Actions → New repository secret**
   (or scope them to the `dev` environment) and add the secrets below.

### Required secrets

Both secrets are **file-shaped**: copy the entire contents of the local file
and paste them as the secret value. Do not try to set one variable per secret —
the workflow writes each secret back to a single file on disk before running
the deploy script, so the format must match what `scripts/deploy.mjs` already
reads locally.

- **`DEPLOY_ENV_DEV`** — full contents of your working
  `.env.deploy.dev.local`. Must include every key in `REQUIRED_DEPLOY_ENV_VARS`
  (see `scripts/deploy-helpers.mjs`): `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_SERVICE_ROLE_KEY`, `AI_DEFAULT_PROFILE_ID`,
  `AI_DEFAULT_PROFILE_PROVIDER`, `AI_DEFAULT_PROFILE_MODEL`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, plus any optional keys your
  dev target needs (e.g. `SUPABASE_DB_PASSWORD`,
  `AI_DEFAULT_PROFILE_OPENROUTER_API_KEY`).
- **`BOOTSTRAP_USERS_DEV`** — full contents of
  `deploy/bootstrap-users.dev.local.json`. Required because `dev` deploys
  bootstrap auth users (see `shouldBootstrapUsers` in
  `scripts/deploy-helpers.mjs`). Start from
  `deploy/bootstrap-users.dev.example.json` and replace the sample passwords
  before pasting.

Fastest way to capture these values on macOS:

```sh
pbcopy < .env.deploy.dev.local
# paste into the DEPLOY_ENV_DEV secret

pbcopy < deploy/bootstrap-users.dev.local.json
# paste into the BOOTSTRAP_USERS_DEV secret
```

The workflow recreates these files at the exact paths the deploy script
expects, so no further configuration is required. To rotate credentials,
update the secret value and re-run the workflow.

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
- `--jobs must be used together with --use-api`: the deploy script now emits both flags automatically; if you run the Supabase CLI manually, include `--use-api` whenever you pass `--jobs`.
