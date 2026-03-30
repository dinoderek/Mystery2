# AI Configuration

This project uses a DB-first AI configuration model.

For day-to-day local setup and profile selection commands, see `../QUICKSTART.md`.
For the implementation-level matrix of which blueprint fields feed image and
runtime narration generation, see `docs/blueprint-generation-flows.md`.

## Canonical Rules

- Canonical default profile id is `default`.
- `game-start` uses `default` unless request body includes `ai_profile`.
- Existing sessions stay pinned to their stored `ai_profile_id`.
- OpenRouter keys are stored in `ai_profiles.openrouter_api_key` (no function-secret fallback).
- Local-only operator config can be relocated by setting `MYSTERY_CONFIG_ROOT` to an absolute path. When unset, local-only files continue to resolve from the repo root.

This document is the canonical source for:

- `default` vs named local profiles (`mock`, `free`, `paid`)
- when `npm run seed:ai` is sufficient
- which local and test workflows rely on the seeded mock profile

## OpenRouter Injection Map

- Local live gameplay:
  - `.env.ai.free.local` / `.env.ai.paid.local` provide `OPENROUTER_API_KEY`
  - when `MYSTERY_CONFIG_ROOT` is set, those files resolve from that directory instead of the repo root
  - `scripts/seed-ai.mjs` writes that value into `ai_profiles.openrouter_api_key`
- Deploy:
  - `.env.deploy.<env>.local` provides `AI_DEFAULT_PROFILE_OPENROUTER_API_KEY`
  - when `MYSTERY_CONFIG_ROOT` is set, deploy reads those local-only env files from that directory
  - deploy upserts `ai_profiles.id='default'`
- Runtime use:
  - edge functions load the key from `ai_profiles.openrouter_api_key`
  - runtime provider construction uses that DB value only
- Blueprint generation:
  - `scripts/generate-blueprint.mjs` is operator tooling, not gameplay runtime
  - it loads `OPENROUTER_API_KEY` from shell env, then `.env.local`
  - when `MYSTERY_CONFIG_ROOT` is set, `.env.local` resolves from that directory
  - it loads model defaults from `OPENROUTER_BLUEPRINT_MODEL`, then `AI_MODEL`, then CLI `--model` overrides
- repeated `--brief-file` and `--model` flags generate every brief/model combination
- multi-job runs write composed files via `--output-file` as `<output-file>.<model>.<brief filename>.json`
- whenever a blueprint file is written, the CLI also runs post-generation verification and writes `<blueprint-file>.verification.json` beside it
- `--chat-packet` switches the CLI into copy/paste packet mode:
  - no OpenRouter request is made
  - no verification request is made
  - output defaults to `{MYSTERY_CONFIG_ROOT}/chat-gen-prompts/blueprint-packet.*.chat.md`
  - packet content is built from the same generator prompt, user-message JSON, and response-schema builder used by the live API path
  - `--model` is ignored completely in chat mode so packets stay model-agnostic
- verification defaults to `google/gemini-3-flash-preview` unless `--verification-model <model-id>` is provided
- if the model returns JSON that fails Blueprint V2 schema validation, the CLI still persists that raw JSON to the target blueprint file and records the failure in the sibling verification artifact
- `--parallel` runs all queued jobs concurrently; `--parallelism <n>` caps concurrent jobs
- it uses `AI_OPENROUTER_TIMEOUT_MS` for request timeout control (default `120000`)
- Image generation:
  - `scripts/generate-blueprint-images.mjs` is operator tooling, not gameplay runtime
  - it loads `OPENROUTER_API_KEY` from shell env, `.env.images.local`, then `.env.local`
  - when `MYSTERY_CONFIG_ROOT` is set, those local-only files resolve from that directory
  - it uses `AI_OPENROUTER_TIMEOUT_MS` for request/download timeout control (default `120000`)
- `--chat-packets` writes one markdown packet per selected target into `{MYSTERY_CONFIG_ROOT}/chat-gen-prompts/images` by default
- `--chat-packets-combined` writes all targets into a single combined markdown file (useful for working through all images in one ChatGPT/Gemini session)
- chat-packet mode never calls OpenRouter and never patches blueprint image IDs
- packets include a "Copy-Paste Prompt" section (unfenced) for easy selection in web UIs, plus "Save Instructions" with the expected filename and follow-up `--import-images` command
- `--model` is ignored completely in chat mode so packets stay model-agnostic
- `--dry-run` and `--dry-mode` are invalid in chat-packet mode because the packet itself is now the no-network export format
- `--import-images` scans a directory for `.png` files matching the expected naming convention, patches the blueprint with matched image IDs
- `--import-dir <dir>` overrides the directory to scan (default: `{MYSTERY_CONFIG_ROOT}/blueprint-images`)
- `--import-images` cannot be combined with `--chat-packets`, `--dry-run`, or `--dry-mode`

## Local Configuration Summary

- `npm run dev` points `default` to `mock`.
- `npm run dev:ai:free` / `npm run dev:ai:paid` point `default` to that mode.
- `npm run seed:ai -- --only <mock|free|paid>` updates the selected profile and `default` without restarting Supabase.
- gameplay/runtime OpenRouter config stays DB-first; local blueprint/image generation use direct operator env values instead of AI profile rows

## Testing And Mock Profile Rules

The default automated test path is mock-backed:

- `npm run test:integration` reseeds `ai_profiles.id='default'` to mock mode
- `npm run test:e2e` reseeds `ai_profiles.id='default'` to mock mode
- browser E2E normally runs against that same local mock-backed runtime

Use `npm run seed:ai -- --only <mock|free|paid>` when:

- switching between local runtime modes
- updating `.env.ai.<mode>.local`
- changing seeded profile rows or provider/model defaults

Use `npm run seed:all` instead when auth users, storage, and AI profiles all
need to be recreated together.

Because profile selection is stored in Postgres, `seed:ai` does not require a
Supabase restart by itself.

## Change Management For AI Runtime Work

When changing AI output contracts, prompt/context shape, provider selection, or
profile resolution:

- update the seeded profile behavior if local or test defaults changed
- update mock-provider coverage in `tests/api/unit/ai-provider.test.ts`
- update any affected integration or API E2E assertions that rely on mock
  narration or the seeded `default` profile
- rerun `npm run seed:ai` or `npm run seed:all` before local verification

Typical touchpoints include:

- `supabase/functions/_shared/ai-provider.ts`
- `supabase/functions/_shared/ai-profile.ts`
- `scripts/seed-ai.mjs`
- `tests/api/unit/ai-provider.test.ts`
- `tests/api/integration/ai-profile-runtime.test.ts`
- `tests/api/e2e/*` when journey assertions depend on seeded mock behavior

## Blueprint Generation Configuration

Use CLI flags or `.env.local` for operator blueprint-generation settings:

- `OPENROUTER_API_KEY=<secret>`
- `OPENROUTER_BLUEPRINT_MODEL=<model-id>` optional; comma-separated values are supported
- `AI_MODEL=<model-id>` fallback only when `OPENROUTER_BLUEPRINT_MODEL` is unset

The blueprint-generation CLI resolves config in this order:

1. CLI flags at invocation time
2. shell env at invocation time
3. `.env.local` from `MYSTERY_CONFIG_ROOT` when set, otherwise from the repo root

Operator flags:

- repeat `--brief-file <path>` to queue multiple story briefs
- repeat `--model <model-id>` to queue multiple models
- `--verification-model <model-id>` chooses the verification model; default is `google/gemini-3-flash-preview`
- `--output <path>` writes a single job to an exact file path
- `--output-file <path>` writes one file per queued job using the composed filename
- `--chat-packet` writes markdown packets instead of calling OpenRouter; if no output path is given it defaults under `chat-gen-prompts/`
- successful file-writing jobs also emit a sibling verification JSON file
- file-writing runs print a final stdout summary instead of blueprint JSON
- `--parallel` or `--parallelism <n>` enable concurrent generation

Timeout behavior:

- `AI_OPENROUTER_TIMEOUT_MS=<milliseconds>` optional
- default is `120000`

## Deploy Configuration

Deploy writes `ai_profiles.id='default'` from `.env.deploy.<env>.local`:

- `AI_DEFAULT_PROFILE_ID=default`
- `AI_DEFAULT_PROFILE_PROVIDER=<mock|openrouter>`
- `AI_DEFAULT_PROFILE_MODEL=<model-id>`
- `AI_DEFAULT_PROFILE_OPENROUTER_API_KEY=<secret>` when provider is `openrouter`

## Image Generation Configuration

Use `.env.images.local` for operator image-generation settings:

- `OPENROUTER_API_KEY=<secret>`
- `OPENROUTER_IMAGE_MODEL=<model-id>` optional

The image-generation CLI resolves config in this order:

1. shell env at invocation time
2. `.env.images.local` from `MYSTERY_CONFIG_ROOT` when set, otherwise from the repo root
3. `.env.local` from `MYSTERY_CONFIG_ROOT` when set, otherwise from the repo root
4. built-in default model

Operator flags:

- `--chat-packets` writes one markdown prompt packet per selected target instead of calling OpenRouter
- if `--output-dir` is omitted in chat mode, packets default to `chat-gen-prompts/images`
- packets are one-way operator artifacts: you upload any reference images manually and paste the prompt into chat yourself

Timeout behavior:

- `AI_OPENROUTER_TIMEOUT_MS=<milliseconds>` optional
- default is `120000`
