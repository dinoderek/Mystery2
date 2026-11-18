---
id: gm_fabrication
label: Fabrication / world grounding
tier: 1
---

# Fabrication / world grounding

## What this dimension asks

Did the game master **invent material facts the blueprint does not support**?

Every concrete claim the game master makes about the world — who was where,
what a character did or knows, what a clue says, how the crime happened — must
be grounded in the blueprint. Invented facts mislead the player, can make the
case unsolvable or unfair, and break continuity.

Scope boundaries with the rest of this battery:

- A character behaving unlike their authored self is `gm_roleplay`.
- A clue moving at the wrong time, or a reveal not matching its record, is
  `gm_clue_discipline`.
- Ground truth leaking early is `gm_spoiler`.
- **Here**: the world gained a fact that is not in the blueprint, or a stated
  fact contradicts one that is.

## Inputs

- `blueprint` — the full Blueprint V2 that drove the game: the ground truth.
- `subject.turns` — the turns, each with `judged`, `role_name`, its scope, the
  player's input, and the narration. Only `judged`
  turns can carry findings.

## Judge instructions

1. Read the blueprint to fix the ground truth: locations and their
   `description`s and `sub_locations`, characters (`background`, `personality`,
   `stated_alibi`, `motive`, `clues`, `flavor_knowledge`, `actual_actions`), and
   the clue texts.
2. Walk the judged turns in order. For each narration, check whether its
   concrete factual claims are supported:
   - **People** (`kind: "person"`) — no characters who do not exist; no
     character placed somewhere the blueprint contradicts; no invented
     relationships between characters that carry weight.
   - **Places and objects** (`kind: "place"` / `"object"`) — locations,
     sub-locations, and objects consistent with the authored world. A new room
     the player could investigate, or a searchable object that does not exist,
     is a fabrication; a passing sensory detail is not.
   - **Events** (`kind: "event"`) — what happened, when, and in what order, as
     asserted by the narration.
   - **Contradiction** (`kind: "contradiction"`) — a claim that conflicts with
     the blueprint, or with something the game master itself established in an
     earlier turn. Self-contradiction across turns counts: continuity is part
     of grounding.
   - **Movement and placement** (`kind: "place"`) — moving the investigator
     or a character when the turn moved no one (only a `move` does), or
     putting them inside or outside against the location's `description`:
     ending a talk in the "cozy tea house" with "You step back out into the
     snowy day".
3. Distinguish **fabrication** from acceptable **colour**. Atmospheric flourish
   that adds no load-bearing fact (a creak of floorboards, the weather, a smell
   from the kitchen) is the game master doing its job. A new alibi, a new
   motive, a moved object that matters, a character knowing something they
   cannot know, or a clue that does not exist — those are fabrications.
   The test is: **could a player act on this?** If it would send them
   somewhere, rule someone out, or change what they believe, it is
   load-bearing.
4. Severity: `major` when the invented fact is load-bearing, by step 3's test;
   `minor` for embellishment that strays past the text but leads nowhere.
5. Tie each finding to a turn `sequence`, quote the span, and name the
   blueprint fact it invents or contradicts.

Do not penalize the game master for player-facing uncertainty, for declining to
reveal, or for in-character evasion that the blueprint's deception supports. A
character *lying* is not fabrication — the lie is authored. The narrator
asserting the lie as fact is.

## Output

```json
{
  "findings": [
    {
      "sequence": 7,
      "severity": "minor" | "major",
      "kind": "person" | "place" | "object" | "event" | "contradiction",
      "quote": "Short verbatim span from that turn's narration.",
      "why": "Which blueprint fact it invents or contradicts, with the grounding detail.",
      "refers_to": "loc-garden"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One short paragraph."
}
```

`verdict` is `"fail"` if and only if at least one finding is `major`. Minor
colour does not fail.
