# The game

A children's text mystery that makes reading and writing a challenge worth
taking: explore, question, find clues, accuse before time runs out. Player-facing
contract; prompts: `docs/ai-runtime.md`, screens: `docs/ui.md`.

## Who is who

- **The investigator** is the child, typing commands.
- **The narrator** is the AI: it describes, speaks as each character,
  judges searches and accusations, never contradicting the blueprint.
- **The blueprint** is the case: who did what, why, and where the clues are
  ([V2](../packages/shared/src/blueprint-schema-v2.ts), [clue graph](clue-graph.md)).
- **The turn budget** (`metadata.time_budget`) bounds the investigation.
- **The reading age** narration is written for is the profile's (settings
  page), else the case's `metadata.target_age`, saved when a game starts.

## Starting a case
<!-- extract:starting -->

The player picks a mystery. The premise appears on a page of its own with a
line pointing to the notebook, and waits for a keypress; the narrator then
describes arrival at the starting location.
<!-- /extract:starting -->

## Commands and what they cost
<!-- extract:commands -->

| Command | Effect | Turns |
|---|---|---|
| `move to <place>`, `go <place>` | Arrive somewhere; see who is there | 1 |
| `search` | Reveal the location's next clue | 1 |
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
<!-- /extract:commands -->

## Talking
<!-- extract:talking -->

The character answers only from what they know, what they are willing to say,
what they were really doing, and any deception the blueprint gives them. They
remember earlier questions in the same game.

While talking, every line is said to the character except the end-talk words,
`help`, `quit`/`exit` and `notebook`/`n`. That includes
`accuse …`: "I think you took it!" is said to the suspect's face and answered in
character. To accuse, say `bye` first.

A character clue can be gated behind other clues. The character withholds it
until the player uses them in the conversation, not merely holds them. A
convincing bluff or deduction can stand in, unless the gate is physical. Such a
reveal counts as a real discovery, so a clever player is never stuck.

A suspect's cover gives way only as far as the player has earned it: each piece
of evidence used draws its own concession, and no more. Accusing them earns
nothing, and half the evidence gets half the story, never a confession.
<!-- /extract:talking -->

## Searching
<!-- extract:searching -->

Each location has at most one clue found by a plain `search`, and two to four
named sub-locations ("under the desk"), each holding at most one clue. Some
hold none. Sub-locations are mentioned on arrival so the player knows what to
look at, except a locked one, unmentioned until a clue points to it.

- `search` reveals the location's clue, then hints at sub-locations still
  worth searching.
- `search <anything>` is judged by the narrator against the sub-locations with
  a game master's leeway; a creative description can match. A miss earns a
  hint, and a nonsensical attempt costs no turn.
- Search gates are hard: a clue whose prerequisites are not yet found cannot be
  revealed by searching, and a plain search skips it. A search that names a
  locked spot still finds its clue: working out where to look counts.
- Once everything is found, searches still narrate but reveal nothing new.
<!-- /extract:searching -->

## Moving
<!-- extract:moving -->

Arrival describes the place and who is there. The description stays consistent
across visits, and a return visit is acknowledged. Moving describes; searching
discovers — the two stay separate.
<!-- /extract:moving -->

## The notebook
<!-- extract:notebook -->

A full-screen overlay, free and available in every mode, with four sections:
**Story** (premise and what happened), **Places** (where everyone is),
**People** (everyone met), and **Clues** (everything discovered, including
off-script reveals).

Clues are grouped by where they came from — found at a place, or told by a
person — and never by which line of reasoning they serve. Grouping by reasoning
path would tell the child which of their own clues are dead ends.
<!-- /extract:notebook -->

## The accusation
<!-- extract:accusation -->

The investigator says who did it and why. It wins when they name the true
culprit **and** either:

- back it with discovered clues that follow one of the blueprint's solution
  paths, or
- correctly tell what happened: culprit, key events, motive.

Confronting the accused earns a confession only when most of the facts are
right; a lucky guess is not a win.

A game has three accusations. A failed one spends one, encourages, asks what
kind of fact is missing, and returns to exploring. The third failure loses the
case, with a gentle reveal. Every explanation agrees with the timeline, alibis,
clue placement and motives.
<!-- /extract:accusation -->

A clue-graph case is won by [its own rule](clue-graph.md#accusation).

## When a case ends

After a win, loss or `quit`, input becomes
`Tab: review notebook · any other key: back to the mystery list`. Finished
cases reopen read-only.
