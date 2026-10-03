# AI Runtime

How the narrator is asked for a turn, what it is allowed to see, and how its
answer is trusted before anything is written. Profiles and providers are
`docs/ai-configuration.md`; which blueprint fields reach which output is
`docs/blueprint-generation-flows.md`.

## How a request is assembled

Every narrator request goes through `packages/game-engine/src/role-request.ts`:
`buildRoleRequest` for roles with an output contract, `buildNarrationPrompt`
for plain narration (`intro`, `ambience`). It picks the role from the action
and state (`resolveSearchRole`, `resolveAccusationRole`), builds the role's
context (`ai-context.ts`), and renders its prompt (`ai-prompts.ts`) with the
blueprint's `target_age` and `narration_style`. It is the only place those two
are applied, and it imports no database, so the runtime eval harness calls it
directly instead of keeping a second copy.

Keep it the only path. The harness once assembled prompts itself, silently
built every evaluated prompt for a 6-year-old, and nothing failed.
`tests/api/unit/role-request.test.ts` asserts, for every role, that the
assembled prompt carries the blueprint's age and voice.

A turn then runs in one order: validate the request and the mode transition,
load the session and blueprint through `EngineContext`, assemble, call the
provider, validate the output, and only then persist. A provider or contract
failure writes nothing.

## Roles
<!-- extract:roles -->

- `talk_start` — a character enters the conversation.
- `talk_conversation` — the character answers, with continuity from earlier
  questions.
- `talk_end` — a short close.
- `search` — one output contract with two prompts:
  - `search_bare` reveals the next location-level clue and hints at
    sub-locations. It uses the lean `search_empty` word budget, or `search_find`
    when the backend already knows a clue will be revealed.
  - `search_targeted` judges the player's free text against the sub-locations,
    decides whether a clue is revealed, and whether the search costs a turn.
    The model decides the outcome, so the prompt carries both budgets
    (`OUTCOME_LENGTH_BY_ROLE` in `ai-prompts.ts`).
- `accusation_start` — frames the scene and asks for the accusation.
- `accusation_judge` — judges each round as `continue`, `win` or `lose`.
  - `win` needs the true culprit **and** either an evidence chain following one
    of the blueprint's `solution_paths`, or a correct account of what happened
    (culprit, key events, motive). Confronting the accused can earn a
    confession, but only when most of the facts are already right.
  - A wrong or thin accusation is `continue`, with warm narration ending in one
    question inviting another try. From round 3 a still-failing accusation is
    `lose`, with a gentle reveal.
<!-- /extract:roles -->

## Narration style
<!-- extract:narration-style -->

Every prompt's `{{style_guidance}}` slot is filled by `buildStyleGuidance`:

- The **standard narrator style** applies to every role: second person,
  present tense; warm, cozy, never scary; concrete sensory detail; characters
  speak in the first person with action beats; no meta-commentary.
- A blueprint may add `metadata.narration_style`, one sentence of voice or tone
  direction, layered on top. It can flavour the voice; it cannot override the
  point of view or the safety rules.
- Style is **subordinate to the reading level**. "Wry, gothic, faintly archaic"
  is a legitimate voice and no licence to raise vocabulary or sentence length,
  so the prompt says the reading level wins where they pull apart. The
  generator prompt holds the same line when authoring: `narration_style` may
  direct tone, mood and imagery only, never archaic, ornate, technical or
  heavily figurative diction.
<!-- /extract:narration-style -->

## What each role sees
<!-- extract:context-boundaries -->

The only context every role shares is `target_age`. Only `accusation_judge`
sees the full blueprint; `assertRoleContextSafety` enforces that for every
other role.

- **A character's public face** is identity, `sex`, visible `appearance`, and
  the `public_summary` from `narrative.starting_knowledge`. That is all any
  scene sees of a character, except that character's own talk turn.
- **Talk roles** get location summaries, every character's public face, and the
  active character's private roleplay context: `background`, `personality`,
  attitude, alibi, motive, clues, `flavor_knowledge`, `actual_actions`,
  `agendas`, `tells`, and `player_known_clues`. Knowledge about *other*
  characters travels only through explicit clues (`about_character_id`).
  - Each clue carries its gate's `requires_rationale` (the in-fiction reason it
    is withheld), a precomputed `prereqs_met`, and `known_to_player`; the
    prerequisite ids are not sent.
  - Each tell has visible `text` and a `trigger`: `always`, `condition` (free
    text the narrator judges), or `clue` (fires only when the player raises the
    referenced `clue_ids` and is believed — they hold the clue or bluff well).
    Tells are reactions, not defaults: a cue surfaces only when its trigger
    fires, or, with none authored, when the player touches something sensitive.
- **Search** gets the location, its clue progression, each sub-location with
  its narrator-only hint and unrevealed clues, and the player's `search_query`
  for a targeted search. Locked clues are filtered out, so their text can never
  be woven in.
- **Accusation start** gets spoiler-safe state and the public roster, so
  suspects are named with the right pronouns.
- **Accusation judge** gets the full blueprint plus what the investigator
  actually earned: `player_known_clues` (discovered clues in order, each with an
  `origin_label` such as "found at the Kitchen") and `path_coverage` (per
  reasoning path: `kind`, `summary`, `found_clue_ids`, `missing_clue_ids`).
  Without them the judge cannot tell an earned case from a lucky one. Both are
  rebuilt from event history, and `path_coverage` is precomputed so the model
  does not intersect sets across a long context.

Every character summary carries `sex`, and every prompt tells the model to use
it for pronouns rather than guess.

History is selected per role (`selectConversationHistoryForRole`): talk sees
only events with the active character, search only events at the current
location, and the accusation roles all history or none
(`accusation_history_mode`).
<!-- /extract:context-boundaries -->

## Trusting the output

Each role's output contract is a Zod schema in `ai-contracts.ts`; the parser
and the JSON Schema a provider hands the model (`roleOutputJsonSchema`) come
from the same schema. Output is validated before anything is written, and
invalid output is a retriable error.

- The parser forgives noise — a missing flag takes its default, junk entries in
  an id list are dropped — while the JSON Schema asks the model for the clean
  shape with every field required.
- The backend re-checks every revealed clue id against what the role was
  allowed to reveal (the active character's clues, the location's unlocked
  clues), and a locked search reveal is rejected and logged
  (`search.clue_locked`).
- When the model reports `input_understood: false` (gibberish), the parser
  forces the reveals empty, and for a search the turn cost to zero, so a
  confused turn can never leak a clue or cost the child a turn.
- Rules that span fields are applied by the parser only, never asked of the
  model.

## Clue discovery and gating
<!-- extract:clue-gating -->

Discovery is event-sourced: a clue is discovered once a `search` or `ask`
event records its id. `packages/game-engine/src/clue-discovery.ts` is the only
place that knows how a reveal is recorded and whether a gate is met.
`game_sessions.discovered_clues` is a cache; `game-get` rebuilds the notebook
from history.

A clue is discovered once. A narrator's reveal list names only clues the turn
reveals for the first time: a character may restate or elaborate on a clue the
player already holds (the talk context marks it `known_to_player`), but does
not list it again. `game-ask` and `game-search` both drop an id the session has
already discovered before recording the event or answering, and log it
(`ask.clue_already_discovered`, `search.clue_validation_failed`).

Gates use each clue's optional `requires` (`{ clue_ids, rationale }`):

- **Search — hard.** A bare search reveals the first unrevealed *and* unlocked
  location-level clue, skipping locked ones. A targeted search never sees
  locked clues, and the backend rejects a locked reveal.
- **Conversation — soft, with a brilliance override.** The narrator normally
  withholds a clue whose `prereqs_met` is false, but may grant it off-script
  for a clever question or a convincing bluff when the rationale implies a
  social or knowledge gate. Such reveals are listed in `revealed_off_script`
  and recorded as real discoveries.
- **Accusation — judged, not mechanical.** Nothing in `game-accuse` rejects an
  accusation on coverage. The judge prompt applies three scoping rules:
  - The discovered set limits the **evidence-chain** route only. The true-
    account route and an earned confession need no discovered clues, so a child
    who intuits the answer can still win.
  - `missing_clue_ids` steers the closing question; it is not a checklist to
    reject against.
  - The set is what the player may **cite**, not a fence around what they may
    reason. A correctly deduced fact they were never handed is credited.

The notebook's records (`DiscoveredClueRecord`: `origin`, `source`,
`discovered_at`, `off_script`) carry no reasoning-path information, and the
client groups by origin. `mapClueToThreads` exists but no player-facing path
may use it before the case resolves: its labels ("Red herring: …") name the
answer.
<!-- /extract:clue-gating -->

`game-start` and `game-get` return the notebook's case facts as structured
`state` (`mystery_summary`, `premise`, a `summary` per location and character);
`game-search` and `game-ask` return the turn's `revealed_clues` so the notebook
updates live. Nothing is parsed out of narration.

## Entering the first location
<!-- extract:game-enter -->

`game-enter` narrates arrival at the starting location, once, after the player
confirms the opening:

1. It is refused unless the session's only event is `start`, which is what
   stops a double confirmation narrating the arrival twice.
2. It generates `ambience` narration for the starting location with
   `has_visited_before: false` and no history — the same call `game-move` makes.
3. It persists a `move` event with `role: "enter"` and the location image, but
   changes no session state: entering costs no turn and moves no one.

`role: "enter"` also stops a replayed transcript inventing a `move to …` line
the player never typed.
<!-- /extract:game-enter -->

## The accusation lifecycle

`game-accuse` takes `game_id` and `player_reasoning`, which is optional only
when entering accuse mode.

1. From `explore` without reasoning: `accusation_start` narration; the mode
   becomes `accuse` (event `accuse_start`).
2. From `explore` with reasoning, or from `accuse`: a judge round. `continue`
   stays in `accuse` (`accuse_round`); `win` or `lose` ends the session with
   that outcome (`accuse_resolved`).
3. When `move`, `search` or `talk` spends the last turn, that action's event is
   stored first, then a `forced_endgame` event with urgent `accusation_start`
   narration, and the session enters `accuse` with no talk target.

Narration-bearing events carry `payload.diagnostics` (session, order, time), so
ordering and resume defects can be traced from the log alone.

## The mock provider

The default for `npm run dev` and every automated suite. It must exercise the
same paths deterministically:

- `talk_conversation` reveals the first clue whose `prereqs_met` holds, and on
  "aha" or "i bet" in the player's input grants the first locked clue
  off-script. It never reports a clue marked `known_to_player`.
- `accusation_judge` wins on the true culprit from round 1, otherwise
  `continue` until round 3 and then `lose`; it reads `path_coverage` to aim its
  closing question at an unfinished solution path.
- Its narration is written at the target reading age. No child sees it, but the
  runtime eval harness grades whatever the provider returns.

Changing a contract, a prompt, a context or provider selection changes the mock
and its tests in the same change.

## Failures, logs and attribution

- Provider calls retry with backoff (`AI_OPENROUTER_TIMEOUT_MS`,
  `AI_OPENROUTER_MAX_ATTEMPTS`, `AI_OPENROUTER_BASE_BACKOFF_MS`; defaults
  120000, 3, 750). A retriable failure, including an output that breaks its
  contract, answers `503` with `details.retriable: true`; the web client owns
  the retry policy.
- A blueprint that cannot be read or parsed is logged (`blueprint.read_failed`,
  `blueprint.parse_failed`) and treated as missing.
- Every AI call logs one JSON line to stdout: request id, endpoint, role,
  provider, requested `model`, the `responded_model` the provider reports,
  attempt, latency and outcome. Requests log `request.invalid`,
  `request.ai_retriable` and `request.unhandled_error`. `AI_CALL_LOG` records
  full prompts and outputs (`docs/ai-configuration.md`).
- Each AI-narrated event stores the model that produced it in
  `game_events.model`, captured right after its own call — a forced endgame is
  two calls and two models. The trace pipeline reads this column rather than
  the session's profile, which only says what was configured.
