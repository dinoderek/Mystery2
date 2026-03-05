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
- **Note:** The comprehensive schema for Blueprints is defined entirely in the Zod definitions at `supabase/functions/_shared/blueprints/blueprint-schema.ts`. The schema's `.describe()` fields serve as the core narrative intent instructions for AI generators and the Narrator.

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
- **Clues** (review discovered info)
- **Accuse** (endgame)
- **Help**
- **Quit**

### Time Costs
- Each action consumes time/turns.
- Talk mode may consume time per question, or per “talk session” (implementation choice—see below).

When time is exhausted:
- Automatically trigger the endgame: narrator prompts for accusation.

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
- Narrator responds *as that character*, consistent with blueprint.
- Character should remember prior interactions in the same game (continuity).

**Exit Talk Mode**
- Example: `end` or `exit` (exact keyword TBD, but should be consistent and discoverable).

**Time model (choose one later)**
- A) each question consumes 1 turn  
- B) entering talk mode consumes 1 turn, questions are “free” but capped (less likely)  
- C) hybrid: first question costs 1, follow-ups cost 0.5 (probably too complex)

---

## Search
**Command:** `search` (search current location)  
Optionally later: `search <sub-location>` once sub-locations exist.

### Search Behavior
- Narrator adjudicates what is found.
- Search can:
  - reveal a clue from the blueprint for this location
  - reveal a “follow-up” searchable sub-location (e.g., “behind the curtains”, “under the bench”)
  - reveal nothing (but should still produce flavorful feedback)

**Open questions (intentionally left TBD)**
- How strictly search results must follow blueprint vs allowing AI-generated filler:
  - Recommended: blueprint controls “real clues”; AI can add non-clue flavor.
- Whether sub-locations are predefined or dynamically generated:
  - Recommended: blueprint defines canonical sub-locations for clue-bearing areas; AI can suggest extra “non-clue” sub-spots.

---

## Move
**Command:** `move to <location>` or `go <location>`

### Move Behavior
- Narrator describes arrival and the location.
- Shows who is present (characters visible there).
- Location description should be consistent and re-usable:
  - Recommended: blueprint provides a base description; narrator adds light variation.

**Interaction with search**
- Location has a general description (move)
- Search focuses on discoverable details (search)
- Keep these separate to preserve the loop: move ≠ search.

---

## Accuse (Endgame)
**Command:** `accuse <character>`

### Endgame Flow
- Narrator generates a “showdown” scene description.
- Investigator states:
  - who did it
  - why / reasoning
  - key supporting clues
- Narrator may ask follow-up questions if reasoning is incomplete (to help the child articulate).
- Narrator reveals outcome:
  - If correct: explanation + how clues connect + timeline
  - If incorrect: explanation + correct culprit + where reasoning diverged

**Hard requirement:** The explanation must make sense and align with:
- timeline
- alibis
- clue placement
- motives

---

## Blueprint Schema Reference

See `supabase/functions/_shared/blueprints/blueprint-schema.ts` for the exact technical schema and narrative instructions encoded in the `.describe()` fields. Blueprint metadata controls the title, difficulty, and time budget. The world model defines characters and locations. The ground truth determines what actually happened and provides the absolute facts the Narrator must adhere to.

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
1. **Current Games**
2. **New Game**
3. **Historical Games**
4. (Future) **Settings**

### New Game
- List blueprints.
- Start by typing a number (e.g., `1`, `2`, `3`).

---

## Game Page Layout

### Header
- Mystery title.

### Narration Window
- Block-based messages, left-aligned.
- Visually distinguish:
  - Narrator
  - Characters
  - Investigator
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
- `ask <free text>` (only inside talk mode) *or* just free text inside talk mode
- `end` (exit talk mode)
- `move to <place>` / `go <place>`
- `search`
- `clues`
- `accuse <name>`
- `quit`
