# Clue Graph

A third case format beside [V2](../packages/shared/src/blueprint-schema-v2.ts)
and [MSF](mystery-structure.md), not yet loaded by the game. Schema and checks:
`packages/shared/src/clue-graph-schema.ts` and its validator; play:
`packages/game-engine/src/clue-graph/`. The greenhouse story,
`blueprints/clue-graph/greenhouse-prizewinner.json`, is outside the game's
folders.

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

With `after` alone, the clue comes when asked once those are out: a confession
is gated on every other crack. With `use` and `line`, either opens it.
`physical: true` marks a gate a bluff cannot open. A gated statement may
`takes_back` the character's earlier false statements. Using a clue means
showing it or making its point; holding it is not using it.

## The case file

One JSON file, `"format": "clue-graph/1"`. Maps are keyed by ID; unknown
fields are rejected, V2's agendas, parts and tells among them.

- `metadata`: `id`, `title`, `target_age`, `time_budget`.
- `opening`: the starting `location` and the public `text`.
- `truth.timeline`: what really happened.
- `locations`: `name`, `description` and `spots`. A spot with `revealed_by`
  is hidden until that clue is held.
- `characters`: `name`, `location`, `role` (`culprit`, `suspect` or
  `witness`), `personality`, and a `demeanor` line for at least one stance
  (`open`, `guarded`, `shaken`, `cornered`, `cleared`).
- `clues`: `kind`, `text`, `source` (`location` and optional `spot`, or
  `character`), and for statements `truth`, with `why` when false.
- `conclusions`: `text` and `rule`, plus at most one of `clears` (a suspect),
  `culprit` or `resolves` (a red herring, in words).

## Validation

`validateClueGraph(value)` returns the case or throws:

```sh
npm run validate:clue-graph -- blueprints/clue-graph/greenhouse-prizewinner.json
```

It exits 0 valid, 1 invalid, 2 unreadable, 3 misuse.

References must fit: `after`, `takes_back`, `hinted_by` and `seen.with` name
the same character's clues; `clears` names a suspect; no conclusion shares a
clue's ID; one character is the culprit, named by one conclusion.

Then reachability: from the opening alone, it adds each clue whose way in is
held until none is added, never counting a bluff. It rejects, naming the fault:

- a clue never reached, or an asked clue with no prompt;
- a worded gate no tell hints at;
- a false statement never taken back, or only by a clue reached first;
- a conclusion never reached, or a suspect no conclusion clears;
- a culprit with no route within the turn budget without a bluff;
- a spot or plain search with two clues;
- a cycle of `after` links.

Both count a statement taken back as held, and a subject tell as reached once
its character is met. The route uses the game's costs (`docs/game.md`): a move,
a search or starting a talk costs a turn; lines are free. A conversation yields
every clue of that character it can reach; a clue found later needs another
talk; one on the last turn gives only the greeting (three first words).

## In play

The engine folds the events (move, search, talk, each line) into what is held
and taken back, and derives the rest on every call, storing nothing.

- **Gates.** Available once every `after` clue is out. A physical gate with
  `use` also needs those clues held; a non-physical one is available without
  them, and bluffable. A line keeps only the gates, answers and subject tells its state
  offered; the rest come back rejected.
- **First words** come three a line from the greeting on, with their tells.
- **Retraction** marks a statement taken back. A conclusion holds only on live
  clues (held, not taken back), so it falls with them.
- **Hidden spots** show once their pointer is held; before, they find nothing.
- **Character state**, the narrator's input for a line: stance and demeanor,
  first words due, answers if asked, each available gate (what opens it, what
  it gives with its tells, what it takes back), subject tells, the story so
  far, what tells have shown, and what to keep back: standing first words and
  answers that a gate not yet available would take back, never a gated clue.
- **Leads** name who or where: someone unmet; someone with first words due, a
  question a held clue prompts, or a gate what is held opens; a hidden spot
  newly visible. Each is marked new on the turn it appears.
- **Notebook**: held clues, without tells no clue depends on; taken-back
  statements marked; never a conclusion.
