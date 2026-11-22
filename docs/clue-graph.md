# Clue Graph

A case format beside [V2](../packages/shared/src/blueprint-schema-v2.ts) and
[MSF](mystery-structure.md). Schema and checks:
`packages/shared/src/clue-graph-schema.ts`; play:
`packages/game-engine/src/clue-graph/`; cases: `blueprints/clue-graph/`.

## The model

Everything a player can learn is a clue; what holds one back is a gate.

| Node | What it is | Player sees it |
|---|---|---|
| Opening | What is public at the start | Yes |
| Evidence | A finding at a location or spot, always true | Yes |
| Statement | What a character says: true, or false with why | Yes, unmarked |
| Tell | What a character does, hinting at what can be unlocked | Yes |
| Conclusion | An all-of or any-of rule over clues and conclusions | No |

A character's clue is reached one
way (`reached.by`): `first_meeting`; `seen` (tells only), `with` one of their
statements or when a `subject` comes up; `asked` `about`, once one of
`prompted_by` (clues, or `"opening"`) is held; or `gated`, when its `gate`
opens.

A gate has up to three parts:

- `after`: the character's earlier clues that must be out first;
- `use`: clues the player shows this character, `any` or `all`;
- `line`: a line of questioning, with the tell that hints at it (`hinted_by`).

With `after` alone, it comes when asked once those are out (a confession).
With `use` and `line`, either opens it. `physical: true` cannot be bluffed:
its `use` clues must be held. A
gated statement may `takes_back` the character's earlier false statements.
Using a clue means showing it or making its point, not holding it.

## The case file

One JSON file, `"format": "clue-graph/2"`, maps keyed by ID; unknown fields
and formats are rejected by name. It holds facts, never the words a child
reads. A fact states what it establishes completely, with every name, time, place
and object. Beyond the schema:

- `metadata.target_age`: the default reading age, and the age the plot is
  sized for.
- A spot with `revealed_by` is hidden until that clue is held, and that
  clue's line names the spot.
- `personality` and `demeanor` (by stance) direct the narrator; `knows` holds
  true facts shared when asked, never clues.
- `colour: true` marks a clue nothing depends on.
- Artwork, never needed: `visual_direction`, `cover` and image IDs
  ([generation flows](blueprint-generation-flows.md)).

An earlier-format game stays listed; opening it answers `410`, logged once.

## Validation

`npm run validate:clue-graph -- <file>` exits 0 valid,
1 invalid, 2 unreadable, 3 misuse; each fault names its field.

Trails: `node scripts/print-clue-graph-trails.mjs <file>` prints each
conclusion's routes.

References must fit: `after`, `takes_back`, `hinted_by` and `seen.with` name the same character's clues;
`points_at` and the cover name what the case holds;
`clears` names a suspect; one culprit, named by one conclusion. Then, from the
opening alone, adding each clue whose way in is held (never a bluff), it
rejects:

- a clue never reached, or an asked clue with no prompt;
- a worded gate no tell hints at;
- a false statement never taken back, or only by a clue reached first;
- a conclusion never reached, or a suspect no conclusion clears;
- a culprit with no route in the turn budget;
- a spot or plain search with two clues; a cycle of `after` links.

Story checks, for authored cases:

- a gate the character's own clues open, lines aside;
- a suspect cleared only on retracted statements;
- a culprit with fewer than two routes, or none without the confession (the
  culprit's gated true statements, never held on it), or over 256 to check;
- a clue nothing names unless marked `colour`, or a colour clue something does;
- over four clues in five free (reached holding nothing);
- a character with more first words than a greeting carries;
- a case outside its size.

A statement taken back counts as held. Routes use the game's costs
(`docs/game.md`): a conversation yields all it can reach, but one started on
the last turn only the greeting.

## Sizes

`metadata.size` holds a case to these counts
(`packages/shared/src/clue-graph-sizes.ts`); a brief's overrides travel in
`size_overrides`. No size, no checks. The first row is
exact, clues a range, the rest floors.

| | Small | Medium | Large |
|---|---|---|---|
| Turns, locations, suspects, witnesses | 8, 3, 1, 2 | 12, 4, 2, 2 | 16, 6, 3, 3 |
| Clues | 15–20 | 25–35 | 40–55 |
| Gated, false, hidden spots, routes | 3, 1, 0, 2 | 5, 2, 1, 2 | 8, 4, 2, 3 |
| Without the confession: shortest route, false alibis, suspects always cleared | 3, 0, 0 | 4, 1, 0 | 5, 1, 1 |

The shortest counts its rule's clues. A false alibi clears someone else and
is false; such a route draws on it or its retraction.

## In play

A start saves the case in `game_sessions.clue_graph_snapshot`, which resume
and every turn play through a rule-free world view, without the story checks. Each turn that counts saves its event in
`payload.clue_graph`; all else derives from it.

- **Talk** (`graph_talk`): the narrator gets `talkState`, `knows` and
  first-meeting appearance, and reports what the line `opened` and
  `answered`. A report not offered fails the turn; one already held,
  or a tell seen with what came out, is dropped; gibberish records nothing.
- **Search** (`graph_search`) gives one clue. The engine names the spot from
  the words, else the narrator picks a visible spot's clue, the room's, or
  none. A hidden spot shows once its pointer is held; before, words fitting
  it best find nothing, and the narrator never hears of it.
- **Notebook lines**, one per clue a turn brings out, each with its fact's
  every detail, are saved in the event's
  `notebook`; a missing, extra, blank or repeated line fails the turn, one for
  a held clue is dropped. Every reader uses it.
- **Notebook**: every held clue, with kind and whether taken back, then the
  leads: someone unmet, someone with more to give, a hidden spot newly shown,
  each new on its turn. No conclusion, truth, rule or gate wording reaches
  the browser; a farewell sees only found clues.

## Accusation

The engine decides; the narrator (`graph_accusation`) only says who was named
and which held clues they cited. Naming the culprit wins with the confession
held (their gated true statements the culprit conclusion names), or with that
conclusion holding on clues not taken back, one cited. A first right name
short of that earns one question, even at the limit; else V2's rounds: lost
from the third.

Until then a round (`graph_accusation_round`) gets only the people, the
notebook and, unless support is held, a lead off the confession's route,
never whether the name was right. The closing scene (`graph_ending`), win or
lose, tells `truth.timeline`, the culprit conclusion and `truth.motive`.

## The narrator's judgement

The narrator may add scenery and manner, never what looks like evidence or
bears on who, when or where, keeping what was established. Asked
anything beyond their clues and `knows` that bears on the case, a character
says plainly they do not know.

A line opens the gates its words earn, generous on wording, strict on deeds;
a clue shown and dodged opens on a follow-up. Cases:
`evaluation/runtime/cases/clue-graph/` ([grading](../evaluation/runtime/README.md)).
