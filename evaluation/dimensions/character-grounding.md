---
id: character_grounding
label: Character grounding (anti-hallucination)
tier: 1
---

# Character grounding (anti-hallucination)

## What this dimension asks

Does each character have **enough authored material** that the runtime GM does
not need to invent facts when probed? A thin character (sparse `background`,
empty `flavor_knowledge`) invites fabrication. This also checks that a
self-protect agenda's reactions concede no more than their clues show.

## Judge instructions

Probe topics are supplied under `probe_topics` (in `./context.json` in the judge
workspace): the **same baseline for every character in every mystery**, not
story-specific. Use each topic string verbatim. They cover a character's
background, likes and dislikes, personality, attitude, appearance, and knowledge
of the others, the locations and the mystery.

For each character in `world.characters`, simulate a player asking each probe
topic, and decide whether a competent game-master could answer without inventing:

- **`grounded`** — `background`, `personality`, `actual_actions`,
  `flavor_knowledge` and `clues` give enough to answer specifically.
- **`thin`** — the GM would have to extrapolate or invent (e.g., "I assume
  she gets up early but it's not actually said").
- **`absent`** — no authored material at all on this topic; the GM must
  fabricate.

A character "passes" if **no probe topic is `absent`** and **at most one** is
`thin`.

## Reactions

A self-protect agenda lists `parts`, `{ clue_ids, shows, reaction }`: the clues
that break the cover (any one is enough), what they prove, and what the
character concedes. For each part of each such agenda, judge
`concedes_only_what_clue_shows`: the `reaction` admits what each clue's text and
`shows` establish, nothing more (not walking, motive or guilt from a clue that
shows only prints). Characters with no such agenda have no entry.

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
  "reactions": [
    {
      "character_id": "...",
      "clue_ids": ["..."],
      "concedes_only_what_clue_shows": true,
      "note": "..."
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph. 'pass' iff every character passes and every reaction concedes only what its clue shows."
}
```
