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
| Statement | What a character says: true, or false with why | Yes, never marked true or false |
| Tell | What a character does, hinting at what can be unlocked | In prose |
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
With `use` and `line`, either opens it. `physical: true` cannot be bluffed. A
gated statement may `takes_back` the character's earlier false statements.
Using a clue means showing it or making its point, not holding it.

## The case file

One JSON file, `"format": "clue-graph/2"`, maps keyed by ID; unknown fields
and any other format are rejected, by name. A case
holds facts, never the words a child reads: the narrator writes those. A fact
states what it establishes plainly and completely, keeping every name, time,
place and object; names are as authored. Beyond the schema:

- `metadata.target_age`: the default reading age, and the age the plot is
  sized for.
- `truth` (`timeline`, the culprit's `motive`) is what the ending tells.
- A location's spot with `revealed_by` is hidden until that clue is held.
- A character's `personality` and `demeanor` (by stance) direct the
  narrator, not text for the child; `knows` holds true facts shared when
  asked, never clues; their secret is the fact of their gated clues.
- A clue's `fact` is what evidence establishes, what a statement claims (with
  `truth`, and `why` when false) or what a tell shows. `colour: true` marks a
  clue nothing depends on, by design.
- A conclusion has a `rule` and at most one of `clears`, `culprit` and
  `resolves` (a red herring).
- Artwork, never needed to play: `visual_direction` (V2's shape) and `cover`.

A game saved in an earlier format stays listed, marked unable to open;
opening it answers `410`, logged once.

## Validation

`npm run validate:clue-graph -- <file>` (`validateClueGraph`) exits 0 valid,
1 invalid, 2 unreadable, 3 misuse; each fault names its field. References
must fit (`after`, `takes_back`, `hinted_by` and `seen.with` name the same
character's clues). Then, from the
opening alone, it adds each clue whose way in is held, never counting a bluff,
and rejects:

- a clue never reached, or an asked clue with no prompt;
- a worded gate no tell hints at, or a gate the character's own clues open,
  lines aside;
- a false statement never taken back, or only by a clue reached first;
- a conclusion never reached; a suspect no conclusion clears, or cleared only
  on statements taken back;
- a culprit with fewer than two routes in the turn budget, or none without
  the confession (their gated true statements, then never held on the way);
- a clue nothing names, unless marked `colour`, or a colour clue something names;
- over four clues in five free (reached with nothing held);
- a character with more first words than a greeting carries;
- a spot or plain search with two clues; a cycle of `after` links;
- a case outside its size.

A statement taken back counts as held. The route uses the game's costs
(`docs/game.md`); a conversation yields every clue it can reach, but one
started on the last turn gives only the greeting.

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
| Without the confession: shortest route, false alibis, always cleared | 3, 0, 0 | 4, 1, 0 | 5, 1, 1 |

The shortest counts its rule's clues. A false alibi clears someone else and
is false; such a route draws on it or its retraction. Always cleared: suspects
every such route clears.

## In play

The loader reads `clue-graph/` beside `msf/` into a rule-free world view; the
catalog ID is a UUID from `metadata.id`. A start saves the validated case in
`game_sessions.clue_graph_snapshot`, which resume and every turn play. Each turn that counts saves its event (move, search, talk, line) in
`payload.clue_graph`; the engine derives the rest from those on every call.

- **Gates.** Available once every `after` clue is out. A physical gate with
  `use` also needs those clues held; a non-physical one is bluffable.
- **Talk** (`graph_talk`, one call a line): the narrator gets the character's
  derived state (`talkState`; first words three a line from the greeting on)
  and reports what the line `opened` and `answered`. A report the state
  did not offer fails the turn before anything is saved; one already held is
  dropped; gibberish records nothing.
- **Search** (`graph_search`) gives one clue. The engine names the spot from
  the words; the narrator reports what it holds, or for words naming none,
  picks a visible spot's clue, the room's, or none. A hidden spot shows once its
  pointer is held; before, it wins words only by fitting them better than
  every visible spot, finds nothing, and is never named to the narrator.
- **Retraction** marks a statement taken back; a conclusion holds only on
  clues held, not taken back.
- **Leads** name who or where: someone unmet, someone with more to give, a
  hidden spot newly visible; each new when it appears.
- **Notebook**: held clues, each with its kind and whether taken back, then the
  leads. Never a conclusion or a tell nothing depends on; no truth, rule or
  gate wording reaches the browser. A farewell narrator sees only clues
  found.
- **Accusation**: the judge gets the graph and `clue_graph_progress`
  (supported conclusions, the culprit's among them, and retractions).

## The narrator's judgement

One talk prompt serves everyone: generous on how the investigator puts things,
strict on what they do. It judges which offered gates a line opened, given
what the investigator said earlier in the conversation, so a clue shown and
dodged opens on a follow-up. Cases and baselines:
`evaluation/runtime/cases/clue-graph/`.
