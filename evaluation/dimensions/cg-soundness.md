---
id: cg_soundness
label: Soundness
tier: 1
---

# Soundness

## What this dimension asks

Does each conclusion follow from the facts its rule names?

The player works a conclusion out from clues they hold, and the rule says
which: an `all` group needs every part, `any` gives alternative branches. A
part that is a conclusion stands for that conclusion's text. Judge each branch
on its own: would a careful child holding only those facts be right to
conclude the text?

## How to judge

For each conclusion:

1. Find its point: that this person did it (`culprit`), that this suspect
   could not have (`clears`), the innocent explanation (`resolves`), or else
   the text's main claim.
2. For each branch, read the facts of the clues it names, as the player hears
   them, and ask whether they establish the point.
3. Record it in `conclusions`, once per conclusion.

Sound reasoning includes:

- Inference a child can follow: a time that rules someone out, an object only
  one person has, a place only one person was.
- Elimination: a branch that clears every other suspect through a conclusion
  it names, or ties the evidence to the one person who fits, may name the
  culprit. The player knows the cast, where each of them is and how they look.
- A statement counts as what it claims. A conclusion resting on a false
  statement is the game working when it follows from what the statement says:
  the case takes the statement back later.

Facts outside the rule, which the player may also hold, do not rescue a branch.

## Findings

- `does_not_follow` (major): a branch's facts do not establish the point; a
  child holding them would be guessing, or would conclude something else.
- `wrong_target` (major): the text, or what the facts establish, names someone
  other than the conclusion's `clears` or `culprit`.
- `says_more` (minor): the point follows, but the text adds detail (how, when,
  why) that no named fact gives.

Each finding's `ids` name the conclusion and the clues at fault.

## Output

`conclusions` holds every conclusion once: `follows` is `no` when any branch
fails, `partly` when only detail overreaches, else `yes`. Then the findings,
the verdict (`fail` iff a finding is major) and one short paragraph of
reasoning.
