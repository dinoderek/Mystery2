# AI Configuration

This project uses a DB-first AI configuration model.

## Canonical Rules

- Canonical default profile id is `default`.
- `game-start` uses `default` unless request body includes `ai_profile`.
- Existing sessions stay pinned to their stored `ai_profile_id`.
- OpenRouter keys are stored in `ai_profiles.openrouter_api_key` (no function-secret fallback).

## Local Configuration

- `npm run dev` sets `default` to mock via `seed:ai -- --only mock`.
- `npm run dev:ai:free` / `npm run dev:ai:paid` set `default` to that mode.
- `npm run seed:ai -- --only <mock|free|paid>` updates the selected profile and `default` without restart.

## Deploy Configuration

Deploy writes `ai_profiles.id='default'` from `.env.deploy.<env>.local`:

- `AI_DEFAULT_PROFILE_ID=default`
- `AI_DEFAULT_PROFILE_PROVIDER=<mock|openrouter>`
- `AI_DEFAULT_PROFILE_MODEL=<model-id>`
- `AI_DEFAULT_PROFILE_OPENROUTER_API_KEY=<secret>` when provider is `openrouter`
