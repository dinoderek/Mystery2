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

---

## Game Flow

## 1) Start

1. User selects a blueprint.
2. User starts a new game.

### Game Start Sequence

- Display premise (short hook).
- Display starting knowledge as an additional narrator block in the opening transcript.
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

## Quit

**Command:** `quit` or `exit`

### Quit Behavior

- Ends the current play session immediately.
- Replaces the command input with a terminal prompt: `press any key to go back to the mystery list`.
- Pressing any key returns the player to the landing menu (`/`).

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
  - `press any key to go back to the mystery list`

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

## UX / UI Concept

### Overall Feel

- Text-first, terminal-like.
- All choices via typed commands (no buttons required initially).
- Keyboard-friendly.
- Inline help and discoverability are critical.

### Navigation

- Arrow key navigation (for history / scrolling / maybe command recall).
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
- If a blueprint has `blueprint_image_id`, render the cover image via authenticated signed URL.
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

- Block-based messages, left-aligned.
- Session view may include a side image panel:
  - `location_image_id` from `move` responses
  - `character_portrait_image_id` from `talk` responses
  - Placeholder panel on missing/failed image link
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
