# AI Runtime

Narrator inputs, contracts and validation before saving a turn. MSF projections:
[paired runtime](msf-gameplay.md). Profiles and providers are
`docs/ai-configuration.md`; which blueprint fields reach which output is
`docs/blueprint-generation-flows.md`.

## How a request is assembled

Every narrator request goes through `packages/game-engine/src/role-request.ts`:
`buildRoleRequest` for roles with an output contract, `buildNarrationPrompt`
for plain narration (`intro`, `ambience`). It picks the role from the action
and state (`resolveSearchRole`, `resolveAccusationRole`), builds the role's
context (`ai-context.ts`), and renders its prompt (`ai-prompts.ts`) with the
blueprint's `target_age` and `narration_style`. It is the only place those two
are applied and imports no database, so the eval harness calls it directly; a
second copy would drift (`tests/api/unit/role-request.test.ts`).

**Lean prompts.** Each rule is stated once and no two conflict
(`tests/api/unit/talk-prompt.test.ts`). Voice, reading level and grounding
(only given facts, pronouns from `sex`) live in the shared layer alone.
`talk-prompt.ts` builds `talk_conversation` from sections the character needs:
its agenda types and conditions, lock kinds, tell kinds, an open fallback.
Recorded state replaces refereeing; the one judgement left is whether a clue
was used this turn.

## Roles

The roles and their output contracts are `ai-contracts.ts`. `search` is one
contract with two prompts: `search_bare` uses the `search_find` word budget
when the backend already knows a clue will be revealed, else `search_empty`;
`search_targeted` carries both, because the model decides the outcome
(`OUTCOME_LENGTH_BY_ROLE` in `ai-prompts.ts`). `accusation_judge` answers each
round `continue`, `win` or `lose` by the rule in "The accusation" in
`docs/game.md`. `talk_start` and `talk_end` move nobody; `gm_fabrication`
reports invented movement.

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

Which blueprint fields reach which role is the "Narration at play" table in
`docs/blueprint-generation-flows.md`. The rules and reasons behind it:

- Only `accusation_judge` sees the full blueprint; `assertRoleContextSafety`
  enforces that for every other role. Knowledge about *other* characters
  travels only through explicit clues (`about_character_id`).
- A talk clue carries its gate's `requires_rationale` (the in-fiction reason it
  is withheld), `requires_kind`, `known_to_player`, and
  `player_can_use_prerequisites`: the player holds the prerequisites, a
  precondition for using them, never permission. Prerequisite ids are not sent,
  so the model gates on the reason, not set arithmetic.
- **The speaker hears only steps safe to say.** A talk pack's `actual_actions`
  drops every step a self-protect cover `hides_steps`, until an earned part's
  `concedes_steps` or the confession gives it up.
- **Tells are reactions, not defaults.** Each has visible `text` and a
  `trigger`: `always`, `condition` (free text the narrator judges), or `clue`
  (fires only when the player uses a referenced clue). A cue surfaces only when
  its trigger fires, or, with none authored, when the player touches something
  sensitive. A `talk_start` greeting comes before the player says anything, so a
  `clue` tell never fires there, and a `condition` tell fires only if the
  history already meets it.
- **Arrival gets only what an arrival can use.** Each present character comes
  with name, `sex`, appearance, personality, attitude, `always` tells, and a
  `manner` line per unbroken agenda, from its type and target. No clue,
  motive, alibi, action, background, flavour or `condition` tell (each awaits
  the investigator's words). It steers toward people, never things: any could
  be a hiding place. A return gets the last arrival's narration.
  `role-request.ts` derives it from history
  (`tests/api/unit/arrival-prompt.test.ts`).
- **Search never sees a locked clue**, nor a spot whose clues are all locked,
  so no search or arrival weaves in, advertises or narrates "nothing here" for
  either. A targeted search naming that spot (`search-target.ts`) shows it and
  admits its clue (`search.clue_admitted_by_target`): specificity, not
  possession. No search clue carries its `requires`: the engine has decided, and
  a gate's reason reads as "withhold".
- **The judge gets what the investigator earned**: `player_known_clues` (in
  order, each with an `origin_label`) and `path_coverage` (per reasoning path,
  found and missing clue ids). Without them it cannot tell an earned case from
  a lucky one. Both are rebuilt from event history, and `path_coverage` is
  precomputed so the model does not intersect sets across a long context.
- Every character summary carries `sex`, and every prompt tells the model to use
  it for pronouns rather than guess.
<!-- /extract:context-boundaries -->

## Trusting the output

Each role's output contract is a Zod schema in `ai-contracts.ts`, the source of
the parser and of the JSON Schema a provider hands the model
(`roleOutputJsonSchema`). Output is validated before anything is written;
invalid output is a retriable error.

- The parser forgives noise (a missing flag takes its default, junk ids are
  dropped); the JSON Schema asks for the clean shape, every field required.
- The backend re-checks every revealed clue id against what the role was
  allowed to reveal (the active character's clues, the location's unlocked
  clues), and a locked search reveal is rejected and logged
  (`search.clue_locked`).
- When the model reports `input_understood: false` (gibberish), the parser
  forces the reveals, uses and commitments empty, and for a search the turn
  cost to zero, so a confused turn never leaks a clue or costs a turn.
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
not list it again. The ask and search actions both drop an id the session has
already discovered before recording the event or answering, and log it
(`ask.clue_already_discovered`, `search.clue_validation_failed`).

Gates use each clue's optional `requires`:

- **Search — hard.** A bare search reveals the first unrevealed *and* unlocked
  location-level clue, skipping locked ones. The backend rejects a locked
  reveal, except a named hidden spot's clue, declared off-script.
- **Conversation — earned by use.** A gated clue is given once the player uses
  its prerequisites; holding them never grants it. A bluff or deduction that
  uses them earns it off-script unless the gate is physical. Such reveals are
  listed in `revealed_off_script` and recorded as real discoveries.
- **Accusation — judged, not mechanical.** Nothing in the accuse action rejects an
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

## Earned, not free

Every conversational gate (a self-protection part, earned by any of its
`clue_ids`; a reveal's `yields_to_clue_ids`; a `requires` gate; a `clue` tell)
opens only on **use**.

- **Use, defined once** here and in the prompt's "Using a clue": the player
  shows this character the clue, or makes its point at them. Could the
  character react as if just shown it? Saying a word, or holding the clue, is
  not enough; a specific, plausible bluff or deduction stating its substance
  is. "Do you have snowshoes?" does not use the prints; "Why are there
  snowshoe prints by the luggage car?" does.
- **Some things never earn a part:** naming the character as culprit,
  insisting, repeating a demand, asking to look, or a case built only on other
  parts.
- **The character yields in proportion, that turn.** A used part earns its
  `reaction`, conceding what its clues show, even against the alibi; a used
  `requires` gate gives its clue; every part earns the `confession`. The alibi
  comes up only when asked where or when. After questions in three visits
  (`fallback_open`), it may give up a partial truth or gated clue,
  never a confession.
- **Use is recorded.** `talk_conversation` reports the clues used
  (`used_clue_ids`, `used_quote`) and new claims (`new_commitments`). The
  backend keeps a used gate clue the player holds, or bluffs in quoted words,
  and logs the rest (`ask.used_clue_dropped`). `character-state.ts` rebuilds
  from every visit's `ask` events the clues used, parts earned, current story
  (alibi, then earned reactions) and last five commitments. It only grows, and
  reaches the context as `state` (reactions once earned, the confession once all
  are); nothing in the prompt, agendas included, takes one back.
- **An untriggered tell stays hidden, even softened** ("one quick puff" for
  "her tail puffs up").

`gm_roleplay` judges against the same definition of earned.

Case facts and revealed clues reach the browser as structured fields, never
parsed from narration.

## Entering the first location
<!-- extract:game-enter -->

`game-enter` narrates arrival at the starting location once, after the player
confirms the opening: the same `ambience` call a move makes, as a first visit
with no clues held. It is refused unless the session's only event is `start`,
so a double confirmation cannot narrate twice. It costs no turn, and its
`move` event carries `role: "enter"` so a replayed transcript does not invent a
`move to …` line the player never typed.
<!-- /extract:game-enter -->

## The mock provider

The default for `npm run dev` and every automated suite: a live model's paths,
deterministically, at the target reading age. Changing a contract, prompt,
context or provider selection changes the mock and its tests with it.

## Failures, logs and attribution

- Provider calls retry with backoff. A retriable failure, including an output
  that breaks its contract, answers `503` with `details.retriable: true`; the
  web client owns the retry policy.
- A blueprint that cannot be read or parsed is logged (`blueprint.read_failed`,
  `blueprint.parse_failed`) and treated as missing.
- Every AI call logs one JSON line to stdout with the requested and reported
  model; `AI_CALL_LOG` adds full prompts and outputs
  (`docs/ai-configuration.md`).
- Each AI-narrated event stores the model of its own call in
  `game_events.model` (a forced endgame is two calls); the trace pipeline reads
  it, not the session's profile.
