---
id: path_payoff
label: Path payoff
tier: 2
---

# Path payoff

## What this dimension asks

Does **every** authored reasoning path in the blueprint give the player a
concrete payoff for following it through?

A mystery becomes uninteresting the moment the player realises that one of
the leads they're chasing is going nowhere. Even a false lead should reward
the investigator who pursues it: by eliminating a suspect, surfacing a
contradiction, or disproving the lead itself. A path whose only payoff is
"you wasted some turns" is a path that should not have been authored.

This dimension is distinct from solvability and fairness:

- **Solvability** asks whether at least one path reaches the truth.
- **Fairness** asks whether the truth is the *only* well-supported answer.
- **Path payoff** asks whether every path is worth chasing on its own terms.

## Judge instructions

For each entry in `solution_paths`, `red_herrings`, and
`suspect_elimination_paths`:

1. Note which group the path belongs to (`solution`, `red_herring`, or
   `suspect_elimination`).
2. Read every clue text referenced by `location_clue_ids` and
   `character_clue_ids` (look them up in `world.locations[].clues`,
   `world.locations[].sub_locations[].clues`, and
   `world.characters[].clues`). Read the path's `summary`, `description`,
   and `payoff` if present.
3. Determine the path's payoff. Use the authored `payoff` field if present;
   otherwise derive it from the clues, summary, and description. Record
   which source you used in `payoff_source`.
4. Evaluate the payoff against the per-group standard below. Set `verdict`
   to `"pass"` or `"fail"` and explain in `reasoning`.

### Per-group standards

- `solution`: the payoff is the truth of the mystery — the culprit, the
  motive, or the decisive contradiction that finishes the case. A solution
  path can be marked `"fail"` only if the clues plus summary do not
  actually arrive at any conclusion about the culprit or the events. (This
  overlaps with solvability; payoff is the stricter framing — solvability
  asks "can the player reach the truth?", payoff asks "do they get
  *something* substantive when they do?")
- `red_herring`: the payoff must be a concrete in-world result the player
  can recognise — e.g. "the apparent grudge between X and Y is shown to be
  a misunderstanding", "the locked-room trick is shown to be impossible",
  "suspect Z is cleared because the wrapper that incriminated them is
  shown to predate the crime". A path that merely *exists* without a clear
  disproof or elimination fails.
- `suspect_elimination`: the payoff must name the specific innocent
  character being ruled out **and** the evidence that rules them out. A
  vague "this clears them" without a named suspect or named evidence
  fails.

A path also fails if its payoff is structurally circular ("this path
proves the culprit because the culprit did it") or if the cited clues do
not actually establish the claimed payoff.

## Output

```json
{
  "paths": [
    {
      "id": "<path id>",
      "group": "solution" | "red_herring" | "suspect_elimination",
      "payoff": "Concise statement of what completing this path gives the player.",
      "payoff_source": "authored" | "derived",
      "verdict": "pass" | "fail",
      "reasoning": "Short explanation tying the payoff to the cited clues."
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph. 'pass' iff every path passes."
}
```
