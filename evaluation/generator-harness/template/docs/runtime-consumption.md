# Runtime consumption (how the narrator AI uses your blueprint)

> **CURATED EXTRACT — do not edit casually.**
> Sources: `docs/ai-runtime.md`, `docs/blueprint-generation-flows.md`
> Source git blob hashes:
> - `docs/ai-runtime.md` — `33dd84c65199810d351fa4466302f2e996fd6e03`
> - `docs/blueprint-generation-flows.md` — `b92ce9cd79d51725342a19daf0d988685aea040b`
> Verifier: `node evaluation/generator-harness/scripts/check-curated-docs.mjs`
> If sources change in ways that affect blueprint authoring, regenerate this file.

This is what your blueprint is *actually used for* by the runtime AI. Each
narrator role only gets a slice of the blueprint — never the whole thing,
except the accusation judge.

## Roles and what they see

| Role | What it does | Blueprint slice it receives |
|---|---|---|
| `game-start` | opening narration | `metadata.target_age`, `narrative.premise`. `narrative.starting_knowledge` is appended verbatim (not generated). |
| `game-move` | arrival narration | destination's `location.{name, description, sub_locations[].name}` (sub-location names surface so player knows what to search), plus public summaries of characters currently at that location (`first_name`, `last_name`, `sex`, `appearance`, `background`). Plus prior history at that location. |
| `game-search` (bare) | reveals next location-level clue | current location, its `clues[]` in order, sub-location names + hints (narrator-only) + unrevealed clues; AI picks the next clue. |
| `game-search` (targeted) | judges player's freeform search text | same as bare plus the player's `search_query`; AI matches it against a sub-location and may reveal that sub-location's clue. The narrator can waive turn cost for nonsense attempts. |
| `talk_start` / `talk_conversation` / `talk_end` | character dialogue | location context plus the *active character's* private roleplay block: `clues`, `flavor_knowledge`, `actual_actions`, `agendas`, `stated_alibi`, `motive`, `personality`, `initial_attitude_towards_investigator`. Plus same-character history. |
| `accusation_start` | scene-setting for accusation | spoiler-safe context only (no ground truth, no solution paths). |
| `accusation_judge` | adjudicates player reasoning | **the full blueprint**, including `ground_truth`, `solution_paths`, `red_herrings`, `suspect_elimination_paths`. |

## Why each authoring decision matters at runtime

### `flavor_knowledge` is non-negotiable

Players ask about things outside the mystery — "do you like your job?", "what
did you have for breakfast?", "what's the deal with that broken sign on the
door?". The narrator AI fills these answers from `flavor_knowledge`. If a
character's `flavor_knowledge` is thin or doesn't cover the topics the
investigator would naturally probe, the narrator either:
- refuses to answer (kills immersion), or
- invents (kills coherence and consistency).

Cover the likely probe topics for each character. The `character_grounding`
eval dimension scores exactly this.

### `actual_actions` keeps characters consistent

During talk, the narrator AI uses `actual_actions` as the hidden timeline of
what the character actually did, in sequence. This is what stops a character
from saying contradictory things across questions in the same session. If
`actual_actions` is sparse or vague, the narrator improvises and drifts.

Use enough entries to cover the relevant time window, ordered by `sequence`.

### `agendas` create conversational friction

A blueprint with no agendas plays as if every character helpfully volunteers
everything they know. The agendas (`self_protect`, `protect_other`,
`implicate_other`, `conditional_reveal`) tell the narrator how to filter the
character's responses — they're what makes the mystery feel like a mystery
during talk. Agenda types are constrained by the schema; do not invent new
ones.

### Clue roles matter

Clue `role` (`direct_evidence`, `supporting_evidence`, `suspect_elimination`,
`red_herring`, `red_herring_elimination`, `corroboration`, `alibi_knowledge`,
`location_hint`, `witness_testimony`, `motive_knowledge`) tells the narrator
how to weight the clue's tone and lets the accusation judge classify
reasoning chains. Invented role names will fail schema validation.

### Cross-character clue metadata

- `alibi_knowledge`, `witness_testimony`, `motive_knowledge` clues should
  reference `about_character_id`.
- `location_hint` clues should reference `hint_location_id`.

These create the cross-character connections that make a mystery feel
investigable rather than parallel.

### Sub-locations need real, child-friendly names

Sub-location names are shown to the player on arrival ("the rolltop desk",
"under the workbench", "behind the pickle barrels"). Avoid abstract names
("Area A"). The targeted-search AI matches player descriptions against these
names with GM leeway, so concrete/spatial names work best.

Each sub-location has a narrator-only `hint` (never shown to the player) that
helps the narrator steer the player back if they're looking in the wrong
place.

### `sex` is used for pronouns

Every character has `sex`. The narrator uses it instead of guessing. Missing
or null `sex` causes pronoun drift in talk and move narration.

## Generation contract reminders

- `id` is a top-level UUID (the blueprint's stable identifier).
- `metadata.image_id`, `world.locations[].location_image_id`,
  `world.characters[].portrait_image_id` are added by image tooling later — do
  not output them.
- `metadata.art_style` is the legacy single-string visual direction.
  `metadata.visual_direction` is the structured replacement. Prefer
  `visual_direction`; if you omit `art_style`, omit it entirely (do not set
  it to `null`).
- The accusation judge gets the full blueprint, so `ground_truth`,
  `solution_paths`, `red_herrings`, and `suspect_elimination_paths` are real
  consumers of your authoring effort — not metadata.
