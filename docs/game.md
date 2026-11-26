# The game

A children's text mystery that makes reading and writing a challenge worth
taking: explore, question, find clues, accuse before time runs out. Player-facing
contract; prompts: `docs/ai-runtime.md`; screens: `docs/ui.md`.

## Who is who

- **The investigator** is the child, typing commands.
- **The narrator** is the AI: it describes, speaks as each character,
  judges what searches and questions earn, never contradicting the blueprint.
- **The blueprint** is the case: who did what, why, and where the clues are
  ([clue graph](clue-graph.md)).
- **The turn budget** (`metadata.time_budget`) bounds the investigation.
- **The reading age** is the profile's: chosen at creation, changed in settings
  or by `age <n>` (below), read on every request, and recorded on each narrated
  event. A profile without one is asked for it before its next game.

## Starting a case

The player picks a mystery, each with a line written at their age. The
opening has a page of its own, with a pointer to the notebook, until a
keypress or tap; then the narrator describes arrival at the start.

## Commands and what they cost

| Command | Effect | Turns |
|---|---|---|
| `move to <place>`, `go <place>` | Arrive somewhere; see who is there | 1 |
| `search` | Search the place itself | 1 |
| `search <anything>` | Search a particular spot | 1, or 0 if nonsensical |
| `talk to <name>` | Start a conversation | 1 |
| any line while talking | Ask the character | 0 |
| `bye`, `goodbye`, `see you`, `leave`, `end` | End the conversation | 0 |
| `accuse` | Open the accusation | 0 |
| `accuse <who> because <why>`, or a line in it | One accusation, judged | 0 |
| `back`, `cancel`, `never mind`, `nevermind` | Leave it, spending none | 0 |
| `notebook`, `n`, `Tab` | Open the case notebook | 0 |
| `locations`, `characters` | Open the notebook at Places or People | 0 |
| `age <n>` | Set the reading age, 6 to 11 | 0 |
| `help` | Help | 0 |
| `quit`, `exit` | Leave the case | — |

At zero turns, the action that spent the last one still resolves; then the game
moves into the accusation and stays: `back` is refused, and each failure asks
again.

Parsing is strict: an unknown command gets a friendly error and the commands
possible; `help` always works.

## Changing the age

`age <n>` works in every mode and, like the settings page, sets the profile's
age for all its games. A game whose last recorded age differs saves one
`age_change` line ("From now on, the story is written for age N.") before it
narrates and when it is opened. Earlier text stays as written.

## Talking

The character answers only from what the case gives them, and says plainly
when they do not know. They remember earlier questions in the same game.

While talking, every line is said to the character except the end-talk words,
`age <n>`, `help`, `quit`/`exit` and `notebook`/`n`. That includes `accuse …`:
"I think you took it!" is answered in character. To accuse, say `bye` first.

Some of what a character knows is gated, held back until the player uses its
clues in the conversation, not merely holds them, or takes its line of
questioning. A convincing bluff can stand in, unless the gate is physical.
Accusing them earns nothing. A statement given up may take back an earlier one,
and the notebook marks it ([clue graph](clue-graph.md)).

## Searching

Each location has clues in the place itself and in two to four named spots
("under the desk"), some holding none. Arrival mentions the spots, except a
hidden one, unmentioned until a clue points to it.

- `search` searches the place itself; `search <anything>` searches the spot it
  names, judged with a game master's leeway. Each search gives at most one
  clue, and a nonsensical one costs no turn.
- A hidden spot finds nothing until its clue is held, whatever the words.
- Once everything is found, searches still narrate but reveal nothing new.

## Moving

Arrival describes the place and who is there, consistently across visits, and
acknowledges a return. Moving describes; searching discovers.

## The notebook

A full-screen overlay, free in every mode:
**Story** (the opening as narrated), **Places** (where everyone is),
**People** (everyone met), and **Clues** (everything discovered, a statement
taken back marked so), with leads on what to do next.

Clues are grouped by where they came from, a place or a person, never by the
line of reasoning they serve, which would tell the child which are dead ends.

## The accusation

The investigator says who did it and why, and the engine decides
([rule](clue-graph.md#accusation)): naming the true culprit wins only with
the case to back it, the confession or the culprit's conclusion holding on
what they found, citing one of it. A lucky guess is not a win.

A game has three accusations. A failed one spends one, encourages, says what
is wrong or missing without confirming any name, and returns to exploring. The
third failure loses the case, with a gentle reveal.

## When a case ends

After a win, loss or `quit`, input gives way to `[ NOTEBOOK ]` and
`[ MYSTERY LIST ]`; `Tab` opens the notebook, any other key the list. Finished
cases reopen read-only.
