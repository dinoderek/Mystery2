---
id: solvability
label: Solvability
tier: 1
---

# Solvability

## What this dimension asks

Do the clues referenced by at least one `solution_path` actually entail the
conclusion stated in `ground_truth.what_happened` and the identity of the
character with `is_culprit: true`?

This is the **"is there a valid path"** check. It is *not* the same as
fairness — fairness asks whether the path is *uniquely* valid.

## Judge instructions

For each entry in `solution_paths`:

1. Read every clue text referenced by the path's `location_clue_ids` and
   `character_clue_ids`. The clue texts live in
   `world.locations[].clues`, `world.locations[].sub_locations[].clues`, and
   `world.characters[].clues`.
2. Read each referenced character's `actual_actions` to understand what
   really happened from that character's side.
3. Decide whether the conjunction of those clues — *and only those clues* —
   logically points to the culprit and the events in
   `ground_truth.what_happened`.
4. A path "works" if a reasonable child at `metadata.target_age` who learned
   only those clues could plausibly reach the same conclusion the author
   intended.

A path fails if any of the following are true:

- A required logical step depends on a fact that is nowhere in the cited
  clues (the path is incomplete).
- The cited clues equally support a *different* culprit (this is a fairness
  failure too, but the path is also not solvable as authored).
- The cited clues do not actually mention the culprit, the means, or the
  motive at all.

## Output

Return JSON with this shape:

```json
{
  "paths": [
    {
      "id": "<solution_path id>",
      "works": true,
      "reasoning": "Short explanation of why the path's clues entail the conclusion."
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph overall. 'pass' iff at least one path works."
}
```
