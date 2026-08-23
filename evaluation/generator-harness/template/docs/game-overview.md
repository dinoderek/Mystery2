# Game overview (what your blueprint becomes at play time)

> **CURATED EXTRACT — do not edit casually.**
> Source: `docs/game.md`
> Source git blob hash: `9c93b0f54c533404986f6513d597181462b090da`
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
- `notebook` — opens the case notebook overlay; free, works in every mode
- `accuse <name>` — endgame; iterative judge rounds until win or lose
- when the turn budget hits zero, the game forces accuse mode

## Clue gating (the discovery graph)

Any clue may carry an optional `requires` object (`{ clue_ids, rationale }`): it
cannot be revealed until every prerequisite clue has already been discovered.
This is what turns a flat clue list into a discovery-driven investigation.

- **Search gates are hard.** Bare search reveals the next location-level clue
  that is both unrevealed *and* unlocked, skipping locked ones so the player is
  never dead-ended. Targeted search filters locked clues out of the narrator's
  context entirely, and a backend backstop rejects a locked reveal.
- **Conversation gates are soft.** A gated character clue is normally withheld,
  and the narrator uses the gate's `rationale` to color the deflection. But the
  narrator MAY grant an off-script reveal for a genuinely clever question or a
  convincing bluff — *only* when the rationale implies a social or knowledge gate
  that cleverness could bypass, never a hard physical one. Write each
  `rationale` so it signals which kind it is ("she only opens up once you can
  prove you saw her at the dock" vs. "the safe cannot be opened without the key").
- Off-script reveals are recorded as real discoveries, so a clever player is
  never hard-stuck on the critical path.

Authoring rules the schema and the `clue_graph` eval dimension enforce:

- keep most clues **ungated** — gating should create momentum, never dead-ends
- the graph must be **acyclic**, and a clue may not require itself
- every reasoning path is a small mini-mystery with **at least one ungated entry
  clue**, and every solution-path clue must be reachable from ungated roots

## Where each piece of your blueprint shows up

- `metadata.title`, `metadata.one_liner` → mystery selection screen
- `metadata.target_age` → tone calibration in every AI prompt
- `metadata.time_budget` → initial turn budget
- `metadata.narration_style` (optional) → one sentence of voice/tone direction,
  layered on top of the standard narrator style. It flavors the voice; it cannot
  override the POV or safety rules. Omit to use the standard voice alone.
- `narrative.premise` → opening narration (the hook)
- `narrative.starting_knowledge` → surfaced (not generated) as the player's
  in-game **notebook**: `mystery_summary` plus the per-location and
  per-character `summary` lines are shown verbatim as the case facts, people,
  and places. Write them as clear, player-facing one-liners. The per-character
  `summary` doubles as the character's **public summary** at runtime — it is the
  only authored prose about a character that other characters' scenes can see.
- `world.starting_location_id` → the player's first scene
- `world.locations[].description` → narrator's room-entry text on every visit
- `world.locations[].clues[]` → revealed by **bare** search (at most 1 per
  location)
- `world.locations[].sub_locations[].clues[]` → revealed by **targeted**
  search (at most 1 per sub-location); sub-location names are surfaced when the
  player arrives so they know what's investigable
- `world.characters[].first_name / last_name / sex / appearance`
  → the **public** roster the narrator uses when describing who's present, plus
  that character's `starting_knowledge` summary. `background` is **not** public —
  see "Public vs. private" below.
- `world.characters[].background / personality /
  initial_attitude_towards_investigator`
  → private; shapes how the character roleplays during talk
- `world.characters[].stated_alibi / motive` → the character's own claim plus
  their hidden motive; both surface during talk and contradiction-finding. Both
  are private *data* — "public claim" means what the character says out loud on
  their own turn, not something other scenes can read.
- `world.characters[].clues[]` → shared during talk only on relevant topics
- `world.characters[].flavor_knowledge[]` → shared freely during talk to add
  personality and depth; **this is how the narrator answers "off-script"
  player questions** without breaking grounding
- `world.characters[].actual_actions[]` → hidden timeline of what the character
  really did; keeps character roleplay consistent during talk
- `world.characters[].agendas[]` → shapes whether/when a character lies,
  protects someone, or reveals things conditionally
- `world.characters[].tells[]` → behavioral cues the character leaks, each fired
  by its own `trigger` (`always`, a free-text narrative `condition`, or a `clue`
  the player must raise and be believed about). Tells are *reactions*, not
  defaults — an untriggered tell stays hidden. Defaults to `[]`.
- `ground_truth.{what_happened, why_it_happened, timeline}` → the accusation
  judge sees these; runtime narration outside of judging never does
- `solution_paths`, `red_herrings`, `suspect_elimination_paths` → the
  accusation judge walks these to decide if the player's reasoning was sound.
  They are never shown to the player: naming a clue's path would tell the child
  which of their clues are dead ends.

## Public vs. private

The runtime enforces a hard split, and authoring against the wrong side of it
is the most common way to waste effort:

- **Public** — identity (`first_name`, `last_name`), `sex`, visible
  `appearance`, and the character's `starting_knowledge` summary. This is all
  that arrival narration and the accusation-start roster ever see.
- **Private** — `background`, `personality`, `stated_alibi`, `motive`, `clues`,
  `agendas`, `tells`, `actual_actions`, `flavor_knowledge`. These reach the
  narrator **only** on the character's own talk turn.

Knowledge about *other* characters travels exclusively through explicit clues
carrying `about_character_id`. If you want the player to be able to learn
something about character B, author it as a clue on character A — writing it
into B's `background` puts it somewhere nothing but B's own scene can reach.

## The notebook

Discovered clues are recorded permanently and shown in the case notebook,
grouped by where the investigator found them ("Found at the Boathouse", "Told by
Maya"). Grouping is deliberately something the player already knows — the
notebook never reveals which reasoning path a clue serves.

This does not make orphan clues harmless. A clue belonging to no authored path
can never contribute to a win, because the judge credits an evidence chain only
against `solution_paths`; the mechanical check rejects orphan clues for that
reason.

## Winning and losing

The accusation judge accepts (`win`) only when the player names the true culprit
**and** either backs it with a discovered clue chain matching a `solution_paths`
entry, or correctly tells the story of what happened (culprit + key sequence +
motive). Confronting the accused can earn a confession, but only once most of
the facts are already right.

Wrong or under-supported accusations return `continue` with encouragement to
keep investigating; from round 3 onward a still-failing accusation resolves as a
loss with a gentle reveal. This is why `solution_paths` and
`suspect_elimination_paths` have to be genuinely walkable from clues the player
can actually discover — they are the judge's accept criteria, not decoration.

The judge is handed the player's actual discovered clues and, per path, which of
its clues they hold and which they are missing — so "discovered clue chain" is
checked, not assumed. A `solution_paths` entry whose clues are hard or
impossible to reach will visibly fail to earn wins.

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
