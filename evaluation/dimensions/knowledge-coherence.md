---
id: knowledge_coherence
label: Knowledge coherence
tier: 1
---

# Knowledge coherence

## What this dimension asks

Three things about what the blueprint knows and says:

1. **Observability** — can each character actually know the things they reveal?
2. **Deception integrity (false knowledge)** — when a character says something
   false, is it an *authored, intended* lie, or an accidental contradiction the
   author didn't mean?
3. **Physical consistency** — does every physical fact the blueprint states
   agree across fields, and does nothing the player sees before a clue is found
   give that clue away?

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

## Physical consistency

The narrator is handed descriptive fields and clues at different moments —
`appearance` on every arrival and conversation, a location's `description` on
every arrival, a clue only when it is found — and cannot honour both when they
disagree. Work clue by clue:

1. List the physical facts the clue states: where each object is, what state
   it is in, what a character looks like or carries.
2. Check every other field against that list: other clues, every character's
   `actual_actions`, location `description`, sub-location `name` and `hint`,
   character `appearance`, `tells`, `flavor_knowledge`, the
   `narrative.starting_knowledge` summaries, `narrative.premise`,
   `metadata.one_liner`, and `ground_truth`.
3. Then check the descriptive fields against each other and against
   `actual_actions`, for facts no clue touches — where a character is, what a
   place contains.

Flag:

- **`kind: "physical_fact"`** — two fields disagree about where an object is,
  what state it is in, or what a character looks like or carries, and no
  `actual_actions` entry moves or changes it in between. An object in two
  places at once; a character described in two incompatible ways; a location
  description that places characters somewhere their `location_id` and
  `actual_actions` do not.
- **`kind: "pre_discovery_leak"`** — a field the player sees before the clue
  is found (`appearance`, location `description`, sub-location `name`, the
  `starting_knowledge` summaries, `premise`, `one_liner`, a tell whose trigger
  is `always`) shows or contradicts that clue's evidence. A culprit whose
  `appearance` has them carrying the object a clue later finds elsewhere is
  both a leak and a `physical_fact` contradiction; report it once, as the leak.
  Scenery a clue builds on is not a leak — only the clue's own finding is.

Do not flag:

- A character's authored lie (above). A false `stated_alibi`, or a clue spoken
  under an agenda, may contradict the facts; that is deception integrity's
  question, not this one.
- Omissions — a fact one field states and another simply leaves out.
- `cover_image`, which directs an illustration rather than stating facts.

## Output

```json
{
  "issues": [
    {
      "kind": "observability" | "false_knowledge" | "physical_fact" | "pre_discovery_leak",
      "subject": "<character id, clue id, or the fields that disagree>",
      "clue_ids": ["<every clue id the issue involves; [] if none>"],
      "description": "Concrete problem, quoting the fields that disagree."
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph. 'pass' iff every clue is knowable, every falsehood is an authored, intended lie, and every physical fact agrees across fields with nothing given away before discovery."
}
```

`clue_ids` must be real clue ids from the blueprint; a `pre_discovery_leak`
names at least the clue it gives away.
