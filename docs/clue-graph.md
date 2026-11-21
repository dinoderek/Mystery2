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
| Tell | What a character does that hints at what can be unlocked | In prose |
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
Using a clue means showing it or making its point; holding it is not.

## The case file

One JSON file, `"format": "clue-graph/1"`, maps keyed by ID; unknown fields
(V2's agendas, parts and tells among them) are rejected.

- `metadata`: `id`, `title`, `target_age`, `time_budget`.
- `opening`: the starting `location` and the public `text`.
- `truth.timeline`: what really happened.
- `locations`: `name`, `description` and `spots`. A spot with `revealed_by`
  is hidden until that clue is held.
- `characters`: `name`, `location`, `role` (`culprit`, `suspect`,
  `witness`), `sex` (for pronouns), `personality`, and `demeanor` lines by
  stance (`open`, `guarded`, `shaken`, `cornered`, `cleared`).
- `clues`: `kind`, `text`, `source` (`location` and optional `spot`, or
  `character`), and for statements `truth`, with `why` when false.
- `conclusions`: `text` and `rule`, plus at most one of `clears` (a suspect),
  `culprit` or `resolves` (a red herring, in words).

## Validation

`npm run validate:clue-graph -- <file>` (`validateClueGraph`) exits 0 valid,
1 invalid, 2 unreadable, 3 misuse. References must fit: `after`, `takes_back`,
`hinted_by` and `seen.with` name the same character's clues; `clears` names a
suspect; one culprit, named by one conclusion. Then, from the opening alone,
it adds each clue whose way in is held, never counting a bluff, and rejects:

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

The loader reads `clue-graph/` beside `msf/` and builds a rule-free world view
for commands and arrivals; the catalog ID is a UUID derived from `metadata.id`.
A start saves the validated case in `game_sessions.clue_graph_snapshot`
(database version 5), which resume and every turn play. Each turn that counts
saves its event (move, search, talk, line) in `payload.clue_graph`; the engine
folds those and derives the rest on every call.

- **Gates.** Available once every `after` clue is out. A physical gate with
  `use` also needs those clues held; a non-physical one is bluffable.
- **Talk** (`graph_talk`, one call a line): the narrator gets the character
  state (stance and demeanor, first words due, three a line from the
  greeting on; answers; available gates, what opens each, what it gives and
  takes back; subject tells; the story so far; statements to keep back) and
  reports what the line `opened` and `answered`. Dodged evidence is read from
  the conversation. A report the state did not offer fails the turn before
  anything is saved; one already held is dropped; gibberish records nothing.
- **Search** gives one clue. The engine names the spot from the words, and
  the narrator must report what it holds; words naming no spot let the
  narrator pick a visible spot's clue, or none. A hidden spot shows once its
  pointer is held. Before, it wins the words only by fitting them better than
  every visible spot, finds nothing, and is never named to the narrator.
- **Retraction** marks a statement taken back; a conclusion holds only on
  clues held and not taken back.
- **Leads** name who or where: someone unmet, someone with more to give, a
  hidden spot newly visible; each is marked new when it appears.
- **Notebook**: held clues, without tells no clue depends on; never a
  conclusion. No truth, rule or gate wording reaches the browser, and a
  farewell narrator sees only clues already found.
- **Accusation**: the judge gets the graph and `clue_graph_progress`
  (supported conclusions, whether one names the culprit, what was taken back).
