---
id: character_grounding
label: Character grounding (anti-hallucination)
tier: 1
---

# Character grounding (anti-hallucination)

## What this dimension asks

Does each character have **enough authored material** that the runtime
narrator/GM AI does not need to invent facts when the player asks
edge-of-knowledge questions?

A character that is thin — sparse `background`, empty `flavor_knowledge`,
one-line `personality` — invites the runtime GM to fabricate when probed.
This dimension catches that risk at authoring time.

## Judge instructions

For each character in `world.characters`, assess whether the available
authored material would let a competent game-master answer plausible player
questions without inventing facts.

Probe topics (loaded from the outcome spec's `context.probe_topics`, or use a
sensible default per the brief if absent):

{{probe_topics_block}}

For each character, simulate: a player walks up and asks each probe topic. For
each topic, decide:

- **`grounded`** — the existing `background`, `personality`,
  `actual_actions`, `flavor_knowledge`, and `clues` give the GM enough
  material to answer specifically and in-character.
- **`thin`** — the GM would have to extrapolate or invent (e.g., "I assume
  she gets up early but it's not actually said").
- **`absent`** — no authored material at all on this topic; the GM must
  fabricate.

A character "passes" if **no probe topic is `absent`** and **at most one** is
`thin`.

## Output

```json
{
  "characters": [
    {
      "character_id": "...",
      "first_name": "...",
      "topics": [
        { "topic": "...", "status": "grounded" | "thin" | "absent", "note": "..." }
      ],
      "passes": true
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph. 'pass' iff every character passes."
}
```
