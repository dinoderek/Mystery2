---
id: solve_depth
label: Solve depth
tier: 1
---

# Solve depth

## What this dimension asks

Three things, in one pass:

1. **Is the mystery solvable at all?** Does at least one `solution_path` let a
   player identify the character with `is_culprit: true` and reach
   `ground_truth.what_happened`? (This supersedes the old **solvability** check.)
2. **Is it solvable too easily?** What is the *shortest* route to a confident
   accusation — the fewest distinct clues a player must gather before the
   culprit is no longer in doubt — and is that at least the required floor? This
   is the only **enforced** length check (it applies to the main suspect / the
   culprit).
3. **Does every suspect have a real elimination route?** Each suspect must have
   an authored elimination path, and you **measure** (but do not floor) the
   length of each. A suspect with no elimination path is a coverage gap.

## The floor (`min_required`)

Use, in order of precedence:

1. `story_brief.minPathLength` if present,
2. else `min_clues` from the per-spec context,
3. else `3`.

Echo the value you used into `min_required`. The floor is enforced **only on the
shortest solution path** (`targetPathLength` is a generator hint and is not
judged here).

## Path length

The **length** of a path is the number of distinct clues a player genuinely
*needs* from it to reach its conclusion — not the number of clue ids the author
listed.

Measuring it requires judgment, the same judgment the runtime narrator applies
when a player reasons out loud. Count the *minimal sufficient subset*, not the
authored array:

- If a single clue all but settles the conclusion — an eyewitness who describes
  a trait unique to one character, the stolen item hidden in one suspect's own
  space, the only suspect caught in a disprovable lie, a blanket trait (species,
  role) that clears a suspect outright — then that clue alone is the minimal set
  and the length is **1**, no matter how many corroborating clues the path also
  cites.
- A clue only adds to the length if, without it, a reasonable child at
  `metadata.target_age` would still be genuinely unsure.

Apply this **same minimal-bag estimation** to solution paths and to
suspect-elimination paths alike.

## Judge instructions

**Solution paths.** For each entry in `solution_paths`:

1. Read every clue text it cites (`location_clue_ids` and `character_clue_ids`;
   look them up in `world.locations[].clues`,
   `world.locations[].sub_locations[].clues`, and `world.characters[].clues`),
   plus the culprit's `actual_actions` and `ground_truth`.
2. Decide whether the path reaches the culprit (`reaches_culprit`). If not, set
   `reaches_culprit: false`, `necessary_clues: []`, `length: 0`.
3. If it does, find the **smallest subset of its clues** that still leaves a
   target-age player confident of the culprit. List it in `necessary_clues` and
   set `length` to its size. In `reasoning`, call out any single clue that
   nearly gives the culprit away.

**Elimination paths.** Identify the **suspects** — the characters a player would
reasonably consider as possible culprits (those with apparent motive and
opportunity), excluding the victim and the true culprit. For each entry in
`suspect_elimination_paths`:

1. Determine which suspect it clears (`suspect_id`).
2. Run the **same minimal-bag estimation**: the smallest subset of its clues
   that leaves the player confident this suspect is innocent. Record
   `necessary_clues` and `length`. (These are **measured**, not floored — a
   length-1 elimination is a visible smell but does not by itself fail the
   dimension.)

Then list in `uncovered_suspects` any suspect that has **no** elimination path
ruling them out.

**Aggregate.**

- `solvable`: `true` iff at least one solution path has `reaches_culprit: true`.
- `min_length`: the smallest `length` among solution paths that reach the
  culprit (`0` if none do).
- `shortest_path_id`: the id of that shortest reaching solution path (`null` if
  none).
- `min_required`: the floor you applied (see above).
- `verdict`: `"pass"` iff **all** of: `solvable` is `true`,
  `min_length >= min_required`, and `uncovered_suspects` is empty. Otherwise
  `"fail"` — say in `reasoning` whether it failed for being unsolvable, too easy
  (and which clue collapses the shortest path), or for leaving a suspect with no
  elimination path.

This dimension is about *length and coverage*, not uniqueness or payoff:
whether the shortest route is the only valid route is fairness's job; whether
each route rewards the player is path payoff's job.

## Output

Return JSON with this shape:

```json
{
  "paths": [
    {
      "id": "<solution_path id>",
      "reaches_culprit": true,
      "necessary_clues": ["<clue id>", "..."],
      "length": 3,
      "reasoning": "Smallest clue set that identifies the culprit, plus any near-spoiler clue."
    }
  ],
  "elimination_paths": [
    {
      "id": "<suspect_elimination_path id>",
      "suspect_id": "<character id this clears>",
      "necessary_clues": ["<clue id>", "..."],
      "length": 2,
      "reasoning": "Smallest clue set that clears this suspect."
    }
  ],
  "uncovered_suspects": ["<suspect character id with no elimination path>"],
  "solvable": true,
  "shortest_path_id": "<id of shortest reaching solution path, or null>",
  "min_length": 3,
  "min_required": 3,
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph. 'pass' iff solvable, min_length >= min_required, and no uncovered suspects."
}
```
