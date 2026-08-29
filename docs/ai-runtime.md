# AI Runtime

## Purpose

This document defines how AI-assisted narration is executed in the game server for talk, search, and accusation flows, while keeping state transitions predictable and spoiler boundaries intact.

For accusation lifecycle specifics, see `docs/accusation-flow.md`.
For profile/deploy configuration, see `docs/ai-configuration.md`.
For a field-by-field map of which blueprint data reaches each generated output,
see `docs/blueprint-generation-flows.md`.
For how generated blueprints are evaluated, see `docs/evaluation-pipeline.md`.

Important version note:

- live gameplay runtime now consumes Blueprint V2 from
  `packages/shared/src/blueprint-schema-v2.ts`

## Runtime Components

- `packages/game-engine/src/ai-provider.ts`
  - Runtime provider/model resolution from session-linked AI profiles
  - OpenRouter retry/backoff and timeout controls
  - Structured AI call logs (JSON) with request/action metadata
  - Live-suite helpers (`AI_LIVE`, AI mode labeling)
- `packages/game-engine/src/context.ts`
  - `AIProfileStore` — default and per-session profile lookup
- `packages/game-engine/src/context-local.ts`
  - Service-role access to `ai_profiles` behind `AIProfileStore`
- `packages/game-engine/src/ai-contracts.ts`
  - Role output parsing and validation before state mutation
- `packages/game-engine/src/ai-context.ts`
  - Role-specific context builders
  - Non-accusation ground-truth guardrails
- `packages/game-engine/src/ai-prompts.ts`
  - Embedded prompt templates and variable rendering (single source of truth —
    there are no separate prompt files)
  - Standard narrator style plus optional per-blueprint
    `metadata.narration_style` layering (`buildStyleGuidance`)
- `packages/game-engine/src/role-request.ts`
  - **The single assembly path for every narrator request.** A registry keyed by
    role knows its context builder and how to render its prompt;
    `buildRoleRequest` (role-output roles) and `buildNarrationPrompt`
    (`intro`, `ambience`) are the only entry points.
  - Owns the action+state → role resolution: `resolveSearchRole`
    (`search_bare` | `search_targeted`) and `resolveAccusationRole`
    (`accusation_start` | `accusation_judge`).
  - The only place `target_age` and `narration_style` are applied. Handlers no
    longer call `loadPromptTemplate`/`renderPrompt` directly, and neither does
    the eval harness — see [Why assembly is shared](#why-assembly-is-shared).
  - Purity contract: imports only sibling `_shared/*.ts`, no Deno globals, no
    DB. Node imports it directly so the runtime eval harness reuses it.
- `packages/shared/src/mystery-api-contracts.ts`
  - Shared request/response boundary contracts for UI/backend payloads

## Blueprint Evaluation Reference

Blueprint evaluation is a separate concern from the gameplay runtime. The
current evaluator is the multi-dimension **evaluation pipeline** at
`evaluation/` — see `docs/evaluation-pipeline.md` (design) and
`evaluation/README.md` (how to run). It runs always-on mechanical checks plus
one LLM judge per dimension (solve depth, fairness, timeline + knowledge
coherence, character grounding, path payoff) and writes a structured
`result.json` envelope.

The former single-prompt evaluator has been **removed**. The post-generation
verification pass in `scripts/generate-blueprint.mjs` now runs the pipeline's
own mechanical checks (`evaluation/checks/mechanical.mjs`) in-process and writes
the pass/fail structural result to a sibling `*.verification.json` artifact — no
LLM verifier and no extra network call.

Both the evaluation pipeline and the gameplay runtime target Blueprint V2.

## Roles and Prompt Responsibilities

- `talk_start`
  - Starts conversation tone and character entry
- `talk_conversation`
  - Handles follow-up question responses with continuity context
- `talk_end`
  - Produces short conversation-close narration
- `search` (output-contract role; the prompt is always one of the two variants
  `search_bare` / `search_targeted` — there is no plain `search` template)
  - Produces search narration for the current location
  - `search_bare`: reveals next location-level clue and hints about sub-locations.
    It defaults to the lean `search_empty` word budget, but the handler switches
    to the roomier `search_find` budget on turns where the backend already knows
    a clue will be revealed.
  - `search_targeted`: AI judges player's freeform search text against sub-locations, decides whether to reveal a clue, and controls turn cost.
    The model decides the outcome, so the prompt carries two word budgets:
    `search_find` when a clue is revealed, `search_empty` when none is
    (`OUTCOME_LENGTH_BY_ROLE` in `ai-prompts.ts`).
- `accusation_start`
  - Frames accusation scene and requests accusation + reasoning
- `accusation_judge`
  - Evaluates iterative reasoning rounds and returns `continue|win|lose`
  - Accepts (`win`) only when the player names the true culprit AND either
    follows a `solution_paths` evidence chain or correctly tells the story of
    what happened (culprit + key sequence of events + motive). A direct
    confrontation can earn a confession, but only when the player already has
    most of the facts right.
  - Rejects wrong or under-supported accusations with warm encouragement
    (`continue` + retry-inviting `follow_up_prompt`); from round 3 onward a
    still-failing accusation resolves `lose` with a gentle reveal.

## Why assembly is shared

Assembling a narrator request means three things: pick the role, build its
context, and render its prompt with the blueprint's `target_age` and
`narration_style`. That used to be inlined in every handler **and**
re-implemented by the runtime eval harness, so there were two independent
assembly paths — and they drifted.

The harness called `loadPromptTemplate(role)` with no age and no style.
`targetAge` is required; omitted, `clampTargetAge` falls back to
`MIN_TARGET_AGE`, so **every evaluated prompt was built for a 6-year-old**
regardless of the blueprint, while the `flesch` judge graded the output against
the blueprint's real age. `narration_style` never reached the model on that path
at all. Nothing failed — the assertion in `ai-prompts.ts` that "a missing age is
a compile error" holds only for TypeScript callers, and the JS harness was never
in `tsc`'s include.

One assembly path removes that class of bug by construction: there is no second
implementation left to drift. Transport (an HTTP call to the server, or a
local CLI replay) is layered on top rather than duplicating the logic.

`tests/api/unit/role-request.test.ts` is the standing guard — for every role it
asserts the assembled prompt carries the blueprint's age and voice.

## Narration Style

Every runtime prompt carries a `{{style_guidance}}` slot that
`loadPromptTemplate` always fills (`buildStyleGuidance` in `ai-prompts.ts`):

- The **standard narrator style** (second person, present tense; warm, cozy,
  never scary; concrete sensory detail; first-person character dialogue with
  action beats; no meta-commentary) applies to every role, including the
  code-built `game-start` and `game-move` prompts.
- A blueprint may optionally set `metadata.narration_style` (one sentence of
  voice/tone direction). It is layered on top of the standard style — it can
  flavor the voice, not override the safety/POV rules.
- The style layer is explicitly **subordinate to the reading level**. A voice
  like "wry, gothic, faintly archaic" is a legitimate authored style but an
  illegitimate licence to raise vocabulary or sentence length, so
  `buildStyleGuidance` states that where voice and reading level pull apart,
  the reading level wins. The generator prompt enforces the same rule at the
  authoring end: `narration_style` may direct tone, mood, and imagery only, and
  must not call for archaic, ornate, technical, or heavily figurative diction.

## Context Boundaries

- All roles receive shared, player-safe context:
  - `target_age` only
- Role inputs are passed as direct top-level context fields (no separate `role_input` envelope).
- Role-specific grounding lives outside the shared context:
  - talk roles get grounded location summaries, public character summaries,
    and active-character roleplay context (including `agendas`, `tells`, and
    `player_known_clues` when present). Public character summaries are
    **public knowledge only**: identity, `sex`, visible `appearance`, and the
    player-facing `public_summary` from `narrative.starting_knowledge`. Private
    authored fields (`background`, alibi, motive, clues, agendas, ...) exist
    only on the ACTIVE character's private context — knowledge about other
    characters travels exclusively via explicit clues (`about_character_id`). `tells` is a first-class array on the
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
  - accusation start gets spoiler-safe current-state context plus the public
    character roster (names, `sex`, `appearance`, `public_summary`) so the
    narrator can name suspects with grounded pronouns
  - accusation judge gets the full blueprint, plus the two fields that say what
    the investigator actually earned from it: `player_known_clues` (every clue
    discovered this session, in discovery order, each with a short
    `origin_label` such as "found at the Kitchen" / "told by Alice Smith") and
    `path_coverage` (per reasoning path: `path_id`, `kind`
    (`solution` | `red_herring` | `eliminate`), `summary`, `found_clue_ids`,
    `missing_clue_ids`). The blueprint alone lists every clue that *exists*, so
    without these the judge cannot tell an earned case from an unearned one.
    Both are rebuilt from event history via `buildDiscoveredClueIdSet`, not read
    from the `discovered_clues` cache. `path_coverage` is precomputed for the
    same reason `prereqs_met` is on the talk side: the model should not have to
    intersect sets across a long context. See Clue discovery and gating.
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
- `follow_up_prompt` is the prompt shown to the player when they need to add
  more to their accusation. It is player-facing, so it is held to the same
  reading level and kept to one short question; the role's word budget governs
  `narration` alone.

Invalid output returns a retriable error and does not finalize turn state.

## Clue discovery and gating

Discovery is event-sourced. A clue is "discovered" once a `search` or `ask` event
records its id; `packages/game-engine/src/clue-discovery.ts` is the single place
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
- **Accusation (judged, not mechanical).** The judge receives
  `player_known_clues` and `path_coverage` (see Context Boundaries), built by
  `buildKnownCluesWithOrigin` / `buildPathCoverage`. Three deliberate scoping
  rules are encoded in the `accusation_judge` prompt:
  - The discovered set constrains the **evidence-chain** win route only. The
    "true account" route and a confession earned by confrontation do not require
    discovered clues, so a child who intuits the answer can still win.
  - `missing_clue_ids` steers the *follow-up question*; it is explicitly not a
    checklist to reject against. A player need not hold every clue on a path.
  - The set is what the player may **cite as evidence**, not a fence around what
    they may reason. A correctly deduced fact they were never handed is credited.

  There is no mechanical gate: the resolution stays AI-judged, and nothing in
  `game-accuse` rejects an accusation on coverage alone.
- **Mock runtime.** The mock `talk_conversation` reveals the first `prereqs_met`
  clue, and on a sentinel in the player input ("aha"/"i bet") grants the first
  locked clue off-script — so tests exercise both paths deterministically. The
  mock `accusation_judge` keeps its own resolution rule (correct culprit wins
  from round 1) but reads `path_coverage` to aim its rejection follow-up at an
  unfinished solution path. Mock narration is also written at the target reading
  age: it is a fixture no child ever sees, but the runtime eval harness grades
  whatever the provider returns, so adult-register mock text would show up as a
  permanent false failure in the coverage sweep.

The notebook (`game-get` `state.discovered_clues`) is built by
`buildDiscoveryRecords` and carries no reasoning-path information:
`DiscoveredClueRecord` has `origin`, `source`, `discovered_at`, and `off_script`
only, and the client groups by `origin`. `mapClueToThreads` still exists but is
deliberately unused by any player-facing path — its labels ("Main solution",
"Red herring: <payoff>") name the answer, so they may only ever appear after the
case resolves.

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
- Blueprint reads are also resilient: the per-session turn endpoints load the
  blueprint via `ctx.content.loadBlueprint()`, whose implementation
  (`packages/game-engine/src/context-local.ts`) retries transient
  `blueprints` bucket download failures with a short backoff (3 attempts) before
  giving up. Storage reads can blip under concurrent load even when the object
  exists; the retry prevents a player-visible `500 Blueprint missing` mid-session.
  JSON/schema parse failures are deterministic and are not retried.

## Structured AI and Request Logs

- AI calls emit JSON logs to edge runtime stdout with:
  - `request_id`, `endpoint`, `action`, optional `game_id`
  - `role`, `provider`, `model` (the requested model)
  - `responded_model` on success — the model the provider reported serving the
    request, which can differ from the requested `model` under OpenRouter
    routing/fallback
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
2. Load current session and blueprint context through `EngineContext`.
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
3. Append a short, static notebook-guidance narrator part to the persisted
   `start` event (pointing the player at the `notebook` command). The
   `starting_knowledge` reference material (mystery summary, per-location and
   per-character summaries) is **not** dumped into narration anymore — it is
   surfaced as structured data on the session `state` (`mystery_summary`,
   `premise`, and a `summary` on each location/character) so the in-game
   notebook can render it. See [game.md](game.md) (Notebook).

For `game-enter` (arrival at the starting location, once per session):

1. Reject unless the session's only event is `start` — the endpoint is valid
   exactly once, right after `game-start`, and the guard is what stops a double
   confirmation from narrating the arrival twice.
2. Generate `ambience` narration for `current_location_id` with
   `has_visited_before: false` and no destination history — nothing has happened
   yet. This is the second `ambience` caller alongside `game-move`.
3. Persist it as a normal `move` event (payload `role: "enter"`) carrying the
   location image, but write no session state: entering costs no turn and moves
   the player nowhere.

`role: "enter"` also suppresses the synthetic `move to <location>` player line
that `readNarrationEvent` reconstructs for real moves — the player confirmed a
prompt, they did not type a command, and a replayed transcript must not invent
one.

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
- `accusation_start` receives `sex` through the explicit public character
  roster on `accusation_start_context.characters`.
- `accusation_judge` receives `sex` through the full blueprint context.
- `game-start` and `game-get` also expose `sex` on player-visible character
  summaries so the API boundary stays aligned with the narrator-facing data
  model.

### Notebook data on the session boundary

The in-game notebook is fed entirely by structured fields on the API boundary,
not by parsing narration:

- `game-start` and `game-get` return `state.mystery_summary`, `state.premise`,
  and a `summary` on each `state.locations[]` / `state.characters[]` entry
  (sourced from `narrative.starting_knowledge`; `null` when unauthored).
- `game-get` returns the full `state.discovered_clues` snapshot, rebuilt from
  the event transcript via `buildPlayerKnownClues`
  (`packages/game-engine/src/ai-context.ts`).
- `game-search` and `game-ask` return `revealed_clues` — the clue(s) revealed by
  that single action — which the client merges into its discovered-clue list so
  the notebook updates live. Clue ids are mapped to text via the shared
  `mapClueIdsToClues` helper (`packages/game-engine/src/clues.ts`).

## Accusation Round Lifecycle

1. `game-accuse` from `explore`:
   - with no `player_reasoning`: enters `accuse` mode and emits `accuse_start`
   - with `player_reasoning`: runs immediate judge round and can emit `accuse_round` or `accuse_resolved`
2. `game-accuse` from `accuse` with reasoning:
   - emits `accuse_round` when resolution is `continue`
   - emits `accuse_resolved` and transitions to `ended` on `win|lose`
3. Judge semantics: wrong or under-supported accusations return `continue` with
   encouragement to try again; `win` requires the true culprit plus a valid
   evidence chain or a correct account of events (or a confession earned by
   confronting with most facts right); from round 3 a still-failing accusation
   resolves `lose`. The mock provider mirrors this (wrong suspect → `continue`
   until round 3, then `lose`).

## Per-Event Model Attribution

Every AI-narrated event records the model that produced it in the
`game_events.model` column (migration `0013_game_events_model.sql`):

- Providers expose `resolvedModel` (`packages/game-engine/src/ai-provider.ts`).
  For OpenRouter it is the model reported in the API response (`payload.model`),
  which can differ from the requested `profile.model`; for the mock provider it
  is the configured `profile.model`.
- Endpoints capture `resolvedModel` immediately after each generate call and
  pass it to `insertNarrationEvent`. In the forced-endgame path
  (`game-move`, `game-talk`, `game-search`) the action narration and the
  `forced_endgame` narration are separate AI calls, so each event is tagged with
  the model captured right after its own call rather than re-reading the
  provider at insert time.
- The column is nullable: non-AI events and rows created before migration 0013
  carry `null`.
- The trace pipeline surfaces it as `events[].model`
  (`evaluation/trace/lib/normalize.mjs`); this is per-call ground truth and is
  more reliable than inferring the model from the session's `ai_profile`, which
  only reflects the configured model at extraction time.

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
