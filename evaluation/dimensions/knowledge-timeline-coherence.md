---
id: knowledge_timeline_coherence
label: Knowledge and timeline coherence
tier: 1
---

# Knowledge and timeline coherence

## What this dimension asks

Two questions about whether the blueprint's facts hold together, in one pass.
Each finding says which one it answers, as its `kind`.

1. **`timeline_coherence`**: Around the crime, are the characters' positions
   and the sequence of events consistent? Does the culprit's `actual_actions`
   actually produce `ground_truth.what_happened`, and is every other
   character's position relative to the crime window consistent with the clues
   that implicate or clear them?
2. **`knowledge_coherence`**: What the blueprint knows and says.
   - **Observability**: can each character actually know what they reveal?
   - **Deception integrity**: when a character says something false, is it an
     authored, intended lie, or an accidental contradiction?
   - **Physical consistency**: does every physical fact agree across fields,
     and does nothing the player sees before a clue is found give it away?

## Authoritative facts

Who did what is each character's ordered `actual_actions`, with
`ground_truth.what_happened` and `why_it_happened`. `ground_truth.timeline` is
a non-authoritative prose sketch: its sentence order is not binding. Do not
raise an issue because its wording orders someone differently from their
`actual_actions`. Each character's `actual_actions` `sequence` is local to that
character, not a shared clock: align characters only through the crime window
and shared events the summaries imply.

## Timeline (`timeline_coherence`)

1. From `what_happened` and the culprit's `actual_actions`, establish the crime
   window: when and where the act occurred.
2. Confirm the culprit's own actions carry out `what_happened`. A culprit whose
   actions do not commit the crime is a finding.
3. Place every other character relative to the window by their
   `actual_actions`. One cleared by a `suspect_elimination_path` or exoneration
   clue must, by their own actions, be away or unable; one a clue places at the
   scene must plausibly be there.
4. Flag a character whose actions put them in two places at once, or somewhere
   their actions preclude.

A false `stated_alibi` is expected. One that contradicts the speaker's own
`actual_actions` is deception, judged below, not a timeline issue. Judge the
timeline only against `actual_actions`, never against what characters claim.

## Knowledge (`knowledge_coherence`)

**Observability.** Each clue on a character (`world.characters[].clues`) must
be something that character could plausibly know, given their
`actual_actions`, `location_id` and `background`. A clue with
`about_character_id` must describe something the source could have observed or
learned about the target.

**Deception integrity.** Lies are expected: a `stated_alibi` may be false, and
agendas `self_protect`, `implicate_other`, `protect_other` and
`conditional_reveal` support them. For every character statement that conflicts
with `actual_actions` or `ground_truth`:

- An authored lie, backed by a mechanism that clearly intends it (a false alibi
  with a `self_protect` agenda, an `implicate_other` suspicion framed as belief
  or rumour, the culprit concealing guilt), is not a finding.
- Flag a clue or vouch presented as accurate truth that contradicts the facts
  (a `protect_other` clue meant to clear someone that misstates where they
  were); a falsehood with no authoring mechanism behind it; a character's own
  clue contradicting their own `actual_actions` while presented as truthful.

Whether the player can disprove a lie is not asked here.

**Physical consistency.** The narrator gets `appearance` on every arrival and
conversation, a location's `description` on every arrival, and a clue only when
found, and cannot honour both when they disagree. For each clue, list the
physical facts it states (where an object is, its state, what a character looks
like or carries), then check every other field against them: other clues,
`actual_actions`, location `description`, sub-location `name` and `hint`,
`appearance`, `tells`, `flavor_knowledge`, the `narrative.starting_knowledge`
summaries, `narrative.premise`, `metadata.one_liner` and `ground_truth`. Then
check the descriptive fields against each other and against `actual_actions`.

Flag two fields that disagree about where an object is, its state, or what a
character looks like or carries, with no `actual_actions` entry changing it in
between. Flag a field the player sees before a clue is found (`appearance`,
location `description`, sub-location `name`, the `starting_knowledge`
summaries, `premise`, `one_liner`, a tell whose trigger is `always`) that shows
or contradicts that clue's evidence, and name the clue in `refers_to`; a
contradiction that is also such a leak is reported once, as the leak. Scenery a
clue builds on is not a leak.

Do not flag an authored lie, an omission (one field states a fact another
leaves out), or `cover_image`.

## Findings and severity

Report each problem as one finding. Every issue either question above asks you
to flag is `major`. Use `minor` only for a blemish worth recording that would
not fail either question. `verdict` is `"fail"` if and only if at least one
finding is `major`.

## Output

```json
{
  "findings": [
    {
      "severity": "major" | "minor",
      "kind": "timeline_coherence" | "knowledge_coherence",
      "quote": "Short verbatim span of a field at issue.",
      "why": "The concrete problem, naming the fields that disagree.",
      "refers_to": "<the character or clue id, or the field it concerns>"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph: the crime window, and whether every clue is knowable, every falsehood intended and every physical fact consistent."
}
```
