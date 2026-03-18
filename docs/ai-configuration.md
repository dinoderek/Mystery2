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

## OpenRouter Injection Map

- Local live gameplay:
  - `.env.ai.free.local` / `.env.ai.paid.local` provide `OPENROUTER_API_KEY`
  - `scripts/seed-ai.mjs` writes that value into `ai_profiles.openrouter_api_key`
- Deploy:
  - `.env.deploy.<env>.local` provides `AI_DEFAULT_PROFILE_OPENROUTER_API_KEY`
  - deploy upserts `ai_profiles.id='default'`
- Runtime use:
  - edge functions load the key from `ai_profiles.openrouter_api_key`
  - runtime provider construction uses that DB value only
- Image generation:
  - `scripts/generate-blueprint-images.mjs` is operator tooling, not gameplay runtime
  - it loads `OPENROUTER_API_KEY` from shell env, `.env.images.local`, then `.env.local`

## Local Configuration Summary

- `npm run dev` points `default` to `mock`.
- `npm run dev:ai:free` / `npm run dev:ai:paid` point `default` to that mode.
- `npm run seed:ai -- --only <mock|free|paid>` updates the selected profile and `default` without restarting Supabase.
- gameplay/runtime OpenRouter config stays DB-first; image generation uses its own local env file instead of AI profile rows

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
2. `.env.images.local`
3. `.env.local`
4. built-in default model
