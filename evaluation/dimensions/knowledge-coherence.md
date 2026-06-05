---
id: knowledge_coherence
label: Knowledge coherence
tier: 1
---

# Knowledge coherence

## What this dimension asks

Two things about what characters know and say:

1. **Observability** — can each character actually know the things they reveal?
2. **Deception integrity (false knowledge)** — when a character says something
   false, is it an *authored, intended* lie, or an accidental contradiction the
   author didn't mean?

## Observability

- Each clue on a character (`world.characters[].clues`) must be something that
  character could plausibly know, given their `actual_actions`, `location_id`,
  and `background`.
- A cross-character clue (one with `about_character_id`) must describe
  something the **source** character could plausibly have observed or learned
  about the target — they were positioned to see it, or their
  `background`/relationship supports knowing it.

Flag (`kind: "observability"`) any clue a character could not actually have.

## Deception integrity (false knowledge)

Characters are *expected* to lie, and the schema supports it: a `stated_alibi`
"may be false", and agenda types `self_protect` (defend themselves),
`implicate_other` (push suspicion onto someone), `protect_other` (vouch for
someone), and `conditional_reveal` (withhold until a condition is met). **A lie
is not an error. An *unintended* contradiction is.**

For every character statement that conflicts with the authoritative facts
(`actual_actions`, `ground_truth`), classify it:

- **Authored lie — do NOT flag.** The falsehood is backed by a mechanism that
  clearly intends it: a false `stated_alibi` paired with a `self_protect`
  agenda, an `implicate_other` agenda that frames the suspicion as the
  speaker's belief or a rumor, the culprit concealing their own guilt. The
  blueprint means for this character to be lying.
- **Incoherence — flag (`kind: "false_knowledge"`).**
  - A clue or vouch presented as **accurate truth** that nonetheless
    contradicts the facts — e.g. a `protect_other` clue whose intent is "this
    is accurate / helps clear them" but which misstates where the protected
    character actually was.
  - A falsehood with **no authoring mechanism** behind it — the character
    contradicts the facts but has no agenda, no false alibi, and no reason to
    lie, so it reads as an author mistake.
  - A character's own clue contradicting their own `actual_actions` while being
    presented as truthful.

Whether a lie is *disprovable by the player* is fairness's concern, not this
dimension's. Here, only judge whether each falsehood is internally consistent
and clearly intended.

## Output

```json
{
  "issues": [
    {
      "kind": "observability" | "false_knowledge",
      "subject": "<character id and/or clue id>",
      "description": "Concrete problem."
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph. 'pass' iff every clue is knowable and every falsehood is an authored, intended lie."
}
```
