---
id: solve_depth
label: Solve depth
tier: 1
---

# Solve depth

## What this dimension asks

Two things, in one pass:

1. **Is the mystery solvable at all?** Does at least one `solution_path`
   actually let a player identify the character with `is_culprit: true` and
   reach `ground_truth.what_happened`? (This is the old **solvability** check,
   which this dimension supersedes.)
2. **Is it solvable too easily?** What is the *shortest* route to a confident
   accusation — the fewest distinct clues a player must gather before the
   culprit is no longer in doubt — and is that at least `min_clues`?

A mystery that can be cracked from one or two clues is "too easy": the player
names the culprit before doing any real detective work. This dimension fails
such a blueprint even when it is perfectly solvable and fair.

## Path length

The **length** of a solution path is the number of distinct clues a player
genuinely *needs* from that path to become confident of the culprit — not the
number of clue ids the author happened to list.

Measuring it requires judgment: the same judgment the runtime narrator applies
when a player reasons out loud. Count the *minimal sufficient subset*, not the
authored array:

- If a single clue all but names the culprit — an eyewitness who describes a
  trait unique to one suspect, the stolen item hidden in one suspect's own
  space, the only suspect caught in a disprovable lie — then that clue alone is
  the minimal set and the length is **1**, no matter how many corroborating
  clues the path also cites. Corroboration a player does not need does not add
  to the length.
- A clue only adds to the length if, without it, a reasonable child at
  `metadata.target_age` would still be genuinely unsure which suspect did it.

So a path the author wrote with five clue ids can have an effective length of 1
if four of them are redundant confirmation. That collapse is exactly the
failure this dimension exists to catch.

## Judge instructions

The floor is `min_clues` in the per-spec context (a positive integer; if it is
absent, use 3).

For **each** entry in `solution_paths`:

1. Read every clue text the path cites (`location_clue_ids` and
   `character_clue_ids`; look them up in `world.locations[].clues`,
   `world.locations[].sub_locations[].clues`, and `world.characters[].clues`),
   plus the culprit's `actual_actions` and `ground_truth`.
2. Decide whether the path actually reaches the culprit (`reaches_culprit`). If
   it cannot identify the culprit from its own clues, set
   `reaches_culprit: false`, `necessary_clues: []`, `length: 0`.
3. If it reaches the culprit, find the **smallest subset of its clues** that
   still leaves a target-age player confident of the culprit. List that subset
   in `necessary_clues` (real clue ids) and set `length` to its size. In
   `reasoning`, call out any single clue that on its own nearly gives the
   culprit away.

Then aggregate:

- `solvable`: `true` iff at least one path has `reaches_culprit: true`.
- `min_length`: the smallest `length` among paths that reach the culprit
  (`0` if none do).
- `shortest_path_id`: the id of that shortest reaching path (`null` if none).
- `min_required`: echo the floor you applied.
- `verdict`: `"pass"` iff `solvable` is `true` **and**
  `min_length >= min_required`. Otherwise `"fail"` — use `reasoning` to say
  whether it failed for being unsolvable or for being too easy, and which clue
  collapses the shortest path.

This dimension is about *length*, not uniqueness or payoff: whether the
shortest route is the only valid route is fairness's job; whether each route
rewards the player is path payoff's job.

## Output

Return JSON with this shape:

```json
{
  "paths": [
    {
      "id": "<solution_path id>",
      "reaches_culprit": true,
      "necessary_clues": ["<clue id>", "..."],
      "length": 2,
      "reasoning": "Smallest clue set that identifies the culprit, plus any near-spoiler clue."
    }
  ],
  "solvable": true,
  "shortest_path_id": "<id of shortest reaching path, or null>",
  "min_length": 2,
  "min_required": 3,
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph. 'pass' iff solvable and min_length >= min_required."
}
```
