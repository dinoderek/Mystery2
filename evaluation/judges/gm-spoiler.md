---
id: gm_spoiler
label: Spoiler discipline
tier: 1
---

# Spoiler discipline

## What this dimension asks

Before the accusation, did the game master **give away the answer**?

The mystery only works if the player deduces it. Ground truth — who did it, why,
and how — is authored in `ground_truth` and in the culprit's `actual_actions`,
and the player is supposed to reconstruct it from clues. This dimension catches
the game master short-circuiting that.

A mechanical check (`spoiler_leak`) already catches long **verbatim** copying of
ground-truth text. That check is deliberately blunt and high-precision. Your job
is what it cannot see: **paraphrase, implication, and confirmation.**

## Inputs

- `blueprint.ground_truth` — `what_happened`, `why_it_happened`, `timeline`.
- `blueprint.world.characters[]` — `is_culprit`, `motive`, and each character's
  `actual_actions` (what they really did, as opposed to `stated_alibi`).
- `blueprint.solution_paths` — the reasoning the player is meant to assemble.
- `subject.turns` — each with `is_accusation_phase`. **Only turns where
  `is_accusation_phase` is false can carry findings**: once the endgame begins,
  discussing the solution is the point.

## Judge instructions

For each judged, pre-accusation turn, ask what a player would *know* after
reading it that they should have had to earn.

1. **Culprit disclosure** (`kind: "culprit"`). The narration identifies or
   effectively confirms who did it — naming them, or asserting guilt in a way
   that removes doubt ("you can be sure it was Dorn"). `major`.
2. **Motive disclosure** (`kind: "motive"`). `why_it_happened` is stated as
   fact rather than left to be inferred. `major`.
3. **Mechanism disclosure** (`kind: "mechanism"`). `what_happened` or the
   `timeline` is retold as established fact — how the crime was actually done,
   in what order. `major`.
4. **Hidden action disclosure** (`kind: "hidden_action"`). A culprit's or
   suspect's `actual_actions` entry is narrated as what really happened, when
   the player has not earned that. Note the distinction that matters most here:
   a character *claiming* something is fine even when it is a lie; the narrator
   asserting the true version is the leak. `major`.
5. **Deduction handed over** (`kind: "deduction"`). The game master does the
   player's reasoning for them — chaining known clues into the conclusion, or
   telling the player which suspect to stop considering, when no authored
   elimination path was earned. `major` when it lands on the culprit; `minor`
   when it merely over-summarizes clues the player already has.
6. **Confirmation** (`kind: "confirmation"`). The player guesses or asserts a
   solution element and the game master confirms it as true outside the
   accusation phase — including by a narrator aside, or a character conceding
   something the fiction has not earned. `major`.

Severity floor: if the player could act on the leak to skip real investigation,
it is `major`. If it only narrows the field slightly or restates what they
already hold, it is `minor`.

## Not findings

- Delivering an **authored clue** — clues are meant to be found, and their
  content is not a spoiler even when it points hard at the culprit. If the
  concern is that a clue moved too early, that is `gm_clue_discipline`.
- A character lying, deflecting, or defending a false alibi.
- Tension, foreshadowing, suspicion, or a character voicing their own
  (unreliable) theory about someone else.
- The narrator restating what the player already discovered, without adding a
  conclusion.
- Anything in a turn where `is_accusation_phase` is true.

## Output

```json
{
  "findings": [
    {
      "sequence": 5,
      "severity": "major",
      "kind": "culprit" | "motive" | "mechanism" | "hidden_action" | "deduction" | "confirmation",
      "quote": "Short verbatim span from that turn's narration.",
      "why": "Which ground-truth element it gives away, and what the player no longer has to work out.",
      "refers_to": "ground_truth.why_it_happened"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One short paragraph."
}
```

`verdict` is `"fail"` if and only if at least one finding is `major`.
