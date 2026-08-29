# Runtime consumption (how the narrator AI uses your blueprint)

> **CURATED EXTRACT — do not edit casually.**
> Sources: `docs/ai-runtime.md`, `docs/blueprint-generation-flows.md`
> Source git blob hashes:
> - `docs/ai-runtime.md` — `fe85d986e4bc07f7b091d1497aceb5cfc88d04db`
> - `docs/blueprint-generation-flows.md` — `36fb82b3b3e577c0f7c47380b396e286f8048a19`
> Verifier: `node evaluation/generator-harness/scripts/check-curated-docs.mjs`
> If sources change in ways that affect blueprint authoring, regenerate this file.

This is what your blueprint is *actually used for* by the runtime AI. Each
narrator role only gets a slice of the blueprint — never the whole thing,
except the accusation judge.

## Roles and what they see

| Role | What it does | Blueprint slice it receives |
|---|---|---|
| `game-start` | opening narration | `metadata.target_age`, `narrative.premise`. `narrative.starting_knowledge` is not used for narration — it is surfaced verbatim (not generated) as the player's in-game notebook (case facts, people, places). |
| `game-enter` | arrival at the **starting** location, once, after the player confirms the opening | same slice as `game-move` for `world.starting_location_id`, with no prior history. Your starting location's `description`, sub-locations, and characters are therefore read out at the very start of play, not first seen on a return visit. |
| `game-move` | arrival narration | destination's `location.{name, description, sub_locations[].name}` (sub-location names surface so player knows what to search), plus **public-only** summaries of characters currently at that location (`first_name`, `last_name`, `sex`, `appearance`, `public_summary`). Plus prior history at that location. |
| `game-search` (bare) | reveals next location-level clue | current location, its `clues[]` in order, sub-location names + hints (narrator-only) + unrevealed clues; AI picks the next clue. Locked clues are filtered out. |
| `game-search` (targeted) | judges player's freeform search text | same as bare plus the player's `search_query`; AI matches it against a sub-location and may reveal that sub-location's clue. The narrator can waive turn cost for nonsense attempts. |
| `talk_start` / `talk_conversation` / `talk_end` | character dialogue | location context, public-only summaries of the other characters, plus the *active character's* private roleplay block: `clues` (each with `requires_rationale` + `prereqs_met`), `flavor_knowledge`, `actual_actions`, `agendas`, `tells`, `stated_alibi`, `motive`, `personality`, `initial_attitude_towards_investigator`, and `player_known_clues`. Plus same-character history. |
| `accusation_start` | scene-setting for accusation | spoiler-safe context only (no ground truth, no solution paths), plus the public character roster (`first_name`, `last_name`, `sex`, `appearance`, `public_summary`) so suspects can be named with grounded pronouns. |
| `accusation_judge` | adjudicates player reasoning | **the full blueprint**, including `ground_truth`, `solution_paths`, `red_herrings`, `suspect_elimination_paths` — plus `player_known_clues` (what the investigator actually discovered) and `path_coverage` (per path: `found_clue_ids` / `missing_clue_ids`), so it credits an evidence chain only from clues the player really holds. |

## The public/private boundary

`public_summary` is the character's `summary` from
`narrative.starting_knowledge` — it is `null` when unauthored. Along with
identity, `sex`, and visible `appearance`, it is the *entire* public surface of
a character.

Everything else you author on a character — `background`, `personality`,
`stated_alibi`, `motive`, `clues`, `agendas`, `tells`, `actual_actions`,
`flavor_knowledge` — reaches the narrator **only** on that character's own talk
turn. Notably `background` is private: arrival narration and the
accusation-start roster never see it.

Knowledge about other characters therefore travels **exclusively via explicit
clues** with `about_character_id`. Authoring "Maya suspects the harbormaster"
into Maya's `background` makes it reachable only when the player is already
talking to Maya; authoring it as a clue on Maya *about* the harbormaster is what
makes it investigable.

## Narration style

Every runtime prompt carries a style slot the runtime always fills:

- The **standard narrator style** — second person, present tense; warm, cozy,
  never scary; concrete sensory detail; first-person character dialogue with
  action beats; no meta-commentary — applies to every role.
- `metadata.narration_style` (optional, one sentence) is layered *on top* of it.
  It can flavor the voice; it cannot override the POV or safety rules. Write it
  as voice/tone direction ("salty harbor air, gull cries, a gentle pirate lilt"),
  not as plot instruction. Omit the field entirely to use the standard voice.
- The style is **subordinate to the reading level**. It may direct tone, mood,
  and imagery only — never archaic, ornate, technical, or heavily figurative
  diction. The runtime applies it on top of the target age's reading level and
  is told that where the two pull apart, the reading level wins, so a voice the
  age band cannot carry is either ignored or pushes the narration above the
  reading level. Omit the field rather than write one that fights the age.

## Clue gating at runtime

Each clue's optional `requires` (`{ clue_ids, rationale }`) is consumed
differently by search and by talk, and the difference should shape how you write
each `rationale`:

- **Search — hard gate.** Bare search reveals the first clue that is both
  unrevealed and unlocked, skipping locked ones so the player is never
  dead-ended. Targeted search filters locked clues out of the narrator's context
  entirely, and a backend backstop rejects a locked reveal.
- **Talk — soft gate with a brilliance override.** Each character clue reaches
  the narrator with its `requires_rationale` and a precomputed `prereqs_met`
  flag (prerequisite clue *ids* are deliberately not sent). The narrator
  normally withholds a clue when `prereqs_met` is false and uses the rationale to
  color the deflection — but it MAY grant an off-script reveal for a clever
  question or convincing bluff **when the rationale implies a social or knowledge
  gate that cleverness could bypass**. Off-script reveals are recorded as real
  discoveries.

So the rationale is doing double duty: flavor for the deflection, and the signal
the narrator uses to decide whether cleverness may substitute. Make the
distinction explicit — "she only opens up once you can prove you saw her at the
dock" (bypassable) vs. "the safe physically cannot be opened without the key"
(not bypassable).

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

### `tells` are reactions, not ambience

`tells` is a first-class array on the character, separate from `agendas`. Each
tell pairs a visible cue (`text`, e.g. "glances at the back door", "voice
tightens") with a `trigger` that decides when it surfaces:

- `always` — ambient, always present
- `condition` — a free-text narrative condition the narrator judges (e.g. "the
  investigator brings up the missing key")
- `clue` — fires only when the player raises the referenced `clue_ids` *and* the
  character believes them, meaning the player actually holds the clue or bluffs
  convincingly

The `talk_conversation` prompt treats tells as reactions: a cue surfaces only
when its trigger fires. A character with no authored tells simply reacts to what
the player says. Author tells that are specific and earned — a well-triggered
tell is the player's reward for pressing the right thread.

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
- `metadata.visual_direction.portrait_background` is optional and steers only
  the backdrop behind character portraits. Keep it abstract — colour, light,
  blur. It must never depict or reference any location from the mystery;
  portraits are deliberately location-agnostic. Omit it entirely (do not set
  it to `null`) to fall back to the default bokeh wash.
- `metadata.narration_style` is optional. Omit it entirely if you have no
  voice direction to give — do not set it to `null`.
- `narrative.starting_knowledge` needs an entry for **every** location and
  character; the schema rejects missing or duplicated ids. The character entries
  are also what become `public_summary` at runtime, so a thin summary here means
  a thin arrival scene.
- The accusation judge gets the full blueprint, so `ground_truth`,
  `solution_paths`, `red_herrings`, and `suspect_elimination_paths` are real
  consumers of your authoring effort — not metadata. They stay judge-side only:
  the player's notebook groups clues by where they were found and never names
  the path a clue serves.
