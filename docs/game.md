# Mystery Game: High-Level Concepts

## Purpose

A text-based mystery adventure for kids that makes reading and writing feel like a fun challenge: explore, ask questions, find clues, and make a final accusation before time runs out.

---

## Core Roles and Entities

### Investigator (the player)

- The child playing the game.
- Types commands (talk, move, search, accuse…).
- Builds a theory from clues and conversations.

### Narrator (the game master)

- Describes scenes, locations, and outcomes.
- Impersonates characters during conversations.
- Adjudicates searches and the final accusation.
- Must remain coherent and consistent with the blueprint.
- **Implementation:** AI-driven.

### Mystery Blueprint (story scaffolding)

- Defines the structure and ground truth of the mystery (what happened, who did what, why).
- **Note:** The comprehensive schema for Blueprints is defined entirely in the Zod definitions at `packages/shared/src/blueprint-schema-v2.ts`. The schema's `.describe()` fields serve as the core narrative intent instructions for AI generators and the Narrator.

### Time / Turns

- A limited budget of actions.
- Creates tension and prevents endless exploration.
- When time runs out, the game forces the endgame (accusation).

### Final Accusation

- Classic whodunnit resolution: the investigator accuses a suspect and explains reasoning.
- Narrator adjudicates and explains the true solution.
- The explanation must be logically consistent with clues, timeline, and alibis.
- An accusation is accepted when the investigator names the true culprit AND
  either backs it with a discovered clue chain (a solution path) or correctly
  tells the story of what happened. Confronting the accused can earn a
  confession — but only when most of the facts are already right.
- "Discovered" is enforceable: the judge is given the investigator's actual
  discovered clues and, per reasoning path, which of its clues they hold and
  which they are missing. The clue-chain route only credits clues they really
  found; telling the true account and earning a confession do not require them,
  so a child who reasons their way to the answer is never blocked.
- Wrong or under-supported accusations are rejected with encouragement to keep
  investigating and try again; after repeated failed attempts (round 3+) the
  case resolves as a loss with a gentle reveal.

---

## Game Flow

## 1) Start

1. User selects a blueprint.
2. User starts a new game.

### Game Start Sequence

- Display premise (short hook).
- Display a short guidance line pointing the investigator to the **notebook**
  (the case facts, people, places, and clues now live there, not in a wall of
  opening text).
- Execute initial “move” to the starting location (arrive + description).
- Show initial status (time, location, visible characters).

---

## 2) Main Game Loop

The investigator repeatedly chooses actions until:

- they **accuse**, or
- **time runs out** → forced transition to accusation.

### Available Actions (top-level)

- **Talk** (interrogate / question)
- **Move** (go to a location)
- **Search** (look for clues)
- **Accuse** (endgame)
- **Notebook** (review the case — `Tab`, or `notebook` / `n`)
- **Help**
- **Quit**

### Time Costs

- `move`, `search`, and in-conversation `ask` each consume 1 turn.
- `talk`, `end_talk`, and entering accusation mode consume 0 turns.

When time is exhausted:

- The final time-consuming action still resolves first.
- After that action is persisted and shown, the game appends forced accusation framing and switches to accuse mode.

---

## Action Details

## Talk

**Command:** `talk to <character>`

### Enter Talk Mode

- Narrator introduces / refreshes the character (short description).
- Investigator can ask free-form questions.
- Character responses are constrained by:
  - what the character “knows”
  - what they are willing to share (disposition)
  - what they were doing at the time (alibi/timeline)
  - any deception/red herrings defined by the blueprint

### Talk Mode Loop

- Stays in talk mode until an explicit end command.
- Investigator asks questions (typed input).
- Narrator responds _as that character_, consistent with blueprint.
- Character should remember prior interactions in the same game (continuity).
- Backend accepts free-form question payloads (`player_input`).

**Exit Talk Mode**

- Example: `end` or `exit` (exact keyword TBD, but should be consistent and discoverable).

**Time model**

- Entering talk mode is free.
- Each follow-up question in talk mode consumes 1 turn.
- Ending talk mode is free.

**Clue gating in conversation (soft, with a brilliance override)**

- A character clue gated by `requires` is normally withheld until the player has
  discovered its prerequisites; the narrator uses the gate's `rationale` to color
  the deflection.
- The narrator MAY grant an off-script reveal for a genuinely clever question or
  convincing bluff — but only when the rationale implies a social/knowledge gate
  cleverness could bypass, never a hard physical gate. Off-script reveals are
  recorded as real discoveries (flagged in the notebook), so a clever player is
  never hard-stuck on the critical path. This is separate from, and composes with,
  character agendas (willingness) and tells.

---

## Search

**Command:** `search` (bare search) or `search <freeform text>` (targeted search)

### Search Modes

Search operates in two modes based on whether the player provides a description:

**Bare search** (`search`):
- Reveals the next location-level clue in sequential order (from `location.clues[]`).
- Narration includes hints about sub-locations that still have undiscovered clues.
- Always costs 1 turn.

**Targeted search** (`search <freeform text>`):
- The player describes what/where/how they want to search (e.g., `search under the desk`, `inspect the pantry shelf`).
- The AI acts as a Game Master, judging whether the description matches a sub-location and its unrevealed clues.
- The AI has GM leeway: creative or inventive descriptions can match even if the wording doesn't exactly match the sub-location name.
- If a match is found, the clue is revealed. If not, the narrator provides hints toward promising sub-locations.
- Costs 1 turn when a clue is found, or when the AI judges the search was a reasonable attempt. The AI can waive the turn cost for completely off-mark or nonsensical searches to avoid punishing children for exploring.

### Sub-Locations

Each location in the blueprint defines 2-4 searchable sub-locations (e.g., “behind the curtains”, “inside the desk drawer”, “under the workbench”). Sub-locations are prominently described when the player arrives at a location, so the player knows what areas they can investigate.

Each sub-location has:
- A name the player can reference in search commands.
- A narrator-only hint that helps the AI craft steering narration (never shown directly to the player).
- At most one clue.

Not every sub-location has a clue — some are atmospheric dead ends that add flavor and misdirection.

### Clue Distribution

- At most 1 clue per location's top-level `clues[]` array (revealed by bare search).
- At most 1 clue per sub-location (revealed by targeted search).
- Clues are distributed across locations and sub-locations to encourage broad exploration.

### Clue Gating (discovery graph)

Clues can be gated behind discovering other clues. Each clue may carry an optional
`requires` object (`{ clue_ids, rationale }`); it cannot be revealed until every
prerequisite clue has been discovered. This makes the game clue-rich and
discovery-driven (see `docs/blueprint-generation-flows.md`).

- **Search gates are hard.** Bare search reveals the next location-level clue that
  is both unrevealed and unlocked, skipping locked ones so the player is never
  dead-ended. Targeted search will not reveal a clue whose prerequisites are unmet
  — locked clues are filtered out of the narrator's context and a backend backstop
  rejects any locked reveal.
- Discovered clues are recorded permanently (see **Notebook**).

### Repeated Searches

- Bare search reveals location-level clues in order until exhausted.
- Targeted searches do not reveal already-discovered clues.
- After all clues are found, searches still produce flavorful narration but reveal nothing new.

---

## Move

**Command:** `move to <location>` or `go <location>`

### Move Behavior

- Narrator describes arrival and the location.
- Shows who is present (characters visible there).
- Location description should be consistent and re-usable:
  - Recommended: blueprint provides a base description; narrator adds light variation.
- Revisits should acknowledge that the investigator has returned without contradicting prior location descriptions.

**Interaction with search**

- Location has a general description (move)
- Search focuses on discoverable details (search)
- Keep these separate to preserve the loop: move ≠ search.

---

## Notebook

**Open and close:** `Tab` at any time. The typed commands `notebook` and `n`
still work, and `Esc` also closes.

### Notebook Behavior

- Opens the **case notebook**, a full-screen overlay the investigator can
  consult at any time (works in every mode and costs 0 turns, and leaves no
  entry in the transcript).
- One section is shown at a time, behind a tab strip:
  `STORY · PLACES · PEOPLE · CLUES`.
  - **Story** — the premise hook and a one-line summary of what happened and
    roughly when (the "what / where / when").
  - **Places** — every location with its description, a `[ you are here ]`
    marker on the current one, and who is standing at each.
  - **People** — everyone met so far, each with a description and where they
    are (`Here with you` when they share the investigator's location).
  - **Clues** — the clues discovered so far (from searching and asking),
    accumulating live, in two buckets: `FOUND AT PLACES` and `TOLD BY PEOPLE`.
    Each bucket sub-groups by the location or character with a count, e.g.
    `Kitchen (2)`.
- **Navigation:** `←` / `→` move between sections and wrap around, `↑` / `↓`
  scroll the current section, `1`–`4` jump straight to a section.
- **Deep links:** `locations` / `where can i go` open the notebook at Places,
  and `characters` / `who is here` open it at People. They no longer print
  inline lists — the notebook holds the same facts and more.
- The notebook reopens at whichever section the player last used; the deep-link
  commands and the clue-discovered toast override that with a specific section.
- The case facts, people, and places come from the blueprint's
  `narrative.starting_knowledge`; clues are the player's discovered set. The
  notebook replaces the old wall-of-text opening — the game start now points the
  investigator here instead.

---

## Quit

**Command:** `quit` or `exit`

### Quit Behavior

- Ends the current play session immediately.
- Replaces the command input with a terminal prompt: `Tab: review notebook · any other key: back to the mystery list`.
- `Tab` still opens the notebook, so a finished case can be reviewed; while the
  notebook is open no key leaves the session. Any other key returns the player
  to the landing menu (`/`).

---

## Accuse (Endgame)

**Command:** `accuse [statement]`

### Endgame Flow

- Narrator generates a “showdown” scene description.
- Investigator states:
  - who did it
  - why / reasoning
  - key supporting clues
- Accusation now runs as a reasoning-first backend flow:
  - `accuse_start`: optional framing narration when the player enters accuse mode without initial reasoning
  - `accuse_judge` rounds: iterative reasoning with `continue|win|lose` adjudication from the judge output
- If time runs out during explore/talk/search/move/ask, the game forces accuse mode with urgent accusation-start narration and then continues with normal accuse rounds.
- Narrator may ask follow-up questions if reasoning is incomplete.
- Narrator reveals outcome:
  - If correct: explanation + how clues connect + timeline
  - If incorrect: explanation + correct culprit + where reasoning diverged
- After accusation resolves (`win` or `lose`), gameplay input ends for that session and the UI shows an end-state terminal prompt:
  - explicit success/failure status
  - `Tab: review notebook · any other key: back to the mystery list`

**Hard requirement:** The explanation must make sense and align with:

- timeline
- alibis
- clue placement
- motives

Implementation detail reference: `docs/accusation-flow.md`.

---

## Blueprint Schema Reference

See `packages/shared/src/blueprint-schema-v2.ts` for the exact technical schema and narrative instructions encoded in the `.describe()` fields. Blueprint metadata controls the title, difficulty, and time budget. The world model defines characters and locations. The ground truth determines what actually happened and provides the absolute facts the Narrator must adhere to.

For the current implementation map of which blueprint fields actually flow into
generated images and narration, see `docs/blueprint-generation-flows.md`.

---

## Notebook

A persistent, celebrated record of every clue the investigator discovers.

- Discovered clues are recorded forever and surfaced via `game-get`
  (`state.discovered_clues`), each annotated with where/when it was found and
  whether it was an off-script grant.
- The notebook panel groups clues by **origin** — first into the buckets
  `FOUND AT PLACES` and `TOLD BY PEOPLE`, then per location or character with a
  count. Grouping must stay something the player could work out themselves. An earlier version grouped by mini-mystery
  thread, which printed headings like "Main solution" and
  "Red herring: <payoff>" and so told the child which of their own clues were
  dead ends. Reasoning-path membership is therefore no longer sent to the client
  at all (see `docs/ai-runtime.md`).
- A "new clue discovered" celebration fires when a search/ask turn surfaces a
  clue.
- Grouping is driven by the clue list itself rather than by `state.locations` /
  `state.characters`, so a clue whose origin entity is unknown still appears
  under its recorded name and a place with no clues renders no empty heading.
- Implemented via `NotebookPanel.svelte`, `ClueDiscoveredToast.svelte`, and a
  count/toggle in `StatusBar`. The pure derivation and grouping helpers live in
  `web/src/lib/domain/notebook.ts` (unit-tested in `notebook.test.ts`). See
  `docs/component-inventory.md`.

## UX / UI Concept

### Overall Feel

- Text-first, terminal-like.
- All choices via typed commands (no buttons required initially).
- Keyboard-friendly.
- Inline help and discoverability are critical.

### Navigation

- Arrow key navigation. In the notebook, `←` / `→` change section and `↑` / `↓`
  scroll; `1`–`4` jump to a section and `Tab` toggles the notebook itself.
- Narration is scrollable and auto-scrolls to bottom by default.

---

## Screens

## Start Page

Modes:

1. **Start a new game**
2. **View in-progress games**
3. **View completed games**

### New Game

- List blueprints.
- If a blueprint has `blueprint_image_id`, render the cover image from `/api/images/<blueprint>/<image>`.
- If image fetch fails or expires without refresh, show a placeholder panel (gameplay still continues).
- Start by typing a number (e.g., `1`, `2`, `3`).
- `b` returns to the three-option landing menu.

### In-Progress Games

- Lists resumable sessions with:
  - mystery title
  - turns left
  - last played timestamp
- Selecting a number resumes the chosen session in interactive mode.
- Resume rendering rebuilds the narration area from persisted `narration_events` only, preserving exact text and speaker order.
- `b` returns to the landing menu.

### Completed Games

- Lists ended sessions with:
  - mystery title
  - outcome (`win`/`lose`)
  - last played timestamp
- Selecting a number opens the ended session in read-only viewer mode.
- Completed viewer blocks command input and shows only the any-key return prompt.
- `b` returns to the landing menu.

---

## Game Page Layout

### Header

- Mystery title.

### Narration Window

- The session screen is two columns: narration on the left third, a fixed scene
  image on the right two thirds.
- Block-based messages, left-aligned.
- The transcript is presented as **pages**, one per interaction. Arriving
  somewhere and searching it is one page; a whole conversation is one page.
  Players move between pages with `‹` / `›`, `Alt+←` / `Alt+→`, or `[ latest ]`,
  and can keep issuing commands from an old page — doing so returns them to the
  newest one.
- The case opens on its own page and waits for a keypress before narrating
  arrival at the first location, so the premise gets read before play starts.
- The scene image is whatever the active page carries:
  - `location_image_id` from `move` responses
  - `character_portrait_image_id` from `talk` responses
  - the previous page's image when an interaction has none of its own
  - a labelled placeholder on a missing/failed image
- Visually distinguish:
  - Narrator
  - Characters
  - Investigator
- Every rendered block must include an explicit actor label derived from speaker metadata:
  - `You` for player input lines
  - `Narrator` for start/move/search/talk-start/talk-end/accuse narration
  - Active character name for `game-ask` responses
  - `System` for local-only help/validation/retry feedback
- Each block includes a label/title (e.g., “NARRATOR”, “MAYA”, “YOU”).

### Status Bar

- **Time left**
- **Current location** + hint
- **Visible characters** + hint
- Include discoverability cues:
  - show `?` for help
  - show reminders like `type "help" for commands`

### Input Area

- Text input for commands/questions.
- On interaction:
  - show loading indicator
  - freeze/disable input until response returns (prevents double-submit confusion)

---

## Help and Error Handling

### Strict Command Parsing

- Prefer strict parsing over “guessing” to keep the mental model simple for kids.
- On invalid input:
  - show a friendly error
  - immediately show help summary (or a short hint + link to help)

### Help Surface

- `help` or `?` always works.
- Narration window can show keyboard tips:
  - how to scroll
  - how to exit talk mode
  - example commands

---

## Parser Logic (High Level)

- Strict command parsing with clear grammar.
- Commands should be consistent and forgiving in small ways (e.g., allow `go` as alias for `move`), but avoid ambiguity.

**Example command set (illustrative, not final):**

- `help`
- `talk to <name>`
- `ask <free text>` (only inside talk mode) _or_ just free text inside talk mode
- `end` (exit talk mode)
- `move to <place>` / `go <place>`
- `search`
- `accuse <name>`
- `quit`
