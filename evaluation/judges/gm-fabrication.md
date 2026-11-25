---
id: gm_fabrication
label: Fabrication / world grounding
tier: 1
---

# Fabrication / world grounding

## What this dimension asks

Did the game master **invent material facts the case does not support**?

Every concrete claim the game master makes about the world — who was where,
what a character did or knows, what a clue says, how the crime happened — must
be grounded in the case.

Scope boundaries with the rest of this battery:

- A character behaving unlike their authored self is `gm_roleplay`.
- A clue moving at the wrong time, or a reveal or notebook line not matching
  its clue, is `gm_clue_discipline`.
- A secret given away early is `gm_spoiler`.
- A character speaking from another's clue or `knows` is `gm_roleplay`'s
  and `gm_clue_discipline`'s, not an invention.
- **Here**: the world gained a fact the case does not hold, or a stated fact
  contradicts one it does.

## What is authored

Every clue's `fact`, `blueprint.truth.timeline` and `truth.motive`,
`blueprint.opening.facts`, each location's `name`, `facts` and spot names, and
each character's `name`, `personality`, `demeanor` lines, `appearance` and
`knows`. A false statement (`truth: false`) is authored too: a character
telling it is correct, not an invention. The narrator asserting it as fact is
an invention.

## Judge instructions

1. The narrator words these facts and may invent scenery and manner: weather,
   a smell, a sound, a gesture. Walk the judged turns in order and check each
   narration's concrete claims against the whole case, not only the clues
   already out.
2. Invention is a fault only when it could mislead the investigation, or when
   it contradicts the case or what earlier narration established. It misleads
   when it looks like evidence or bears on who, when or where: a mark, an
   object to examine, a time, a sighting, a person, a place to search. For an
   invention, the test is: **could a player act on this?**
   - **People** (`kind: "person"`) — no character the case lacks; no character
     placed where the case contradicts; no weighty invented relationship.
   - **Places and objects** (`kind: "place"` / `"object"`) — a room or
     searchable object the case lacks, or an object moved from where the case
     or earlier narration put it. Moving
     the investigator when the turn moved no one (only a `move` or `ambience`
     does), or putting them inside or outside against the location's `facts`
     ("You walk back out into the rain" from a warm bakery), is `place`.
   - **Events** (`kind: "event"`) — what happened, when, and in what order.
   - **Contradiction** (`kind: "contradiction"`) — a claim that conflicts with
     the case, or with something the game master itself established in an
     earlier turn.
3. **Saying "I don't know."** A character asked about something that bears on
   the case, outside their own clues and `knows`, says plainly that they do
   not know. An answer, a guess, or words that point at who, when or where
   are an invention (`event` or `person`). Manner is not an answer: a pause
   or a glance drawn from the character's `demeanor`, `personality` or a tell
   already out, beside a plain "I don't know", is correct. So is a character
   holding back a clue of their own that is not yet out.
4. **The closing scene** (`graph_ending`) is judged against `truth.timeline`,
   `truth.motive` and the culprit conclusion: a step told wrong, or added, or
   any contradiction, is a finding.
5. Severity: a misleading invention is `major`, and so is any contradiction of
   the case or of earlier narration, even of scenery (a person or object shown
   where the case puts it elsewhere), since the player can no longer trust
   what they were shown.
   Embellishment that strays past the text but leads nowhere is `minor`.

Do not penalize player-facing uncertainty or declining to reveal.

## Output

```json
{
  "findings": [
    {
      "sequence": 7,
      "severity": "minor" | "major",
      "kind": "person" | "place" | "object" | "event" | "contradiction",
      "quote": "Short verbatim span from that turn's narration.",
      "why": "Which case fact it invents or contradicts, with the grounding detail.",
      "refers_to": "greenhouse"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One short paragraph."
}
```

`verdict` is `"fail"` if and only if at least one finding is `major`. Minor
colour does not fail.
