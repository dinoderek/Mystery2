# AI Runtime

## Purpose

This document defines how AI-assisted narration is executed in Supabase Edge Functions for talk, search, and accusation flows, while keeping state transitions predictable and spoiler boundaries intact.

For accusation lifecycle specifics, see `docs/accusation-flow.md`.
For profile/deploy configuration, see `docs/ai-configuration.md`.
For a field-by-field map of which blueprint data reaches each generated output,
see `docs/blueprint-generation-flows.md`.
For the standalone blueprint evaluator prompt and output schema, see
`docs/blueprint-evaluation.md`.

Important version note:

- live gameplay runtime still consumes Blueprint V1 from
  `packages/shared/src/blueprint-schema.ts`
- Blueprint V2 currently exists only for authoring, generation, and evaluation

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
- `supabase/functions/_shared/ai-prompts/`
  - Prompt templates for each role
- `supabase/functions/_shared/ai-prompts.ts`
  - Embedded prompt templates and variable rendering
- `packages/shared/src/mystery-api-contracts.ts`
  - Shared request/response boundary contracts for UI/backend payloads
- `packages/shared/src/evaluation/`
  - Standalone blueprint-evaluation prompt and output schema for offline or
    pre-runtime quality checks

## Blueprint Evaluation Reference

Blueprint evaluation is currently a separate concern from gameplay runtime.

- Prompt source: `packages/shared/src/evaluation/prompt.ts`
- Output schema: `packages/shared/src/evaluation/schema.ts`
- Blueprint V2 schema source: `packages/shared/src/blueprint-schema-v2.ts`

The evaluator currently judges blueprint quality, solvability structure,
dead ends, red herrings, and consistency without participating in live gameplay
state transitions.

In this phase the evaluator targets Blueprint V2, while gameplay runtime still
operates on Blueprint V1. Runtime migration to V2 is intentionally deferred.

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
  - `target_age` only
- Role inputs are passed as direct top-level context fields (no separate `role_input` envelope).
- Role-specific grounding lives outside the shared context:
  - talk roles get grounded location summaries, public character summaries, and active-character roleplay context
  - search gets location description plus canonical clue progression state
  - accusation start gets spoiler-safe current-state context
  - accusation judge gets the full blueprint
- Character `sex` is included anywhere runtime AI receives character summaries
  or full blueprint data, and prompt guidance now explicitly tells the model to
  use that field for pronoun choice instead of guessing.
- History selection rules:
  - talk roles: include all and only `talk`/`ask`/`end_talk` events tied to the active character, preserving prior `player_input`
  - search role: include all and only events tied to the active location (including move/search events for that location)
  - accusation roles: history mode is configurable (`all` or `none`)
- Full blueprint context is excluded for all non-judge roles.
- Only `accusation_judge` context includes the full blueprint.
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
  - `AI_OPENROUTER_TIMEOUT_MS` (default `120000`)
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
6. Resolve the session AI profile and build provider (`mock` or `openrouter`) via `createAIProviderFromProfile`.
7. Parse and validate role output contract.
8. If validation/provider fails, return retriable error and skip state mutation.
9. If valid, persist session/event changes and return API payload.

For `game-start`:

1. Load the selected blueprint and resolve the session AI profile.
2. Generate the opening narration from `premise` plus `target_age`.
3. Append `starting_knowledge` as an additional narrator part in the persisted `start` event.

For `game-move`:

1. Load destination blueprint data and destination-relative history.
2. Compute whether the location has been visited before.
3. Generate move narration with revisit-consistency instructions plus `target_age`.
4. Pass destination character public summaries including `sex` so the narrator
   can use grounded pronouns when describing who is present.

For timeout-forced endgame transitions (`game-move`, `game-search`, `game-talk`, `game-ask` when time reaches zero):

1. Validate request payload and mode transition.
2. Build `accusation_start` context with `forced_by_timeout=true`.
3. Generate urgency narration that time is over and accusation must begin immediately.
4. Persist `forced_endgame` event and transition session mode to `accuse`.

## Pronoun Grounding

- Runtime prompts for `talk_start`, `talk_conversation`, `talk_end`,
  `accusation_start`, `accusation_judge`, and ad hoc `game-move` narration now
  explicitly instruct the model to use provided character `sex` for pronouns.
- Non-judge talk flows receive `sex` through `talk_context` public/private
  character summaries.
- `game-move` receives `sex` in destination character public summaries.
- `accusation_judge` receives `sex` through the full blueprint context.
- `game-start` and `game-get` also expose `sex` on player-visible character
  summaries so the API boundary stays aligned with the narrator-facing data
  model.

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
