# Game overview (what your blueprint becomes at play time)

> **CURATED EXTRACT — do not edit casually.**
> Source: `docs/game.md`
> Source git blob hash: `c49ff0b6490433959e8e3823d0f92b050b9302c9`
> Verifier: `node evaluation/generator-harness/scripts/check-curated-docs.mjs`
> If the source changes in ways that affect blueprint authoring, regenerate this file.

This summarizes how a Blueprint V2 file becomes a playable mystery. Read it
before drafting — it explains why the schema looks the way it does.

## The game in 30 seconds

A text-based mystery adventure for kids. The investigator (the player) explores
a small world, talks to characters, searches locations for clues, and accuses
a suspect before the turn budget runs out. An AI narrator runs the world.

## The player loop (per turn)

- `move to <location>` — narrator describes arrival; costs 1 turn
- `talk to <character>` — enters talk mode (free); each follow-up question
  costs 1 turn; ends free
- `search` (bare) — reveals the next location-level clue in sequence; 1 turn
- `search <free text>` (targeted) — player describes where/what to look at; AI
  judges whether it matches a sub-location and reveals that sub-location's clue
  if so; 1 turn (waivable for nonsensical attempts)
- `accuse <name>` — endgame; iterative judge rounds until win or lose
- when the turn budget hits zero, the game forces accuse mode

## Where each piece of your blueprint shows up

- `metadata.title`, `metadata.one_liner` → mystery selection screen
- `metadata.target_age` → tone calibration in every AI prompt
- `metadata.time_budget` → initial turn budget
- `narrative.premise` → opening narration (the hook)
- `narrative.starting_knowledge` → surfaced (not generated) as the player's
  in-game **notebook**: `mystery_summary` plus the per-location and
  per-character `summary` lines are shown verbatim as the case facts, people,
  and places. Write them as clear, player-facing one-liners.
- `world.starting_location_id` → the player's first scene
- `world.locations[].description` → narrator's room-entry text on every visit
- `world.locations[].clues[]` → revealed by **bare** search (at most 1 per
  location)
- `world.locations[].sub_locations[].clues[]` → revealed by **targeted**
  search (at most 1 per sub-location); sub-location names are surfaced when the
  player arrives so they know what's investigable
- `world.characters[].first_name / last_name / sex / appearance / background`
  → public summary the narrator uses when describing who's present
- `world.characters[].personality / initial_attitude_towards_investigator`
  → private; shapes how the character roleplays during talk
- `world.characters[].stated_alibi / motive` → public claim plus hidden motive;
  surface during talk and contradiction-finding
- `world.characters[].clues[]` → shared during talk only on relevant topics
- `world.characters[].flavor_knowledge[]` → shared freely during talk to add
  personality and depth; **this is how the narrator answers "off-script"
  player questions** without breaking grounding
- `world.characters[].actual_actions[]` → hidden timeline of what the character
  really did; keeps character roleplay consistent during talk
- `world.characters[].agendas[]` → shapes whether/when a character lies,
  protects someone, or reveals things conditionally
- `ground_truth.{what_happened, why_it_happened, timeline}` → the accusation
  judge sees these; runtime narration outside of judging never does
- `solution_paths`, `red_herrings`, `suspect_elimination_paths` → the
  accusation judge walks these to decide if the player's reasoning was sound

## Things that matter for authoring

- **Sub-locations are described to the player on arrival** — they need to be
  things a child could plausibly search ("under the desk", "behind the
  curtains") not abstract zones.
- **Each location has at most 1 top-level clue and each sub-location at most 1
  clue.** Not every sub-location needs a clue — some are atmospheric.
- **Flavor knowledge is the runtime narrator's safety net.** When a player
  asks something not covered by mystery clues, the narrator falls back on
  `flavor_knowledge`. Thin flavor means the narrator either invents (bad) or
  refuses (worse). This is what the `character_grounding` eval dimension
  measures.
- **`actual_actions` is what keeps characters consistent.** During talk, the
  narrator uses this hidden timeline to make sure the character's story
  doesn't drift across questions in the same session.
- **`sex` is required.** The narrator uses it to pick pronouns without
  guessing.
- **`id` (top-level) is a UUID.** It's used as the blueprint's stable
  identifier across sessions and image assets.
