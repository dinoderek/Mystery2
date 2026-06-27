---
id: age_appropriateness
label: Age-appropriate reading level
tier: 2
status: proposed
---

# Age-appropriate reading level

> **Status: proposed (spike).** This dimension is not yet wired into
> `registry.json`. It pairs a deterministic readability analyzer with an LLM
> lens. See `docs/age-appropriate-text-spike.md`. It judges *reading level*
> only — length, sentence complexity, and word difficulty — **not** content
> safety (violence, scariness, distressing themes), which is a separate,
> out-of-scope concern today.

## What this dimension asks

Is every player-facing piece of text written at a reading level a UK child of
`metadata.target_age` could read comfortably and unaided — short enough to keep
them engaged, with sentences and words at the right level?

## Deterministic pre-pass (no LLM)

Before the judge runs, the harness scores each player-facing text field with the
shared scorer (`packages/shared/src/readability.ts`, `scoreForAge`), which is
built on the Flesch–Kincaid grade formula and the per-age targets in
`packages/shared/src/age-profile.ts`. Fields scored: `metadata.title`,
`metadata.one_liner`, `narrative.premise`,
`narrative.starting_knowledge.mystery_summary`, every
`world.locations[].description`, every `*.clues[].text`, and the
starting-knowledge `summary` strings. Narrator-only fields (sub-location
`hint`, agenda `details`, ground truth) are excluded — the player never reads
them.

The pre-pass produces, per field, the Flesch–Kincaid grade, word count, longest
sentence, and any threshold breaches. These objective numbers are handed to the
judge as evidence — the judge does not re-estimate them.

## Judge instructions

You are given, for the target age, the per-field readability numbers from the
deterministic pre-pass plus the original text. Using both:

1. Confirm whether the objective breaches (over the word budget, a sentence
   longer than the age cap, a grade above the band) are genuine problems in
   context, or acceptable (e.g. a proper name inflates a metric).
2. Judge what the numbers cannot: idioms or figures of speech a child this age
   would not know; abstract phrasing; sentence structures that are short on
   paper but still confusing.
3. Flag the worst offenders with a concrete, shorter/simpler rewrite suggestion.

Do not reward text for being *too* short or babyish for an older child — the
target is *comfortable for the age*, biased slightly short, not minimal.

## Output

```json
{
  "fields": [
    {
      "field": "narrative.premise",
      "flesch_kincaid_grade": 4.2,
      "within_target": false,
      "issue": "One 22-word sentence; 'inheritance' is abstract for age 7.",
      "suggested_rewrite": "Two short sentences, plainer words."
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One paragraph. 'pass' iff every player-facing field reads comfortably at metadata.target_age."
}
```
