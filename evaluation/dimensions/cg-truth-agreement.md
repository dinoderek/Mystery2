---
id: cg_truth_agreement
label: Truth agreement
tier: 1
---

# Truth agreement

## What this dimension asks

Do the facts the player hears agree with what really happened, in
`truth.timeline` and `truth.motive`?

1. Every evidence fact, and every statement with `truth: true`, agrees with
   the timeline on who, what, where and when.
2. Every statement with `truth: false` disagrees with it, in the way its `why`
   explains, and is not secretly true.
3. Where a false statement is taken back, the gated statement that
   `takes_back` it, or the clues the player shows to open that gate (`use`),
   contradict it, so the player can see why the first claim was false.
4. No `knows` fact, which a character shares freely whenever asked, gives away
   what a gated clue says, or the point of a conclusion, before that gate
   opens.

## How to judge

Read the timeline first: who was where when, and what happened to each
object. Then go through the clues, and every character's `knows`.

Not a fault:

- A fact the timeline does not mention, when it contradicts nothing: an
  opinion, a habit, scenery.
- A time a person would round ("about a quarter past twelve" for 12:12), or a
  witness telling only the part they saw.
- A true statement of a belief, such as "he thought it was the fox", when the
  character believed it.
- A false statement mixing true detail with its lie.
- Anything but clues and `knows`. A conclusion may rest on a false statement
  while it stands: soundness judges conclusions. Appearance, personality and
  demeanor, and whether a character could know a fact, are character
  grounding's.

## Findings

- `contradicts_timeline` (major): evidence or a true statement disagrees with
  the timeline on who, what, where or when.
- `false_is_true` (major): a false statement agrees with the timeline, or its
  `why` does not fit what the character did.
- `retraction_does_not_contradict` (major): neither the taking-back statement
  nor its shown clues contradict the false statement.
- `knows_gives_away` (major): a `knows` fact states what a gated clue, or a
  conclusion, reveals.
- `detail_mismatch` (minor): a small difference from the timeline that changes
  nothing about who, what, where or when.

Each finding's `ids` name the clues, characters or conclusions involved.

## Output

The findings, the verdict (`fail` iff a finding is major) and one short
paragraph of reasoning.
