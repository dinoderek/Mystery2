# Clue Graph

A third case format beside [V2](../packages/shared/src/blueprint-schema-v2.ts)
and [MSF](mystery-structure.md). Schema and checks:
`packages/shared/src/clue-graph-schema.ts`; play:
`packages/game-engine/src/clue-graph/`; cases: `blueprints/clue-graph/`.

## The model

Everything a player can learn is a clue; what holds one back is a gate.

| Node | What it is | Player sees it |
|---|---|---|
| Opening | What is public at the start | Yes |
| Evidence | A finding at a location or spot, always true | Yes |
| Statement | What a character says: true, or false with why | Yes, never marked true or false |
| Tell | What a character does that hints at what can be unlocked | Yes |
| Conclusion | An all-of or any-of rule over clues and conclusions | No |

Evidence is found by searching its source. A character's clue is reached one
way (`reached.by`): `first_meeting`; `seen` (tells only), `with` one of their
statements or when a `subject` comes up; `asked` `about`, once one of
`prompted_by` (clues, or `"opening"`) is held; or `gated`, when its `gate`
opens.

A gate has up to three parts:

- `after`: the character's earlier clues that must be out first;
- `use`: clues the player shows this character, `any` or `all`;
- `line`: a line of questioning, with the tell that hints at it (`hinted_by`).

With `after` alone, the clue comes when asked once those are out (a confession).
With `use` and `line`, either opens it. `physical: true` cannot be bluffed. A
gated statement may `takes_back` the character's earlier false statements.
Using a clue means showing it or making its point, not holding it.

## The case file

One JSON file, `"format": "clue-graph/2"`, maps keyed by ID; unknown fields
and any other format are rejected, by name. A case holds facts, never the
words a child reads: the narrator writes those. A fact states what it
establishes plainly and completely, keeping every name, time, place and
object. Names (people, places, spots, the title) are as authored.

- `metadata`: `id`, `title`, `time_budget`, and `target_age`, the default
  reading age and the age the plot is sized for.
- `opening`: the starting `location` and the public `facts`.
- `truth`: the `timeline`, and the culprit's `motive`, which the ending tells.
- `locations`: `name`, `facts` about the place, and `spots`. A spot with
  `revealed_by` is hidden until that clue is held.
- `characters`: `name`, `location`, `role` (`culprit`, `suspect`,
  `witness`), `sex`, `personality`, `demeanor` lines by stance, `knows` and `appearance`
  (two or more facts). Personality and demeanor are direction for the
  narrator, not text for the child. Each `knows` entry is a plain true
  `fact`, never a clue, and may point at a place or person (`points_at`). A
  character's secret is the fact of their gated clues.
- `clues`: `kind`, `fact`, `source` (`location` and optional `spot`, or
  `character`). A statement's fact is the claim, with `truth`, and `why` when
  false; a tell's is what is observed.
- `conclusions`: `text` and `rule`, plus at most one of `clears` (a suspect),
  `culprit` or `resolves` (a red herring, in words).
- Artwork, optional and never needed to play: `visual_direction` (V2's
  shape) and `cover` (`facts`, optional `locations` and `characters`).

A game saved in an earlier format stays listed but cannot open: `410`,
logged once.

## Validation

`npm run validate:clue-graph -- <file>` (`validateClueGraph`) exits 0 valid,
1 invalid, 2 unreadable, 3 misuse.

Trails: `node scripts/print-clue-graph-trails.mjs <file>` (or
`npm run trails:clue-graph`) prints the case as Markdown trails, by the same
reach code and exit codes, with no model: each conclusion's routes from the
opening, each step after every way into it, with how it is reached and what
takes it back.

References must fit: `after`,
`takes_back`, `hinted_by` and `seen.with` name the same character's clues;
`points_at` and the cover name what the case holds;
`clears` names a suspect; one culprit, named by one conclusion. Then, from the
opening alone, it adds each clue whose way in is held, never counting a bluff,
and rejects:

- a clue never reached, or an asked clue with no prompt;
- a worded gate no tell hints at;
- a false statement never taken back, or only by a clue reached first;
- a conclusion never reached, or a suspect no conclusion clears;
- a culprit with no route within the turn budget without a bluff;
- a spot or plain search with two clues; a cycle of `after` links.

A statement taken back counts as held. The route uses the game's costs
(`docs/game.md`); a conversation yields every clue it can reach, but one
started on the last turn gives only the greeting.

## In play

The loader reads `clue-graph/` and builds a rule-free world view, its catalog
ID a UUID from `metadata.id`. A start saves the validated case in
`game_sessions.clue_graph_snapshot`, which resume and every turn play. Each
turn that counts saves its event (move, search, talk, line) as
`payload.clue_graph`, which the engine folds.

- **Gates.** Available once every `after` clue is out. A physical gate with
  `use` also needs those clues held; a non-physical one is bluffable.
- **Talk** (`graph_talk`, one call a line): the narrator gets the character's
  state (`talkState`; first words three a line from the greeting on),
  `knows`, appearance on a first meeting, and reports what the line `opened`
  and `answered`. A report the state did not offer fails the turn before
  anything is saved; one already held is dropped; gibberish records nothing.
- **Search** (`graph_search`) gives one clue. The engine names the spot from
  the words, or for words naming none the narrator picks a visible spot's
  clue, the room's, or none. A hidden spot shows once its pointer is held.
  Before, it wins only words fitting it better than every visible spot, finds
  nothing, and is never named to the narrator.
- **Notebook lines.** Each clue a turn brings out gets a line, saved in the
  event's `notebook`; a missing, extra, blank or repeated line fails the turn;
  one for a held clue is dropped. Every reader then uses that line: notebook,
  later turns, farewell (found clues only), accusation. A pointer's line names
  its spot.
- **Retraction** marks a statement taken back; a conclusion holds only on
  clues held and standing.
- **Leads** name someone unmet, someone with more to give, or a hidden spot
  newly shown, new on its turn.
- **Notebook**: every held clue, with its kind and whether taken back, then
  the leads. No conclusion, truth, rule or gate wording reaches the browser.
- **Accusation**: the judge gets the graph and `clue_graph_progress`:
  conclusions supported, whether one names the culprit, what is taken back.

Artwork is optional: `./dev gen-images` saves image IDs
([generation flows](blueprint-generation-flows.md)).

## The narrator's judgement

The narrator writes every word the child reads, from facts. It may add
scenery and manner, never what looks like evidence or bears on who, when or
where, and keeps what the narration it is handed established. Asked about
anything beyond their clues and `knows` that bears on the case, a character
says plainly they do not know.

One talk prompt serves everyone, generous on how the investigator puts things
and strict on what they do. Each line carries their earlier lines in the
conversation, so a clue shown and dodged opens on a follow-up. Cases and
baselines: `evaluation/runtime/cases/clue-graph/`.
