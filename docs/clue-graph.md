# Clue Graph

A third case format beside [V2](../packages/shared/src/blueprint-schema-v2.ts)
and [MSF](mystery-structure.md): one graph of clues for both searching and
talking. The schema and validator exist; nothing loads the format into the game
yet. Schema: `packages/shared/src/clue-graph-schema.ts`; checks:
`clue-graph-validator.ts` beside it. The greenhouse story is
`blueprints/clue-graph/greenhouse-prizewinner.json`, outside the folders the
game reads.

## The model

Everything a player can learn is a clue; whatever holds one back is a gate.

| Node | What it is | Player sees it |
|---|---|---|
| Opening | What is public at the start, and where | Yes |
| Evidence | A finding at a location or spot. Always true. | Yes |
| Statement | Something a character says: true, or false with why | Yes, never marked true or false |
| Tell | Something a character does that hints at what can be unlocked | In prose; recorded only when another clue depends on it |
| Conclusion | An all-of or any-of rule over clues and conclusions | No |

Evidence is reached by searching its source. A statement or tell comes from a
character, and is reached in exactly one way:

| `reached.by` | When | For |
|---|---|---|
| `first_meeting` | Said or shown the first time the player talks to them | statements, tells |
| `seen` | `with` one of the character's own statements, or when a `subject` comes up | tells |
| `asked` | The player asks `about` it, once one of `prompted_by` (clues, or `"opening"`) is held | statements |
| `gated` | Its `gate` opens | statements |

A gate has up to three parts:

- `after`: earlier clues from the same character that must be out first;
- `use`: clues the player shows this character, `any` or `all`;
- `line`: a line of questioning in words, with the character's tell that hints
  at it (`hinted_by`).

With `after` alone, the clue comes when asked once those are out: a confession
is a statement gated on every other crack. With `use` and `line`, either opens
it. `physical: true` marks a gate a bluff cannot open. A gated statement may
`takes_back` earlier false statements of the same character.

Using a clue means showing it or making its point at the character; holding it
is not using it.

## The case file

One JSON file, `"format": "clue-graph/1"`, holds the graph and what is
authored beside it. Maps are keyed by ID; unknown fields are rejected, and so
are V2's agendas, parts, conditional reveals and character tells.

- `metadata`: `id`, `title`, `target_age`, `time_budget`.
- `opening`: the starting `location` and the public `text`.
- `truth.timeline`: what really happened.
- `locations`: `name`, `description` and `spots`. A spot with `revealed_by`
  is hidden: unmentioned, and unsearchable until that clue is held.
- `characters`: `name`, `location`, `role` (`culprit`, `suspect` or
  `witness`), `personality`, and one `demeanor` line per stance (`open`,
  `guarded`, `shaken`, `cornered`, `cleared`; at least one).
- `clues`: `kind`, `text`, `source` (`location` and optional `spot`, or
  `character`), and for statements `truth` and `why` when false.
- `conclusions`: `text` and `rule`, plus at most one of `clears` (a suspect),
  `culprit` or `resolves` (a red herring, in words).

Leads, stances, character state and supported conclusions are derived from the
graph and the events, never authored.

## Validation

`validateClueGraph(value)` returns the typed case or throws a ZodError with
field paths:

```sh
npm run validate:clue-graph -- blueprints/clue-graph/greenhouse-prizewinner.json
```

It exits 0 when valid, 1 for an invalid case, 2 for an unreadable file or
invalid JSON, 3 for misuse.

First, references must fit: a gate's `after`, `takes_back`, `hinted_by` and
`seen.with` name the same character's clues; `clears` names a suspect; no
conclusion shares a clue's ID. Exactly one character is the culprit and exactly
one conclusion names them.

Then reachability: from the opening alone, the validator sweeps the clues in
file order, adding each whose way of being reached is held, until none is
added. A bluff never counts. The case is rejected, naming
what is at fault, when:

- a clue is never reached;
- an asked clue has no prompt;
- a worded gate has no tell that hints at it;
- a false statement has no reachable clue that takes it back, or is reached
  only after one;
- a conclusion cannot be reached;
- a suspect has no clearing conclusion;
- the culprit conclusion has no route within the turn budget without a bluff;
- a spot, or a location's plain search, holds more than one clue;
- the `after` links form a cycle.

Both checks count a statement taken back, so holding more never closes a way
in; a retraction's effect in play is the engine's. A subject
tell counts as reached once its character is met.

## Turn cost

The route check uses the game's costs (`docs/game.md`):

| Action | Turns |
|---|---|
| Move to another location | 1 |
| Search: the plain search or one spot | 1 |
| Start talking to a character at the current location | 1 |
| Each line while talking | 0 |

A conversation yields every clue of that character whose way of being reached
is held; to use a clue found later, talk again. A talk started on the budget's
last turn gives only the greeting (first words and tells seen with them),
because the accusation follows at once. The check fails when the fewest turns
exceed `time_budget`.
