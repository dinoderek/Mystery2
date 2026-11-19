---
id: clue_graph
label: Clue graph
tier: 2
---

# Clue graph

## What this dimension asks

A clue's optional `requires` (`{ kind, clue_ids, rationale, target? }`) keeps it
undiscovered until every listed clue is held, so each reasoning path is a small
**mini-mystery graph**: ungated entry clues unlocking follow-ons to the payoff.
Each lock says why it exists:

- `pointer`: a prerequisite tells the player where to look or what to raise.
  For a location clue, `target` is its sub-location.
- `leverage`: a character gives the clue only once shown a prerequisite.

Code already guarantees the decidable facts: references are real, the graph is
acyclic, no solution clue is unreachable, and a location lock's target is pointed
to by id. **Do not re-litigate those.** This judge asks: *is the gating fair, and
does each lock's kind fit its fiction?*

## Judge instructions

Reconstruct the discovery graph from each clue's `requires.clue_ids` (clues sit
in `world.locations[].clues`, `world.locations[].sub_locations[].clues` and
`world.characters[].clues`). For each path in `solution_paths`, `red_herrings`
and `suspect_elimination_paths`, consider only its clues and judge:

1. **graph_is_sensible** — prerequisites genuinely set up what they unlock.
2. **is_one_giant_chain** — true if the path is one long brittle line with one
   entry; branchy, shallow graphs are healthier.
3. **creates_dead_end** — true if the thread leaves the player stuck.
4. **has_ungated_entry** — true if at least one clue in the path has no `requires`.

Then judge two blueprint-wide qualities:

- **rationales_are_concrete** — each `requires.rationale` is a concrete in-fiction
  reason, not templated ("needed to progress").
- **gating_creates_momentum** — unlocking points the player somewhere new, not
  busywork. Most clues should be ungated.

Give one **locks** entry per clue with a `requires`, reading the prerequisite as
the player would. `fits_its_kind` is false, with a `problem`, when:

- `no_fitting_reason`: a `pointer` on a clue lying in plain view in its spot,
  such as "you only think to look" on an ordinary object (a targeted search
  finds it; leave it ungated); or a `leverage` lock gives the character no
  reason to hold out.
- `does_not_point`: a `pointer` whose prerequisite never suggests the spot or
  topic in the fiction, though the ids line up.
- `busywork`: the lock fits its kind but is a chore with no discovery.

Otherwise `fits_its_kind` is true and `problem` is `"none"`.

## Verdict

Set `verdict` to `"fail"` if any path is a dead-end, lacks an ungated entry or is
an unmotivated giant chain, if rationales are not concrete, if gating is busywork,
or if any lock does not fit its kind. Otherwise `"pass"`. A blueprint with no
gated clues passes.

## Output

```json
{
  "mini_mysteries": [
    {
      "path_id": "<path id>",
      "group": "solution" | "red_herring" | "suspect_elimination",
      "graph_is_sensible": true,
      "is_one_giant_chain": false,
      "creates_dead_end": false,
      "has_ungated_entry": true,
      "reasoning": "Short explanation."
    }
  ],
  "locks": [
    {
      "clue_id": "<clue id with a requires>",
      "kind": "pointer" | "leverage",
      "fits_its_kind": true,
      "problem": "none" | "no_fitting_reason" | "does_not_point" | "busywork",
      "reasoning": "Short explanation."
    }
  ],
  "rationales_are_concrete": true,
  "gating_creates_momentum": true,
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph tying the verdict to the paths above."
}
```
