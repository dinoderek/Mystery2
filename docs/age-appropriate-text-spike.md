# Age-Appropriate Text — Research, Plan & Spike

**Status:** Spike. This document captures the problem, the verified-open
references we build on, the per-age standard, and a staged plan. A working
deterministic scorer, the age-profile source of truth, and proposal artifacts
for generation and evaluation prompts are included in this branch.

"Age-appropriate" here means two **measurable** things, for children aged
**6–11**:

1. **Length** — not too long, not too short for the age. Biased toward *short*
   and toward *long-term engagement*, away from walls of text.
2. **Complexity** — sentence structure and word choice at the level a UK child
   of the target age can comfortably read.

> **Scope boundary — reading level, not content safety.** This work judges
> *how hard the text is to read*. It does **not** filter *content suitability*
> (violence, scariness, distressing themes). There is currently **no dedicated
> content-moderation layer** in the codebase — the only safeguards are the
> generator prompt's "keep everything child-friendly" line and the LLM
> provider's own safety. Content safety is a separate, larger workstream
> (a classifier/moderation layer, not a readability scorer) and is out of scope
> here. Flagged so it is not mistaken for done.

## Current state — the gap

`target_age` (validated **6–11** in `web/.../BriefForm.svelte:75`) is the only
age signal. It is copied to `blueprint.metadata.target_age`
(`blueprint-schema-v2.ts:332`) and threaded into every runtime narrator role
(`ai-context.ts`). But:

- **Prompts gesture at age with no standard.** The generator
  (`supabase/functions/_shared/blueprints/generator-prompt.md`) and all seven
  runtime roles (`supabase/functions/_shared/ai-prompts.ts`) say things like
  *"Keep language and readability appropriate for target age {{target_age}}"* —
  **no numbers**: no sentence cap, word budget, or readability target. Age 6 and
  age 11 get the same sentence with a different number.
- **Nothing measures output.** Text fields are `min(1)` with no max length. The
  evaluation battery (`evaluation/dimensions/`) has no readability dimension.

## References — only verified-open sources

| Source | Verified status | How we use it |
|--------|-----------------|---------------|
| **Flesch–Kincaid grade & reading ease** | Free to implement — a mathematical formula (not copyrightable); also US-government origin (1975 Navy contract). | The computed standard. Built into the scorer. |
| **UK National Curriculum — English, KS1/KS2** | © Crown copyright, reused under the **Open Government Licence v3.0** (copy/adapt with attribution). | Cited as the "expected at age" framing. Not bundled. |
| **High-frequency word lists (e.g. Dolch, 1936/48)** | The classic lists are out of copyright; short word lists are factual and freely reusable. | **Not bundled.** The vocabulary axis is a *pluggable hook* that accepts an external word set the team supplies. |

**Oxford Reading Tree / Book Bands were considered and dropped** — the specific
level→age mappings are proprietary OUP material, so they are neither bundled nor
used as a computed standard.

Why Flesch–Kincaid is the right computed anchor: it is deterministic, cheap, and
its US grade maps cleanly to UK schooling — **grade + 1 = UK year**, and
**reading age ≈ grade + 5** — so the target grade for a given age is about
`age − 5`. That makes it usable as both a prompt target and an automated gate.

## The standard — two dials

Single source of truth: `packages/shared/src/age-profile.ts`, read by the
scorer, the prompts, and the evaluation dimension. There is **no minimum length
anywhere** — a minimum just forces padding, the exact wall-of-text failure we
want to avoid. Length is **target + soft-max guidance** in words, which the
narrator may exceed when the content or character needs it.

**Dial 1 — Complexity (depends on age only).** Same regardless of interaction.

| Age | UK year | FK grade (target–softMax) | Soft sentence length | New-word allowance | Brevity bias |
|-----|---------|---------------------------|----------------------|--------------------|--------------|
| 6 | Y1–2 | 1 – 1.5 | ~8 words | 0 | 0.55 |
| 7 | Y2–3 | 1.5 – 2 | ~10 | 1 | 0.70 |
| 8 | Y3 | 2.5 – 3 | ~12 | 1 | 0.85 |
| 9 | Y4 | 3.5 – 4 | ~14 | 2 | 0.95 |
| 10 | Y5 | 4.5 – 5 | ~16 | 3 | 1.00 |
| 11 | Y6 | 5 – 6 | ~18 | 4 | 1.00 |

The **FK grade band is the firm signal** (text above it is too hard to read);
sentence length and vocabulary are advisory. The **brevity bias** is a one-way
multiplier (≤ 1.0) that *trims* length for younger readers — it never lengthens
text for older readers, and plateaus at 1.0 for ages 10–11.

**Dial 2 — Length (depends on interaction × age).** Each of the nine runtime
interactions has one natural length for a fluent reader; the brevity bias trims
it for younger ages. All values are soft guidance, no minimum.

| Interaction | Runtime role | Target / soft-max words (fluent reader) |
|-------------|--------------|------------------------------------------|
| Intro | `buildGameStartPrompt` | 45 / 70 |
| Ambience | `buildGameMovePrompt` | 30 / 50 |
| Search — nothing found | `search_bare` | 20 / 35 |
| Search — clue found | `search_targeted` | 30 / 50 |
| Talk — greeting | `talk_start` | 15 / 30 |
| Talk — interrogation round | `talk_conversation` | 35 / 60 |
| Talk — farewell | `talk_end` | 12 / 25 |
| Accusation — opening | `accusation_start` | 30 / 50 |
| Accusation — verdict / payoff | `accusation_judge` | 50 / 80 |

Effective length = base × brevity bias. E.g. an interrogation round is ~19/33
words for a 6-year-old and the full 35/60 for an 11-year-old.

**Answers to the spike's framing questions:**
- *Clear standard for 6–11?* Yes — the two tables above, one source of truth.
- *Differentiate length per age?* Yes — per-interaction target/soft-max trimmed
  by the per-age brevity bias. No minimum.
- *Differentiate complexity per age?* Yes — a Flesch–Kincaid grade band (firm)
  plus soft sentence-length and an optional vocabulary tier (pluggable word set).

## What this branch contains

### 1. Age-profile module — `packages/shared/src/age-profile.ts`
The two tables above as typed data. Complexity: `getAgeProfile(age)` (clamped to
6–11). Length: `getInteraction(id)` and `effectiveLength(id, age)` (base length
trimmed by the age's brevity bias). Prompt rendering: `renderComplexityGuidance`,
`renderLengthGuidance`, and `renderGuidance(interaction, age)` emit prompt-ready
blocks from the profile so the numbers are never hand-copied into prompt strings.

### 2. Deterministic scorer — `packages/shared/src/readability.ts`
Pure functions, no third-party content. `measure(text)` returns Flesch–Kincaid
grade, reading ease, word/sentence counts, and the longest sentence.
`scoreForAge(text, age, { interaction?, knownWords? })` compares against the
profile and returns per-axis flags and a `withinTarget` verdict. Severity matches
the dials: **complexity** (FK grade above the band) is a `fail`; **length** (over
the interaction soft-max) and **sentence length** are advisory `warn`s; the
**vocabulary** axis is a `fail` when a `knownWords` set is supplied, else an
advisory `warn`. Covered by `tests/api/unit/readability.test.ts` and
`age-profile.test.ts` (28 tests), including: same passage fails for age 6 and
passes for age 11; younger readers get a trimmed length budget; length never
fails the verdict.

### 3. Generation-prompt proposal
Replace the vague "appropriate for target age" lines in `ai-prompts.ts` (the 9
roles + `buildGameStart`/`buildGameMove`) and `generator-prompt.md` with the
output of `renderGuidance(interaction, target_age)` for the matching interaction.
Example rendered block for the **intro at age 6**:

```
The reader is 6 years old (about UK Year 1–2). Match this reading level:
- Sentences: keep them short and clear. Aim to keep most sentences under about 8 words.
- Words: Use only the most common, everyday words. Almost every word should be one or two syllables. Do not introduce new or unusual words.
- The writing should be comfortable for a 6-year-old to read unaided.
Length (guidance, not a hard limit): aim for around 25 words; try to stay under about 39.
Prefer shorter. Cut anything that does not earn its place — never write a wall of text. Go longer only if the character or the moment truly needs it.
```

These edits are **proposed, not yet applied** to the live prompt files, to keep
the spike from changing runtime narration before sign-off. Wiring them in is a
follow-up (and must keep the shared/supabase prompt copies in sync).

### 4. Evaluation-dimension proposal — `evaluation/dimensions/age-appropriateness.{md,schema.ts}`
A new `age_appropriateness` dimension following the existing
`.md + .schema.ts + registry.json` convention. It runs the deterministic scorer
over every player-facing text field as an evidence pre-pass, then an LLM lens
judges what metrics miss (idioms, abstraction). **Not yet added to
`registry.json`** — activation is a follow-up, so the live battery is unchanged.

## No runtime strictness
By decision, the scorer is **advisory / evaluation-time only**. We are **not**
adding a regenerate-on-fail guard to live narration in this spike. The scorer
makes such a guard *possible* later, but whether to gate live output is a
separate product decision.

## Follow-ups (not in this spike)
- Wire `renderAgeGuidance` into the live generation prompts (with prompt-sync).
- Add `age_appropriateness` to the evaluation `registry.json` and mirror it in
  the trace pipeline to score what the narrator actually produced at runtime.
- Supply an external high-frequency word file to switch the vocabulary axis from
  advisory to exact.
- Calibrate the per-age numbers against generated samples.
- Separately: scope a content-safety / moderation layer (out of scope here).
