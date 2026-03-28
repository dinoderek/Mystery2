# Quickstart Guide

## Prerequisites

- [Node.js](https://nodejs.org/) 18+, [npm](https://www.npmjs.com/)
- [Docker](https://www.docker.com/) (local Supabase)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Deno](https://deno.land/) (Edge Function tooling)

## First-Time Setup

**Optional shared config root** — to share local-only files across clones or
worktrees, export an absolute path before any other command:

```bash
export MYSTERY_CONFIG_ROOT="/absolute/path/to/mystery-config"
```

When set, gitignored files (`.env.*.local`, seed files, generated outputs)
resolve from that directory instead of the repo root. Layout mirrors repo-local
filenames:

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

**Bootstrap everything:**

```bash
npm run seed:all
```

This starts local Supabase (if needed), seeds auth users, AI profiles, blueprint
storage, and images. Missing images produce warnings, not errors.

## Local Development

### Mock AI (default)

```bash
npm run dev
```

Starts Supabase, seeds storage and mock AI profile, runs SvelteKit at
`http://localhost:5173`.

### Live AI

Create one or both gitignored env files for live provider calls:

`.env.ai.free.local` / `.env.ai.paid.local`:

```bash
AI_PROVIDER="openrouter"
AI_MODEL="<model-id>"
OPENROUTER_API_KEY="<key>"
```

Then:

```bash
npm run dev:ai:free   # or dev:ai:paid
```

### Switch profile without restarting

```bash
npm run seed:ai -- --only <mock|free|paid>
```

New sessions use the updated `default` profile. Existing sessions keep their
stored `ai_profile_id`. See [`docs/ai-configuration.md`](docs/ai-configuration.md).

## Seeded Local Users

| Email                | Purpose                          |
| -------------------- | -------------------------------- |
| `player1@test.local` | Primary local player             |
| `player2@test.local` | Second player / RLS checks       |

Passwords are generated into `supabase/seed/auth-users.local.json` (or
`$MYSTERY_CONFIG_ROOT/supabase/seed/auth-users.local.json`) on the first
`seed:auth` run and reused thereafter.

## Blueprint Generation

Create a brief JSON:

```json
{
  "brief": "A child-friendly mystery in a school library.",
  "targetAge": 8,
  "timeBudget": 14,
  "mustInclude": ["at least three suspects", "one red herring motive"]
}
```

### Generate blueprints (calls OpenRouter)

```bash
npm run generate:blueprint -- \
  --brief-file path/to/story-brief.json \
  --model openai/gpt-4.1-mini
```

Key flags:

| Flag | Purpose |
|------|---------|
| `--openrouter-api-key <key>` | Explicit key (falls back to `OPENROUTER_API_KEY` env) |
| `--output <path>` | Write single job to exact file (stdout otherwise) |
| `--output-file <prefix>` | Write composed filenames `<prefix>.<model>.<brief>.json` |
| `--verification-model <id>` | Verifier model (default: `google/gemini-3-flash-preview`) |
| `--parallel` / `--parallelism <n>` | Concurrent jobs |

Repeat `--brief-file` and/or `--model` for multi-job runs (requires
`--output-file`). Set `OPENROUTER_BLUEPRINT_MODEL` in `.env.local` to avoid
repeating `--model`.

Both blueprint and sibling `.verification.json` files are written on
completion. Schema or verification failures are reported in the summary without
failing the process.

### Export chat packets (no API key needed)

```bash
npm run generate:blueprint -- \
  --brief-file path/to/story-brief.json \
  --chat-packet
```

Builds the full generation prompt as a Markdown file you can paste into any
chat UI. No `--model` or API key required. Output defaults to
`$MYSTERY_CONFIG_ROOT/chat-gen-prompts/` (or `chat-gen-prompts/` under repo
root). Override with `--output` or `--output-file`.

## Image Generation

Env file: copy `.env.images.example` to `.env.images.local`.

Supported keys: `OPENROUTER_API_KEY`, optional `OPENROUTER_IMAGE_MODEL`
(default: `openai/gpt-image-1`).

### Generate images (calls OpenRouter)

```bash
npm run generate:images -- \
  --blueprint-path spring-treats-6yo.json \
  --model openai/gpt-image-1 \
  --all
```

Key flags:

| Flag | Purpose |
|------|---------|
| `--all` | All targets |
| `--blueprint` | Blueprint-level image only |
| `--characters "A,B"` / `--character "A"` | Character subset |
| `--locations "X,Y"` / `--location "X"` | Location subset |
| `--output-dir <dir>` | Override output directory |
| `--dry-mode` | Print prompts without calling API |

`--blueprint-path` resolves from `$MYSTERY_CONFIG_ROOT/blueprints/` first, then
falls back to the literal path. `--output-dir` defaults to
`$MYSTERY_CONFIG_ROOT/blueprint-images/` (or `blueprint-images/`).

### Export image chat packets (no API key needed)

```bash
npm run generate:images -- \
  --blueprint-path spring-treats-6yo.json \
  --all \
  --chat-packets
```

Writes Markdown prompt files instead of calling OpenRouter. Output defaults to
`$MYSTERY_CONFIG_ROOT/chat-gen-prompts/images/`. Cannot combine with
`--dry-mode` or `--dry-run`.

## Supabase Operations

For full details see [`docs/local-infrastructure.md`](docs/local-infrastructure.md).

### Worktrees: use `npm run` scripts

In a git worktree, always use `npm run supabase:*` scripts instead of raw
`npx supabase` commands. The scripts patch `supabase/config.toml` with the
worktree's project_id and ports. If you must run a raw command, patch first:

```bash
npm run supabase:patch
```

### When to restart vs reseed

| Scenario | Command |
|----------|---------|
| Changed Edge Functions or `_shared/` code | `npm run supabase:restart` |
| Containers unhealthy/stuck | `npm run supabase:restart` |
| New worktree needs full state | `npm run seed:all` |
| Database reset | `npm run supabase:reset` then `npm run seed:all` |
| Switch AI profile or edited `.env.ai.*.local` | `npm run seed:ai -- --only <mock\|free\|paid>` |

### Other commands

```bash
npx supabase status          # check status
npm run supabase:gc           # clean up stale worktree stacks
npm run supabase:reset        # reset DB (re-applies migrations)
npm run seed:storage          # reseed blueprint storage only
npm run seed:auth             # reseed auth users only
npm run seed:ai               # reseed all AI profiles
npm run logs:edge             # tail Edge Function logs
```

### Stop the local stack

```bash
npx supabase stop             # main checkout
# In a worktree: npm run supabase:patch && npx supabase stop
```

### Test scripts and stale Edge Functions

Test scripts (`test:integration`, `test:e2e`) call `ensureSupabaseRunning()`
and reseed mock AI, but do **not** restart stale Edge Function code. After
changing `supabase/functions/`, run `npm run supabase:restart` before tests.

## Deploy To Dev

Create `.env.deploy.dev.local` (at repo root or `$MYSTERY_CONFIG_ROOT/`) with:

- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`
- `AI_DEFAULT_PROFILE_ID=default`, `AI_DEFAULT_PROFILE_PROVIDER`, `AI_DEFAULT_PROFILE_MODEL`
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `AI_DEFAULT_PROFILE_OPENROUTER_API_KEY` (when provider is `openrouter`)

Optional bootstrap users: copy `deploy/bootstrap-users.dev.example.json` to
`deploy/bootstrap-users.dev.local.json` and replace sample passwords.

```bash
npm run deploy -- --env dev --preflight
```

Add `--image-dir <path>` to upload generated blueprint images during deploy.

## Testing

Full quality gate:

```bash
npm test
```

Individual tiers:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm -w web run test:e2e
```

See [`docs/testing.md`](docs/testing.md) for suite ownership and guidance.
