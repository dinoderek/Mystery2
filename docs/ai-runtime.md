# AI Runtime

Narrator contracts and validation before saving. The case format is the
[clue graph](clue-graph.md), whose talk, search and accusation rules are its
own. Profiles and providers are `docs/ai-configuration.md`; which case fields
reach which output is `docs/blueprint-generation-flows.md`.

## How a request is assembled

Pure `packages/game-engine/src/role-request.ts` builds each role's authorised
context (`ai-context.ts`) and renders its prompt (`ai-prompts.ts`) at the
game's `target_age`; it imports no database, so the eval harness calls it too
(`tests/api/unit/role-request.test.ts`). `buildRoleMessages` and
`buildNarrationMessages` construct the system/user pair for live OpenRouter,
live Claude CLI and replay, including plain `intro` and `ambience`. Provider
schemas and calls, including both accusation stages, remain distinct from
messages. The system message sets the output format. The user message
carries the role prompt, its grounding rules and any structured context.
Tests compare live and replay messages byte for byte
(`tests/api/unit/narrator-messages.test.ts`).

Voice and reading level are shared. Recorded state replaces refereeing: the
engine derives what a turn can bring out from the graph and the events.

## Roles

The roles and their output contracts are `ai-contracts.ts`. `graph_talk` plays
a greeting and every line of a conversation, and `graph_search` a search; both
return notebook lines. `graph_search` states both word budgets unless the
engine already knows the outcome (`OUTCOME_LENGTH_BY_ROLE` in
`ai-prompts.ts`). `graph_accusation` reports who was named and what was cited;
`graph_accusation_round` words the engine's flaw, alternative or missing-fact
reply, from only its supplied material, and `graph_ending` the closing scene
([accusation](clue-graph.md#accusation)). `accusation_start` opens the scene,
and `talk_end` closes a conversation. `talk_end` moves nobody; `gm_fabrication`
reports invented movement.

## Narration style

`buildStyleGuidance` gives the narrator a warm, cozy voice in second person
and present tense. Characters speak in first person with brief action beats.
The narrator alone speaks after a failed accusation or at the ending, which may
quote a character. A scene may add harmless scenery and manner within its
role's limits ([the narrator's judgement](clue-graph.md#the-narrators-judgement)).
The reading level always wins.

## What each role sees

Which case fields reach which role is the "Narration at play" table in
`docs/blueprint-generation-flows.md`. The rules and reasons behind it:

- Talk and search contexts come from the graph and the events
  (`clue-graph/narrator-context.ts`): what a character may say now, and what a
  search can find. What a character knows reaches another only through the
  graph.
- Only the closing scene is told the truth; `assertRoleContextSafety` enforces
  that for every other role.
- **A farewell sees only found clues**, as their saved notebook lines, and the
  roster sees identity and looks.
- **Arrival gets only what an arrival can use.** Each present character comes
  with name, `sex`, appearance, personality and attitude; nothing they know or
  hold. A return gets the last arrival's narration. `role-request.ts` derives
  it from history (`tests/api/unit/arrival-prompt.test.ts`).
- **A hidden spot is never shown** to a search or an arrival until its pointer
  is held; before then, words that fit it best find nothing. The engine
  decides which spot the words name (`search-target.ts`), since the narrator
  never hears of a hidden one.
- Character summaries carry `sex` for the shared pronoun rule.

## Trusting the output

`ai-contracts.ts` supplies each role's parser and provider JSON Schema
(`roleOutputJsonSchema`). Validation precedes writes;
invalid output is retriable. Replay dispatches the same parser by requested
role, never by answer shape; parser acceptance does not imply engine admissibility.

- The parser forgives noise (missing flags default, junk ids drop, doubled
  quote escapes go); the JSON Schema asks for the clean shape, all fields
  required.
- The backend re-checks every reported clue against what the state offered
  (`turn/resolve-clue-graph.ts`): a report not offered, or notebook lines that
  are not exactly the clues that came out, fail the turn before anything is
  saved.
- When the model reports `input_understood: false` (gibberish), the parser
  empties what the turn earned, and a search costs no turn.
- Rules that span fields are the parser's, never asked of the model.

## Clue discovery

Discovery is event-sourced: a clue is discovered once a `search`, `ask` or
`talk` event records its id. `packages/game-engine/src/clue-discovery.ts` is
the only place that knows how a reveal is recorded.
`game_sessions.discovered_clues` is a cache; `game-get` rebuilds the notebook
from history.

A clue is discovered once. A character may restate a clue the player already
holds, but it is not recorded again: the restated report is dropped and logged
(`ask.clue_already_discovered`, `notebook.line_for_held_clue`). The notebook's
records (`DiscoveredClueRecord`: `origin`, `source`, `discovered_at`) are
grouped by origin in the client.

## Earned, not free

A gate opens only on what the investigator does (`docs/clue-graph.md`):
showing the character its clues, or making their point at them, in this line
or an earlier one of the conversation; taking the line of questioning it
names; or asking plainly, where it allows that. Holding a clue is not using it.
A bluffable gate also opens on a believable bluff claiming what a clue proves;
a physical one never does. A clue shown and dodged opens on a follow-up. The
character's mood never decides what opens, and the engine accepts a gate
opened only when the state offered it.

The turn judges' preamble states this rule from the case's gates, and
`gm_roleplay`, `gm_clue_discipline` and `gm_broad` judge by it from the
player's words, never from a reported use
([`evaluation/judges/README.md`](../evaluation/judges/README.md)).

Case facts and revealed clues reach the browser as structured fields, never
parsed from narration.

## Entering the first location

`game-enter` narrates arrival at the starting location once, after the player
confirms the opening: the same `ambience` call a move makes, as a first visit
with no clues held. It is refused unless the session's only event is `start`,
so a double confirmation cannot narrate twice. It costs no turn, and its
`move` event carries `role: "enter"` so a replayed transcript does not invent a
`move to …` line the player never typed.

## The mock provider

The deterministic default for `npm run dev` and automated suites. It reads
the opening and arrival fact lists and voices those facts and visible names.
Contract, prompt, context and provider changes update its tests.

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
