---
id: gm_fabrication
label: Game-master fabrication / grounding
tier: 1
---

# Game-master fabrication / grounding

## What this dimension asks

While playing the mystery, did the game master **invent material facts that the
blueprint does not support**?

The game master narrates scenes, voices characters, and adjudicates searches and
the accusation. Every concrete claim it makes about the world — who was where,
what a character did or knows, what a clue says, how the crime happened — must be
grounded in the blueprint. Invented facts are the core failure mode: they
mislead the player, can make the case unsolvable or unfair, and break continuity.

This dimension judges the **played transcript**, not the blueprint's own quality
(a separate battery covers that). Assume the blueprint is the ground truth.

## Inputs

The user message contains:

- `blueprint` — the full Blueprint V2 that drove the session (ground truth:
  world, characters, clues, locations, ground truth, paths).
- `turns` — the game master's turns in order. Each turn has the role
  (`role_name`), the player's input, the narration the game master produced,
  the location/character in scope, and the clue ids it revealed.

## Judge instructions

1. Read the blueprint to fix the ground truth: locations and their descriptions,
   characters (their `background`, `personality`, `stated_alibi`, `motive`,
   `clues`, `flavor_knowledge`, `actual_actions`), and the clue texts.
2. Walk the `turns` in order. For each narration, check whether its concrete
   factual claims are supported:
   - Character speech/behavior consistent with that character's authored
     material and what they could plausibly know.
   - Clue content matching the blueprint clue text (no invented clues, no
     altered clue meaning).
   - Locations, objects, and events consistent with the blueprint world.
3. Distinguish **fabrication** from acceptable **color**. Atmospheric flourish
   that adds no load-bearing fact (a creak of floorboards, a description of the
   weather) is fine. A new alibi, a new motive, a moved object that matters, a
   character knowing something they cannot know, or a clue that does not exist —
   those are fabrications.
4. Be concrete. Tie each finding to a specific turn `sequence` and quote the
   offending narration span and the blueprint fact it contradicts or invents.

Do not penalize the game master for player-facing uncertainty, for declining to
reveal, or for in-character evasion that the blueprint's deception supports.

## Output

```json
{
  "findings": [
    {
      "sequence": 7,
      "severity": "minor" | "major",
      "claim": "The narration's fabricated/contradicted claim, quoted or closely paraphrased.",
      "why": "Which blueprint fact it invents or contradicts, with the grounding detail."
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One short paragraph. 'fail' if there is at least one 'major' fabrication; otherwise 'pass'. Minor color does not fail."
}
```
