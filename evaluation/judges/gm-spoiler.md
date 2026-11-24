---
id: gm_spoiler
label: Spoiler discipline
tier: 1
---

# Spoiler discipline

## What this dimension asks

Before the closing scene, did the game master **give away the answer**?

The mystery only works if the player deduces it. The secrets are
`blueprint.truth.timeline`, `truth.motive`, every conclusion's `text` (the
culprit conclusion names who did it) and every false statement's `why`. A
conclusion is never shown to the player; they reach it from clues. This
dimension catches the game master short-circuiting that.

A mechanical check (`spoiler_leak`) already catches long **verbatim** copying of
secret text. That check is deliberately blunt and high-precision. Your job is
what it cannot see: **paraphrase, implication, and confirmation.**

## Inputs

- `blueprint.truth`, `blueprint.conclusions`, and the clues: a false
  statement's `why`, and which gated statements are the culprit's confession.
- `subject.turns` — each with `is_accusation_phase`. **Only turns where
  `is_accusation_phase` is false can carry findings**: it is true only for the
  closing scene (`graph_ending`), which tells the solution and is never a
  spoiler. A failed accusation's reply (`graph_accusation_round`) is judged as
  any other turn.

## Judge instructions

For each judged turn before the closing scene, ask what a player would *know*
after reading it that they should have had to earn.

1. **Culprit disclosure** (`kind: "culprit"`). The narration identifies or
   effectively confirms who did it — naming them, or asserting guilt in a way
   that removes doubt ("you can be sure it was Dorn"). `major`.
2. **Motive disclosure** (`kind: "motive"`). `truth.motive`, or a false
   statement's `why`, stated as fact rather than left to be inferred. `major`.
3. **Mechanism disclosure** (`kind: "mechanism"`). A step of `truth.timeline`
   — what someone really did, how the crime was done, in what order — narrated
   as established fact. A character *claiming* something is fine, even when it
   is false; the narrator asserting the true version is the leak. `major`.
4. **Deduction handed over** (`kind: "deduction"`). The game master does the
   player's reasoning — chaining held clues into a conclusion, or telling the
   player which suspect to stop considering, when the player holds no clue
   that clears them. `major` when it lands on the culprit; `minor` when it
   merely over-summarizes clues the player already has.
5. **Confirmation** (`kind: "confirmation"`). The player guesses or asserts a
   solution element and the game master confirms it before the closing scene:
   a narrator aside, or a failed accusation's reply confirming the accused name
   or the culprit. `major`. A character's unearned concession is
   `gm_roleplay`'s.

A secret is never a clue: a clue, a confession included, coming out before
its gate opened is `gm_clue_discipline`'s, not a leak.

Severity floor: if the player could act on the leak to skip real investigation,
it is `major`. If it only narrows the field slightly or restates what they
already hold, it is `minor`.

## Not findings

- Delivering a clue that was offered and recorded — clues are meant to be
  found, even when they point hard at the culprit. A clue released too early
  is `gm_clue_discipline`'s.
- A character telling a false statement, deflecting, or giving a confession
  whose gate has opened: the game working.
- A failed accusation's reply wording the flaw, alternative or missing fact
  the engine chose, from material the player holds.
- Tension, foreshadowing, suspicion, or a character voicing their own
  (unreliable) theory about someone else.
- The narrator restating what the player already discovered, without adding a
  conclusion.

## Output

```json
{
  "findings": [
    {
      "sequence": 5,
      "severity": "major",
      "kind": "culprit" | "motive" | "mechanism" | "deduction" | "confirmation",
      "quote": "Short verbatim span from that turn's narration.",
      "why": "Which secret it gives away, and what the player no longer has to work out.",
      "refers_to": "truth.motive"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One short paragraph."
}
```

`verdict` is `"fail"` if and only if at least one finding is `major`.
