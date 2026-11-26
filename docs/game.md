# The game

A children's text mystery that makes reading and writing a challenge worth
taking: explore, question, find clues, accuse before time runs out. Player-facing
contract; prompts: `docs/ai-runtime.md`, screens: `docs/ui.md`.

## Who is who

- **The investigator** is the child, typing commands.
- **The narrator** is the AI: it describes, speaks as each character,
  judges what searches and questions earn, never contradicting the blueprint.
- **The blueprint** is the case: who did what, why, and where the clues are
  ([clue graph](clue-graph.md)).
- **The turn budget** (`metadata.time_budget`) bounds the investigation.
- **The reading age** narration is written for is the profile's: chosen at
  creation, changed on the settings page, read on every request, so a change
  reaches the next line; each narrated event records it. A profile from before
  it was required is asked for one before its next game.

## Starting a case

The player picks a mystery, each listed with a line narrated at their age.
The opening appears on a page of its own with a line pointing to the notebook, and waits for a keypress or tap; the narrator then
describes arrival at the starting location.

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
| `help` | Help | 0 |
| `quit`, `exit` | Leave the case | — |

At zero turns, the action that spent the last one still resolves; then the game
moves into the accusation and stays: `back` is refused, and each failure asks
again.

Parsing is strict: an unknown command gets a friendly error and the list of
what is possible; `help` always works.

## Talking

The character answers only from what the case gives them, and says plainly
when they do not know. They remember earlier questions in the same game.

While talking, every line is said to the character except the end-talk words,
`help`, `quit`/`exit` and `notebook`/`n`. That includes
`accuse …`: "I think you took it!" is said to the suspect's face and answered in
character. To accuse, say `bye` first.

Some of what a character knows is gated. They hold it back until the player
does what the gate asks: uses its clues in the conversation, not merely holds
them, or takes its line of questioning. A convincing bluff can stand in, unless
the gate is physical. Accusing them earns nothing. A statement given up may
take back what they said before, and the notebook marks it taken back
([clue graph](clue-graph.md)).

## Searching

Each location has clues in the place itself and in two to four named spots
("under the desk"), some holding none. Spots are mentioned on arrival so the
player knows what to look at, except a hidden one, unmentioned until a clue
points to it.

- `search` searches the place itself; `search <anything>` searches the spot it
  names, judged with a game master's leeway. Each search gives at most one
  clue, and a nonsensical one costs no turn.
- A hidden spot cannot be found before its clue is held: words that fit it find
  nothing until then.
- Once everything is found, searches still narrate but reveal nothing new.

## Moving

Arrival describes the place and who is there. The description stays consistent
across visits, and a return visit is acknowledged. Moving describes; searching
discovers — the two stay separate.

## The notebook

A full-screen overlay, free in every mode, with four sections:
**Story** (the opening, as narrated), **Places** (where everyone is),
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
is wrong or still missing without confirming any name, and returns to
exploring. The third failure loses the case, with a gentle reveal of what
happened.

## When a case ends

After a win, loss or `quit`, input gives way to `[ NOTEBOOK ]` and
`[ MYSTERY LIST ]`; `Tab` reviews the notebook and any other key goes back to
the list. Finished cases reopen read-only.
