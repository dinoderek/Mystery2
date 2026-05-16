---
id: fairness
label: Fairness / convergence
tier: 1
---

# Fairness / convergence

## What this dimension asks

Does the evidence in the blueprint **uniquely** point at the culprit?

A mystery can be solvable (some path leads to the truth) but unfair: the same
evidence reasonably supports a non-culprit. This dimension catches that case.

## Judge instructions

1. Identify every non-culprit character (`is_culprit === false`).
2. For each non-culprit, ask: "Given **all** clues a thorough investigator
   could collect — every entry in `world.locations[].clues`,
   `world.locations[].sub_locations[].clues`, and
   `world.characters[].clues` — would a reasonable child at
   `metadata.target_age` find this non-culprit roughly *as* plausible a
   suspect as the actual culprit?"
3. For that question to receive "no", there must be at least one piece of
   evidence — typically referenced in `suspect_elimination_paths` — that
   actively rules the non-culprit out. Motive alone is not elimination; an
   apparent motive that's never disproven is a fairness failure.

Particularly look for:

- A non-culprit suspect whose `motive` is described but never countered by a
  clue.
- A non-culprit suspect whose `stated_alibi` is never contradicted *and*
  never confirmed, leaving them in equipoise with the culprit.
- A culprit whose evidence is identical in structure to a non-culprit's
  (same kind of clue, same kind of opportunity) without a distinguishing
  piece of evidence.

## Output

```json
{
  "non_culprits": [
    {
      "character_id": "...",
      "ruled_out": true,
      "ruling_evidence": "Brief description of the clue(s) that rule them out, or null.",
      "reasoning": "Short note on why they are or are not properly excluded."
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph. 'pass' iff every non-culprit is actively ruled out by discoverable evidence."
}
```
