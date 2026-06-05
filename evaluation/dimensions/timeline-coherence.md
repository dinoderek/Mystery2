---
id: timeline_coherence
label: Timeline coherence
tier: 1
---

# Timeline coherence

## What this dimension asks

Around the crime, are the characters' positions and the sequence of events
internally consistent? Specifically: does the culprit's `actual_actions`
actually produce `ground_truth.what_happened`, and is every other character's
position relative to the crime window consistent with the clues that implicate
or clear them?

## Authoritative facts vs. the prose timeline

The **authoritative** record of who did what is each character's ordered
`actual_actions`, together with `ground_truth.what_happened` and
`why_it_happened`. Treat `ground_truth.timeline` as a **non-authoritative prose
summary**: it is only a sketch of events "leading up to" the mystery, it does
not enumerate every character's position, and **its sentence ordering is not
binding**. Reconstruct the crime window from `actual_actions` +
`what_happened`, never from the order of sentences in `ground_truth.timeline`.

Do **not** raise an issue merely because the prose timeline's wording seems to
order someone differently than their `actual_actions` imply — that is summary
imprecision, not a timeline contradiction. Only raise issues for genuine
impossibilities in the authoritative facts (below).

Each character's `actual_actions` `sequence` is **local** to that character
(1..N), not a shared clock. Align characters to each other only through the
crime window and shared events you can infer from the action summaries; do not
assume character A's `sequence` 2 is simultaneous with character B's
`sequence` 2.

## Judge instructions

1. From `ground_truth.what_happened` and the culprit's `actual_actions`,
   establish the **crime window** — when the act occurred and where.
2. Confirm the culprit's `actual_actions` actually carry out `what_happened`
   (they are in the right place at the crime window and perform the act). A
   culprit whose own actions don't commit the crime is a timeline failure.
3. For every other character, place them relative to the crime window using
   their `actual_actions`, and check that placement against the clues about
   them:
   - A character cleared by a `suspect_elimination_path` or exoneration clue
     must, by their own `actual_actions`, actually be away from the crime
     window (or otherwise unable to have done it). If a clue clears them but
     their actions put them at the scene during the crime, that's a
     contradiction.
   - A character implicated at the scene by a clue must, by their
     `actual_actions`, plausibly be there.
4. Flag any character whose `actual_actions` require them to be in two places
   at once, or in a place their actions preclude.

A false `stated_alibi` is **expected** — a culprit or suspect may lie about
where they were. A `stated_alibi` that contradicts the speaker's own
`actual_actions` is **not** a timeline issue; that is deception, judged by the
knowledge-coherence dimension. Judge the timeline only against `actual_actions`,
never against what characters *claim*.

## Output

```json
{
  "issues": [
    {
      "subject": "<character id, 'culprit', or 'crime'>",
      "description": "Concrete timeline impossibility grounded in actual_actions + what_happened."
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph. 'pass' iff no timeline contradictions in the authoritative facts."
}
```
