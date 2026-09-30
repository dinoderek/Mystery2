# The game

A text mystery for children that makes reading and writing feel like a
challenge worth taking: explore, ask questions, find clues, and accuse someone
before time runs out.

This doc is the player-facing contract. How the narrator is prompted is
`docs/ai-runtime.md`; what the screens look like is `docs/ui.md`.

## Who is who

- **The investigator** is the child. They type commands and build a theory.
- **The narrator** is the AI. It describes places, speaks as each character,
  and judges searches and the accusation. It must never contradict the
  blueprint.
- **The blueprint** is the case: what happened, who did what and why, and
  where the clues are. Its schema, and the intent behind each field, is
  `packages/shared/src/blueprint-schema-v2.ts`.
- **The turn budget** (`metadata.time_budget`) keeps the investigation finite.

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
| `accuse [statement]` | Start the accusation | 0 |
| `notebook`, `n`, `Tab` | Open the case notebook | 0 |
| `locations`, `characters` | Open the notebook at Places or People | 0 |
| `help`, `themes`, `theme <name>` | Help; change colours | 0 |
| `quit`, `exit` | Leave the case | — |

When the budget reaches zero, the action that spent the last turn still
resolves; then the game moves straight into the accusation.

Parsing is strict so the rules stay simple: an unknown command gets a friendly
error and the list of what is possible, and `help` always works.
<!-- /extract:commands -->

## Talking
<!-- extract:talking -->

The character answers only from what they know, what they are willing to say,
what they were really doing, and any deception the blueprint gives them. They
remember earlier questions in the same game.

While talking, every line is said to the character except the end-talk words,
`help`, `quit`/`exit`, `notebook`/`n` and the theme commands. That includes
`accuse …`: "I think you took it!" is said to the suspect's face and answered in
character. To accuse, say `bye` first.

A character clue can be gated behind other clues. The character normally
withholds it until the player has found them, but the narrator may give it up
early for a genuinely clever question or a convincing bluff — only when the gate
is social or about knowledge, never physical. Such a reveal counts as a real
discovery, so a clever player is never stuck.
<!-- /extract:talking -->

## Searching
<!-- extract:searching -->

Each location has at most one clue found by a plain `search`, and two to four
named sub-locations ("under the desk"), each holding at most one clue. Some
hold none. Sub-locations are mentioned on arrival so the player knows what to
look at.

- `search` reveals the location's clue, then hints at sub-locations still
  worth searching.
- `search <anything>` is judged by the narrator against the sub-locations with
  a game master's leeway; a creative description can match. A miss earns a
  hint, and a nonsensical attempt costs no turn.
- Search gates are hard: a clue whose prerequisites are not yet found cannot be
  revealed by searching. A plain search skips it rather than dead-ending.
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

The narrator sets the scene; the investigator says who did it and why. The
accusation is accepted when the investigator names the true culprit **and**
either:

- backs it with a chain of clues they actually discovered that follows one of
  the blueprint's solution paths, or
- correctly tells what happened: culprit, key events, motive.

Confronting the accused can earn a confession, but only when most of the facts
are already right. A lucky guess with no reasoning is not a win.

A wrong or thin accusation gets encouragement and a question pointing at what
kind of fact is missing. From the third round a still-failing accusation ends
the case as a loss, with a gentle reveal. Either way the explanation must agree
with the timeline, alibis, clue placement and motives.
<!-- /extract:accusation -->

## When a case ends

After a win, a loss or `quit`, input is replaced by
`Tab: review notebook · any other key: back to the mystery list`. Finished
cases can be reopened read-only from the completed list.
