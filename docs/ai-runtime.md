# AI Runtime

## Purpose

This document defines how AI-assisted narration is executed in Supabase Edge Functions for talk, search, and accusation flows, while keeping deterministic game-state rules and spoiler boundaries intact.

## Runtime Components

- `supabase/functions/_shared/ai-provider.ts`
  - Strict provider/model resolution from environment (`AI_PROVIDER`, `AI_MODEL`)
  - OpenRouter retry/backoff and timeout controls
  - Structured AI call logs (JSON) with request/action metadata
  - Live-suite helpers (`AI_LIVE`, AI mode labeling)
- `supabase/functions/_shared/ai-contracts.ts`
  - Role output parsing and validation before state mutation
- `supabase/functions/_shared/ai-context.ts`
  - Role-specific context builders
  - Non-accusation ground-truth guardrails
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
  - Frames accusation scene and requests reasoning
- `accusation_judge`
  - Evaluates iterative reasoning rounds and returns `continue|win|lose`

## Context Boundaries

- All roles receive shared, player-safe context:
  - title/one-liner/target age
  - visible world lists
  - current location metadata
  - role-selected interaction history
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
6. Call provider (`mock` or `openrouter`) through `getAIProvider`.
7. Parse and validate role output contract.
8. If validation/provider fails, return retriable error and skip state mutation.
9. If valid, persist session/event changes and return API payload.

For `game-move` (narration-only provider path):

1. Validate request payload and mode transition.
2. Load session and destination location from blueprint.
3. Load full game event history and select all-and-only destination-relative history via `selectLocationConversationHistory`.
4. Build move narration prompt including the destination-relative history.
5. Call provider `generateNarration`.
6. Persist move/forced-endgame event and session updates.

## Accusation Round Lifecycle

1. `game-accuse` from `explore`:
   - validates suspect
   - enters `accuse` mode
   - emits `accuse_start`
2. `game-accuse` from `accuse` with reasoning:
   - emits `accuse_round` when resolution is `continue`
   - emits `accuse_resolved` and transitions to `ended` on `win|lose`

## Runtime Model Selection and Live Suites

- Runtime model selection:
  - `AI_MODEL` is required at runtime
  - no runtime `AI_PROFILE` is required or parsed
- Provider:
  - `AI_PROVIDER=mock` for deterministic suites
  - `AI_PROVIDER=openrouter` + `OPENROUTER_API_KEY` for live model runs
- Live suite commands:
  - `npm run test:integration:live:free`
  - `npm run test:integration:live:paid`
  - `npm run test:e2e:live:free`
  - `npm run test:e2e:live:paid`
