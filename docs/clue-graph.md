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
and other formats are rejected, by name. A case
holds facts, never the words a child reads: the narrator writes those. A fact
states what it establishes completely, keeping every name, time,
place and object; names are as authored. Beyond the schema:

- `metadata.target_age`: the default reading age, and the age the plot is
  sized for.
- `truth` (`timeline`, `motive`) is what the ending tells.
- A spot with `revealed_by` is hidden until that clue is held, and that
  clue's line names the spot.
- `personality` and `demeanor` (by stance) direct the narrator; `knows` holds
  true facts shared when asked, never clues; a character's secret is the fact
  of their gated clues.
- A clue's `fact` is what evidence establishes, what a statement claims (with
  `truth`, and `why` when false) or what a tell shows. `colour: true` marks a
  clue nothing depends on.
- A conclusion has a `rule` and at most one of `clears`, `culprit` and
  `resolves` (a red herring).
- Artwork, never needed: `visual_direction`, `cover` and image IDs
  ([generation flows](blueprint-generation-flows.md)).

An earlier-format game stays listed; opening it answers `410`, logged once.

## Validation

`npm run validate:clue-graph -- <file>` (`validateClueGraph`) exits 0 valid,
1 invalid, 2 unreadable, 3 misuse; each fault names its field.

Trails: `node scripts/print-clue-graph-trails.mjs <file>` prints each
conclusion's routes as Markdown trails.

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

The loader builds a rule-free world view. A start saves the
case in `game_sessions.clue_graph_snapshot`, which resume and every turn play,
checked without the story checks. Each turn that counts saves its event in
`payload.clue_graph`, from which the rest is derived.

- **Talk** (`graph_talk`): the narrator gets `talkState`, `knows` and
  first-meeting appearance, and reports what the line `opened` and
  `answered`. A report not offered fails the turn, unsaved; one already held
  is dropped; gibberish records nothing.
- **Search** (`graph_search`) gives one clue. The engine names the spot from
  the words, else the narrator picks a visible spot's clue, the room's, or
  none. A hidden spot shows once its pointer is held; before, it wins only
  words it fits better than any visible spot, finds nothing, and is never
  named to the narrator.
- **Notebook lines**, one per clue a turn brings out, are saved in the event's
  `notebook`; a missing, extra, blank or repeated line fails the turn, one for
  a held clue is dropped. Every reader (notebook, later turns, farewell,
  accusation) uses that line.
- **Notebook**: every held clue, with kind and whether taken back, then the
  leads: someone unmet, someone with more to give, a hidden spot newly shown,
  each new on its turn. No conclusion, truth, rule or gate wording reaches
  the browser; a farewell sees only found clues.
- **Accusation**: the judge gets the graph and `clue_graph_progress`. A
  conclusion holds only on clues not taken back.

## The narrator's judgement

The narrator may add scenery and manner, never evidence or anything bearing on
who, when or where, and keeps what earlier narration established. Asked
anything beyond their clues and `knows` that bears on the case, a character
says plainly they do not know.

One talk prompt, generous on how the investigator puts things and strict on
what they do, judges which offered gates a line opened, given their earlier
lines, so a clue shown and dodged opens on a follow-up. Cases and baselines:
`evaluation/runtime/cases/clue-graph/`.
