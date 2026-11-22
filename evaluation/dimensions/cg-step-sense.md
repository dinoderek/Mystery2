---
id: cg_step_sense
label: Step sense
tier: 1
---

# Step sense

## What this dimension asks

Would each step lead a child of the case's age (`player_view.target_age`) to
take it, reading only what they hold at that point?

`player_view` is derived from the case by code. `waves` lists the clues by the
earliest point they can be held. `steps` lists each clue the player must do
something to get, by its `way`:

- `ask`: ask the character about `about`. The `prompt` leads should make a
  child think to ask this person that.
- `gate`: open the character's gate, by showing a `show` lead (making its
  point), or by taking the `line` of questioning that a `hint` tell suggests.
  `after` leads are the character's earlier clues, already out; with nothing
  else, the clue comes when the child asks again.
- `hidden_spot`: search the spot, which the `pointer` lead should name or
  point at.

A step's leads are the clues held before its wave, with their facts.

## How to judge

For each step, picture a child of `target_age` who holds the opening and the
step's leads, and nothing else: no timeline, no conclusion, no `why`, no later
clue. A narrator words each fact in play, so judge whether the facts carry the
lead, not their wording. Ask:

- ask: does a lead mention `about`, or make the child wonder about it, and
  point at this person?
- show: would the child see that the lead bears on what this person said or
  did, and bring it to them?
- line: does the hint show a feeling or worry the line answers, so a kind or
  curious child would say something like it?
- after: once the earlier clues are out, is asking what really happened the
  natural next question?
- hidden_spot: does the pointer name the spot, or say plainly where something
  is?

A step with several ways in leads when one of them does.

## Findings

- `does_not_lead` (major): no way into the step gives a child of this age a
  reason to take it.
- `needs_more_than_held` (major): the step makes sense only with something the
  player does not yet hold.
- `weak_way` (minor): one way in does not lead, but another does.
- `too_hard` (minor): the step leads, but the jump is hard for this age.

Each finding's `ids` name the step's clue and the leads involved.

## Output

`steps` holds every step of `player_view.steps` once, by its `clue_id`:
`leads` is `no` when a major finding names it, `weak` when a minor one does,
else `yes`. Then the findings, the verdict (`fail` iff a finding is major) and
one short paragraph of reasoning.
