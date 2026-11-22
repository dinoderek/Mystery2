---
id: cg_character_grounding
label: Character grounding
tier: 1
---

# Character grounding

## What this dimension asks

Does each character fit who they are and what they did?

Read each character's `role`, `location`, `personality`, `demeanor` lines,
`knows`, `appearance`, and the clues they are the source of, against
`truth.timeline` and `truth.motive`.

1. **Knowledge.** Each of their statements and `knows` facts is something they
   could have seen, done or learned, given where the timeline puts them. A
   false statement is a lie they have a reason to tell.
2. **Personality and demeanor.** Their personality allows what the timeline
   has them do, and why. Each demeanor line fits that stance for this person:
   `guarded` while they hide something, `shaken` once caught out, `cornered`
   before a confession, `cleared` after.
3. **Appearance.** It fits what they did: it does not contradict the evidence
   or the timeline (what they wear, carry or leave behind), and does not show
   what a gated clue reveals.
4. **Tells.** Each tell is something this person would do, given what they
   hide.
5. **Role.** The `culprit` did the deed in the timeline; a `suspect` falls
   under suspicion and is innocent; a `witness` is neither.

Not a fault: a stance with no demeanor line, or a fact left out. Whether a
statement agrees with the timeline, and whether a `knows` fact gives away a
gated clue, are truth agreement's questions.

## Findings

- `could_not_know` (major): a statement or `knows` fact the character could not
  have seen, done or learned.
- `out_of_character` (major): personality, a demeanor line or a tell
  contradicts what they did or why.
- `appearance_conflict` (major): appearance contradicts the evidence or the
  timeline, or shows a gated clue.
- `role_mismatch` (major): the role disagrees with the timeline.
- `thin` (minor): nothing is wrong, but the character gives the narrator too
  little to play them by.

Each finding's `ids` name the character and the clues involved.

## Output

`characters` holds every character once: `fits` is false when a major
finding names them. Then the findings, the verdict (`fail` iff a finding is
major) and one short paragraph of reasoning.
