---
id: clue_graph
label: Clue graph
tier: 2
---

# Clue graph

## What this dimension asks

Clues can be gated behind other clues: a clue's optional `requires` object
(`{ clue_ids, rationale }`) means it cannot be discovered until every listed clue
has been discovered. This turns each reasoning path into a small **mini-mystery
graph** — a few ungated entry clues that unlock follow-on clues leading to the
path's payoff.

A deterministic analyzer already guarantees the hard, code-decidable facts: every
`requires` reference is real and non-self, the graph is acyclic, and no
solution-path clue is locked behind something unreachable. **Do not re-litigate
those.** This judge asks the qualitative question the analyzer cannot: *is the
gating fun and fair?*

## Judge instructions

Reconstruct the discovery graph yourself from each clue's `requires.clue_ids`
(look clues up in `world.locations[].clues`, `world.locations[].sub_locations[].clues`,
and `world.characters[].clues`). For each reasoning path in `solution_paths`,
`red_herrings`, and `suspect_elimination_paths`, consider only the clues it
references and judge:

1. **graph_is_sensible** — the gating within this mini-mystery makes narrative
   sense: prerequisites genuinely set up the clues they unlock (the player learns
   *where* to look or *how* to get someone to talk), rather than arbitrary locks.
2. **is_one_giant_chain** — true if the path is a single long brittle line
   (discover A → only then B → only then C …) with no branching and one entry.
   Branchy, shallow graphs (depth 2–3, several roots) are healthier; flag a path
   that is essentially one forced sequence.
3. **creates_dead_end** — true if following this thread leaves the player stuck
   with no discoverable next step (e.g. every follow-on clue is gated behind a clue
   the player cannot get within this thread).
4. **has_ungated_entry** — true if at least one clue in the path has no `requires`,
   so the thread is startable.

Then judge two blueprint-wide qualities:

- **rationales_are_concrete** — each `requires.rationale` is a concrete in-fiction
  reason, and plausibly signals whether cleverness could substitute (a social or
  knowledge gate a sharp question might bypass, vs. a hard physical gate). Vague or
  templated rationales ("needed to progress") fail this.
- **gating_creates_momentum** — across the blueprint, unlocking a gated clue points
  the player somewhere new, rather than imposing busywork. Most clues should be
  ungated; gating should reward investigation.

## Verdict

Set `verdict` to `"fail"` if any path is a dead-end, lacks an ungated entry, or is
an unmotivated giant chain, or if rationales are not concrete, or if gating is
busywork rather than momentum. Otherwise `"pass"`. A blueprint with no gated clues
at all trivially passes (it is simply ungated).

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
  "rationales_are_concrete": true,
  "gating_creates_momentum": true,
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph tying the verdict to the paths above."
}
```
