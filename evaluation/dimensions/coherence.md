---
id: coherence
label: Internal coherence
tier: 1
---

# Internal coherence

## What this dimension asks

Are the blueprint's facts internally consistent — does the timeline hold up,
do characters' actions agree across `actual_actions` and `ground_truth.timeline`,
and is no character claiming knowledge they couldn't plausibly have?

## Judge instructions

Check three families of consistency:

### Timeline

- `ground_truth.timeline` is an ordered list of events. Each character's
  `actual_actions` is also ordered (by `sequence`). For every character,
  their `actual_actions` should not contradict `ground_truth.timeline`
  (e.g., a character can't be sleeping at home in their `actual_actions`
  while the timeline places them at the crime scene).
- The culprit's `actual_actions` should include or be consistent with the
  events in `ground_truth.what_happened`.

### Knowledge

- A clue authored on a character (`world.characters[].clues`) should be
  something that character could plausibly know — given their
  `actual_actions`, `background`, and `location_id` during the mystery
  window.
- Cross-character clues (`alibi_knowledge`, `witness_testimony`,
  `motive_knowledge`) should describe something the source character could
  plausibly have observed or learned about the target character.

### Geography

- No character should claim to have been in a place their `actual_actions`
  show they could not have been.
- `stated_alibi`, when present, should either match `actual_actions` (truthful
  alibi) or contradict it in a way that becomes investigatable (false alibi).

## Output

```json
{
  "issues": [
    {
      "kind": "timeline" | "knowledge" | "geography",
      "subject": "character_id or path id",
      "description": "Concrete contradiction."
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph. 'pass' iff no contradictions found."
}
```
