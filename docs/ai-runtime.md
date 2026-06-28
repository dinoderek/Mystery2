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

- live gameplay runtime now consumes Blueprint V2 from
  `supabase/functions/_shared/blueprints/blueprint-schema-v2.ts`

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

Blueprint evaluation is a separate concern from the gameplay runtime. The
current evaluator is the multi-dimension **evaluation pipeline** at
`evaluation/` — see `docs/evaluation-pipeline.md` (design) and
`evaluation/README.md` (how to run). It runs always-on mechanical checks plus
one LLM judge per dimension (solve depth, fairness, timeline + knowledge
coherence, character grounding, path payoff) and writes a structured
`result.json` envelope.

The original single-prompt evaluator (`packages/shared/src/evaluation/`,
`prompt.ts` + `schema.ts`) is **deprecated**. It survives only as the
post-generation verification pass in `scripts/generate-blueprint.mjs` (which
writes a sibling `*.verification.json` artifact) and will be removed once that
path moves to the pipeline.

Both the evaluator and the gameplay runtime target Blueprint V2.

## Roles and Prompt Responsibilities

- `talk_start`
  - Starts conversation tone and character entry
- `talk_conversation`
  - Handles follow-up question responses with continuity context
- `talk_end`
  - Produces short conversation-close narration
- `search` (with prompt variants `search_bare` and `search_targeted`)
  - Produces search narration for the current location
  - `search_bare`: reveals next location-level clue and hints about sub-locations
  - `search_targeted`: AI judges player's freeform search text against sub-locations, decides whether to reveal a clue, and controls turn cost
- `accusation_start`
  - Frames accusation scene and requests accusation + reasoning
- `accusation_judge`
  - Evaluates iterative reasoning rounds and returns `continue|win|lose`

## Context Boundaries

- All roles receive shared, player-safe context:
  - `target_age` only
- Role inputs are passed as direct top-level context fields (no separate `role_input` envelope).
- Role-specific grounding lives outside the shared context:
  - talk roles get grounded location summaries, public character summaries,
    and active-character roleplay context (including `agendas`, `tells`, and
    `player_known_clues` when present). `tells` is a first-class array on the
    character (separate from agendas); each tell has `text` (the visible cue)
    and a `trigger` whose `kind` is `always`, `condition` (free-text narrative
    condition), or `clue` (fires only when the player brings up the referenced
    `clue_ids` and the character believes them — i.e. the player holds the clue
    or bluffs convincingly). The `talk_conversation` prompt treats tells as
    reactions, not defaults: a cue surfaces only when its trigger fires (or, with
    no authored tell, when the player's message genuinely touches something
    sensitive), so characters no longer leak the same tells and volunteer the
    same state every turn regardless of input.
  - talk character clues carry, per clue, the gate's `requires_rationale` (the
    in-fiction reason it is withheld) and a precomputed `prereqs_met` flag (see
    Clue discovery and gating). Prerequisite clue ids themselves are not sent.
  - search gets location description, canonical clue progression state, sub-location context (with hints and unrevealed clues), and optional `search_query` for targeted searches. Locked clues (unmet `requires`) are filtered out of the sub-location `unrevealed_clues` so the narrator never weaves a locked clue's text in.
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

- Talk start/end roles: require non-empty `narration`.
- Talk conversation role: requires non-empty `narration` plus `revealed_clue_ids` (string array, may be empty), `revealed_off_script` (string array, a subset of `revealed_clue_ids` — clues granted off-script via the brilliance override), and `input_understood` (boolean, defaults to `true` when omitted). The AI reports which character clues it revealed; the backend validates IDs against the active character's clue list before persisting, and intersects `revealed_off_script` with the validated reveals. When `input_understood` is `false` (the player's message was gibberish), the narration is an in-character "what?" beat and the contract parser forces both arrays empty so a confused turn can never leak a clue.
- Search role: requires non-empty `narration`, plus `revealed_clue_id` (string or null), `costs_turn` (boolean), and `input_understood` (boolean, defaults to `true`). Backend validates the AI's clue choice before persisting. Only `search_targeted` can set `input_understood: false` (bare searches have no free text); the parser then forces `revealed_clue_id` null and `costs_turn` false so unintelligible searches reveal nothing and cost no turn.
- `accusation_start`: requires `narration` + `follow_up_prompt`.
- `accusation_judge`: requires:
  - `narration`
  - `accusation_resolution` in `win|lose|continue`
  - `follow_up_prompt` required when resolution is `continue`

Invalid output returns a retriable error and does not finalize turn state.

## Clue discovery and gating

Discovery is event-sourced. A clue is "discovered" once a `search` or `ask` event
records its id; `supabase/functions/_shared/clue-discovery.ts` is the single place
that knows how reveals are encoded (`buildDiscoveredClueIdSet`,
`eventRevealedClueIds`) and whether a gate is satisfied (`isClueUnlocked`).
`game_sessions.discovered_clues` is a denormalized cache the search/ask handlers
keep in sync; event history remains the source of truth, so `game-get` reconciles
the notebook from history.

Gating uses each clue's optional `requires` (`{ clue_ids, rationale }`):

- **Search (hard).** Bare search reveals the first unrevealed AND unlocked
  location-level clue (skipping locked ones); targeted search filters locked clues
  out of context and a backend backstop rejects a locked reveal (logged
  `search.clue_locked`).
- **Conversation (soft + brilliance override).** Each character clue is presented
  with `requires_rationale` and a computed `prereqs_met` flag. The narrator
  normally withholds a clue when `prereqs_met` is false, but MAY grant an
  off-script reveal for a clever question/convincing bluff when the rationale
  implies a bypassable social/knowledge gate; such reveals are listed in
  `revealed_off_script` and recorded as real discoveries.
- **Mock runtime.** The mock `talk_conversation` reveals the first `prereqs_met`
  clue, and on a sentinel in the player input ("aha"/"i bet") grants the first
  locked clue off-script — so tests exercise both paths deterministically.

The notebook (`game-get` `state.discovered_clues`) groups discovered clues by
mini-mystery thread via `mapClueToThreads` / `buildDiscoveryRecords`.

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
- Blueprint storage reads are also resilient: the per-session turn endpoints load
  the blueprint via the shared `loadBlueprint` helper
  (`supabase/functions/_shared/blueprints/load.ts`), which retries transient
  `blueprints` bucket download failures with a short backoff (3 attempts) before
  giving up. Storage reads can blip under concurrent load even when the object
  exists; the retry prevents a player-visible `500 Blueprint missing` mid-session.
  JSON/schema parse failures are deterministic and are not retried.

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
- Blueprint loads emit:
  - `blueprint.download_retry` (warn-level info) per transient retry attempt
  - `blueprint.download_failed` once all attempts are exhausted
  - `blueprint.parse_failed` for a malformed/invalid blueprint (not retried)
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
3. Format `starting_knowledge` (a structured object with `mystery_summary`, per-location summaries, and per-character summaries) into a "You already know:" block and append it as an additional narrator part in the persisted `start` event.

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
- Local profile seeding, mock vs live mode behavior, and reseeding rules are
  owned by [`docs/ai-configuration.md`](ai-configuration.md).

## Change Management

When changing role output contracts, prompt/context shape, provider selection,
or session/profile resolution:

- update the mock provider behavior and unit coverage
- update any integration or API E2E assertions that depend on the seeded
  `default` mock profile
- update [`docs/ai-configuration.md`](ai-configuration.md) if seeded profile
  behavior or local profile workflow changed
