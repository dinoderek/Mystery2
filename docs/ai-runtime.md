# AI Runtime

## Purpose

This document defines how AI-assisted narration is executed in Supabase Edge Functions for talk, search, and accusation flows, while keeping state transitions predictable and spoiler boundaries intact.

Blueprint V2 also adds operator-side generation, deterministic verification, and AI-judge review commands. Those workflows stay local/operator-only and are never exposed to the browser.

For accusation lifecycle specifics, see `docs/accusation-flow.md`.
For profile/deploy configuration, see `docs/ai-configuration.md`.

## Runtime Components

- `supabase/functions/_shared/ai-provider.ts`
  - Runtime provider/model resolution from session-linked AI profiles
  - OpenRouter retry/backoff and timeout controls
  - Structured AI call logs (JSON) with request/action metadata
  - Live-suite helpers (`AI_LIVE`, AI mode labeling)
- `supabase/functions/_shared/ai-profile.ts`
  - Service-role access to `ai_profiles`
  - Default profile and per-session profile lookup
- `supabase/functions/_shared/ai-contracts.ts`
  - Role output parsing and validation before state mutation
- `supabase/functions/_shared/ai-context.ts`
  - Role-specific context builders
  - Non-accusation ground-truth guardrails
- `scripts/lib/blueprints/draft-runs.mjs`
  - Shared `blueprints/drafts/` filesystem contract
- `scripts/lib/blueprints/verify-blueprint.mjs`
  - Deterministic verifier and generated `.verification.json` artifacts
- `scripts/lib/blueprints/judge-blueprint.mjs`
  - Strict-JSON AI judge and `.ai-judge-report.json` artifacts
- `supabase/functions/_shared/ai-prompts/`
  - Prompt templates for each role
- `supabase/functions/_shared/ai-prompts.ts`
  - Embedded prompt templates and variable rendering
- `packages/shared/src/mystery-api-contracts.ts`
  - Shared request/response boundary contracts for UI/backend payloads

## Roles and Prompt Responsibilities

- `talk_start`
  - Starts conversation tone and character entry
- `talk_conversation`
  - Handles follow-up question responses with continuity context
- `talk_end`
  - Produces short conversation-close narration
- `search`
  - Produces search narration for the current location
- `accusation_start`
  - Frames accusation scene and requests accusation + reasoning
- `accusation_judge`
  - Evaluates iterative reasoning rounds and returns `continue|win|lose`

## Context Boundaries

- All roles receive shared, player-safe context:
  - title/one-liner/target age
  - visible world lists
  - current location metadata
  - role-selected interaction history
- Runtime storage is key-based:
  - `game_sessions.current_location_id` stores `location_key`
  - `game_sessions.current_talk_character_id` stores `character_key`
  - event payload diagnostics should include both key and display-name fields where useful
- Role inputs are passed as direct top-level context fields (no separate `role_input` envelope).
- History selection rules:
  - talk roles: include all and only events tied to the active character
  - search role: include all and only events tied to the active location (including move/search events for that location)
  - accusation roles: history mode is configurable (`all` or `none`)
- Ground truth is excluded for all non-judge roles.
- Only `accusation_judge` context includes `ground_truth_context`.
- Guardrails are enforced in `assertRoleContextSafety`.

## Output Contracts

All AI role outputs are validated before any session/event writes:

- Talk/search roles: require non-empty `narration`.
- `accusation_start`: requires `narration` + `follow_up_prompt`.
- `accusation_judge`: requires:
  - `narration`
  - `accusation_resolution` in `win|lose|continue`
  - `follow_up_prompt` required when resolution is `continue`

Invalid output returns a retriable error and does not finalize turn state.

## Failure and Retry Model

- AI calls are executed before session mutations.
- OpenRouter calls use bounded server-side retries with exponential backoff for transient failures.
- Retry/timeout settings are environment-driven:
  - `AI_OPENROUTER_TIMEOUT_MS` (default `45000`)
  - `AI_OPENROUTER_MAX_ATTEMPTS` (default `3`)
  - `AI_OPENROUTER_BASE_BACKOFF_MS` (default `750`)
- Retriable provider failures return:
  - HTTP `503`
  - `{ error, details: { retriable: true, code, ... } }`
- Output-contract failures are also returned as retriable AI failures.
- Web UI retry logic remains the owner of retry policy.
- `game-start` and `game-move` now map retriable provider failures to the same structured `503` shape used by other AI endpoints.
- Operator workflow failures should also surface `stage`, `blueprint_path` and/or `blueprint_id`, plus `run_id` when operating inside `blueprints/drafts/`.

## Structured AI and Request Logs

- AI calls emit JSON logs to edge runtime stdout with:
  - `request_id`, `endpoint`, `action`, optional `game_id`
  - `role`, `provider`, `model`
  - `attempt`, `latency_ms`, `outcome` (`success|retry|failure`)
  - retriable diagnostics (`retriable_code`, `retriable_status`) when applicable
- AI endpoints also emit structured request logs for invalid/unhandled paths:
  - `request.invalid` for validation and mode-transition failures
  - `request.ai_retriable` for retriable AI/provider/output failures
  - `request.unhandled_error` for unexpected failures
- For local development, tail these logs via:
  - `npm run logs:edge`

## Blueprint V2 Authoring Workflow

1. Write a `brief.md`.
2. Run `npm run generate:blueprints -- --brief <path> --output-name <name>`.
3. Review candidates under `blueprints/drafts/`.
4. Run `npm run verify:blueprint -- --blueprint-path <candidate-path>`.
5. Run `npm run judge:blueprint -- --blueprint-path <candidate-path>`.
6. Manually decide whether to copy a candidate into top-level `blueprints/`.

Image generation remains separate, but Blueprint V2 image prompts must use only spoiler-safe visual metadata plus non-spoiler public metadata such as title and one-liner.

Rollout note: stale V1-backed sessions/events are unsupported. Clear old local/dev/test `game_sessions` and `game_events` rows manually before validating Blueprint V2 runtime behavior.

## Serving Request Flow

For endpoints using AI roles (`game-talk`, `game-ask`, `game-end-talk`, `game-search`, `game-accuse`):

1. Validate request payload and current mode transition.
2. Load current session and blueprint context from Supabase.
3. Build role context with `build*Context` in `ai-context.ts`.
4. Select role-specific history via `selectConversationHistoryForRole`:
   - talk => character-relative only
   - search => location-relative only
   - accuse => all or none (mode-controlled)
5. Render prompt template for the role.
6. Resolve the session AI profile and build provider (`mock` or `openrouter`) via `createAIProviderFromProfile`.
7. Parse and validate role output contract.
8. If validation/provider fails, return retriable error and skip state mutation.
9. If valid, persist session/event changes and return API payload.

For timeout-forced endgame transitions (`game-move`, `game-search`, `game-talk`, `game-ask` when time reaches zero):

1. Validate request payload and mode transition.
2. Build `accusation_start` context with `forced_by_timeout=true`.
3. Generate urgency narration that time is over and accusation must begin immediately.
4. Persist `forced_endgame` event and transition session mode to `accuse`.

## Accusation Round Lifecycle

1. `game-accuse` from `explore`:
   - with no `player_reasoning`: enters `accuse` mode and emits `accuse_start`
   - with `player_reasoning`: runs immediate judge round and can emit `accuse_round` or `accuse_resolved`
2. `game-accuse` from `accuse` with reasoning:
   - emits `accuse_round` when resolution is `continue`
   - emits `accuse_resolved` and transitions to `ended` on `win|lose`

## Runtime Model Selection and Live Suites

- Runtime model selection:
  - `game-start` accepts optional `ai_profile` and persists it on `game_sessions.ai_profile_id`
  - all subsequent AI endpoints resolve provider/model/key from that stored profile id
  - canonical default profile id is `ai_profiles.id='default'`
- Provider secrets:
  - OpenRouter API key is read from `ai_profiles.openrouter_api_key` only
- Local profile seeding:
  - `npm run seed:ai` seeds `mock`, optional `free`/`paid`, and canonical `default`
  - `npm run seed:ai -- --only free` (or `paid` / `mock`) updates that profile and updates `default` without restarting Supabase
- Live suite commands:
  - `npm run test:integration:live:free`
  - `npm run test:integration:live:paid`
  - `npm run test:e2e:live:free`
  - `npm run test:e2e:live:paid`
