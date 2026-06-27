# Age-Appropriate Text — Research & Plan (Spike)

**Status:** Spike / research. No production code changed yet. This document
captures the problem, the references we will anchor on, and a staged
implementation plan for making generated text — in both the blueprint and at
runtime — verifiably age-appropriate for children aged **6–11**.

"Age-appropriate" here means two measurable things:

1. **Length** — not too long, not too short for the age. Bias toward *short*
   and toward *long-term engagement*, away from walls of text.
2. **Complexity** — sentence structure and word choice at the level a UK child
   of the target age can comfortably read.

## Why this spike exists — current state

`target_age` is the only age signal in the system, and nothing measures
whether output actually lands at that level.

- **Captured once, threaded everywhere.** The brief form validates
  `target_age` to **6–11** (`web/src/lib/components/BriefForm.svelte:75`); it is
  copied to `blueprint.metadata.target_age`
  (`packages/shared/src/blueprint-schema-v2.ts:332`) and passed into every
  runtime narrator role as the sole shared context
  (`supabase/functions/_shared/ai-context.ts`, `SharedMysteryContext.target_age`).
- **Prompts gesture at age but set no standard.** The generator prompt
  (`supabase/functions/_shared/blueprints/generator-prompt.md`) and all seven
  runtime roles (`supabase/functions/_shared/ai-prompts.ts`) say things like
  *"Keep language and readability appropriate for target age {{target_age}}"*
  and *"Shorter sentences for younger readers."* There are **no numbers** — no
  sentence-length cap, no word budget, no vocabulary tier, no readability
  target. A 6-year-old and an 11-year-old get the same vague instruction with a
  different number substituted in.
- **No measurement anywhere.** Blueprint text fields are `min(1)` with **no max
  length** (`blueprint-schema-v2.ts`). The evaluation pipeline
  (`evaluation/dimensions/`) judges solvability, fairness, and coherence but has
  **no age-appropriateness or readability dimension**. Two dimensions reference
  `metadata.target_age` for *reasoning* difficulty (`solve-depth.md:54`,
  `fairness.md:23`) — none for *reading* difficulty.

The gap is precise: we have an age number and vague prose, but **no definition
of "age-appropriate," no per-age differentiation, and no verification.**

## References we will anchor on

| Reference | What it gives us | Role in our system |
|-----------|------------------|--------------------|
| **UK National Curriculum — English, KS1 (Y1–2, ages 5–7) & KS2 (Y3–6, ages 7–11)** | The statutory "what's expected at age" for word reading and comprehension. | The authority we cite for *what* a target age means. Qualitative. |
| **Oxford Reading Tree / Read with Oxford Book Bands** | Concrete progression of sentences-per-page, text length, and vocabulary sophistication from early reader to Year 6. | Anchors our per-age **length** budgets. |
| **Flesch–Kincaid Grade Level + Flesch Reading Ease** | Computable readability from sentence length & syllables/word. `Grade = 0.39·(words/sentence) + 11.8·(syllables/word) − 15.59`. **US grade + 1 = UK year; reading age ≈ grade + 5.** | The deterministic **complexity** metric — usable as both a prompt target and an automated gate. |
| **Dolch (220 words, pre-K–Y3), Fry 1000 (Y1–Y9), age-of-acquisition norms** | High-frequency word cores and a per-word "how advanced" signal. Fry-1000 covers ~90% of words in a typical book. | Anchors our per-age **vocabulary** tier and rare-word flagging. |

The pairing matters: the National Curriculum tells us *what* "age 8" should
mean, and Flesch–Kincaid + word lists let us *measure* whether a given sentence
hits it. Curriculum alone is unenforceable; readability alone lacks the
"expected at age" framing. We use both.

## Proposed standard — the age profile

A single source of truth: a per-age table (ages 6–11) mapping each axis to a
target. Everything else — prompts, validators, evaluation — reads from this one
table so the standard lives in exactly one place.

| Age | UK year | FK grade target | Sentences / narration turn | ~Words / turn | Max sentence (words) | Vocabulary guidance |
|-----|---------|-----------------|----------------------------|---------------|----------------------|---------------------|
| 6 | Y1–2 | ~1 | 1–2 | 15–30 | ~8 | Dolch core; almost all 1-syllable; introduce no rare words |
| 7 | Y2–3 | ~2 | 2 | 25–40 | ~10 | Dolch + early Fry; rare words only with context |
| 8 | Y3 | ~3 | 2–3 | 30–50 | ~12 | Fry 1000; occasional new word, explained in-line |
| 9 | Y4 | ~4 | 3 | 40–55 | ~14 | Fry 1000+; 1–2 "stretch" words per passage |
| 10 | Y5 | ~5 | 3–4 | 45–65 | ~16 | Broader vocab; context-inferrable unfamiliar words OK |
| 11 | Y6 | ~5–6 | 3–4 | 50–75 | ~18 | Richer/figurative language; still concrete and clear |

Targets are intentionally biased **short** (engagement over completeness) and
expressed as the FK grade ≈ `age − 5` rule, the Book Band length progression,
and a vocabulary tier. These are starting values to be calibrated against real
generated samples in the measurement step below — not final constants.

**Answers to the spike's framing questions:**

- *Clear standard for all ages 6–11?* Yes — the table above, one row per age,
  one source of truth.
- *Differentiate length per age?* Yes — sentences/turn, word budget, and max
  sentence length per row, enforced by the scorer and injected into prompts.
- *Differentiate complexity per age?* Yes — FK grade target (sentence structure
  + syllable load) plus a vocabulary tier (Dolch/Fry coverage, rare-word
  ceiling), both measurable.

## Implementation plan (staged)

Each stage is independently reviewable. Stages 1–2 are pure and testable with
no backend dependency; later stages touch prompts and the evaluation harness.

### Stage 1 — Age-profile module (single source of truth)
- New module in `packages/shared/src/` (e.g. `age-profile.ts`) exporting the
  table above as typed data, keyed by age 6–11, with a `getAgeProfile(age)`
  accessor that clamps/validates against the same 6–11 range the brief form
  enforces.
- Unit tests covering every age and out-of-range handling.

### Stage 2 — Deterministic readability scorer
- Pure function in `packages/shared/src/` (e.g. `readability.ts`): given text +
  age, return Flesch–Kincaid grade, Flesch Reading Ease, avg & max sentence
  length, word/sentence counts, and rare-word flags (words outside the age's
  Dolch/Fry tier). Include a small bundled syllable counter and word lists.
- Returns a structured verdict (`withinTarget`, per-axis deltas) by comparing
  against `getAgeProfile(age)`.
- Heavily unit-tested with hand-picked passages at known levels. This is the
  workhorse reused by both runtime and evaluation.

### Stage 3 — Prompt upgrades
- Replace the vague "appropriate for target age" lines in
  `supabase/functions/_shared/ai-prompts.ts` (all 7 roles + `buildGameStart`/
  `buildGameMove`) and `generator-prompt.md` with **concrete per-age
  constraints** rendered from the age profile: sentence cap, word budget, FK
  target, vocabulary guidance, plus 1–2 short worked examples for the band and
  a self-check instruction.
- Keep the profile values out of the hand-written prompt strings — render them
  from the Stage 1 module so the standard stays single-sourced.
- Update `docs/ai-runtime.md` and `docs/blueprint-generation-flows.md` per
  CLAUDE.md's AI-runtime maintenance rules.

### Stage 4 — `age-appropriateness` evaluation dimension
- Add a dimension following the existing
  `.md + .schema.ts + registry.json` convention in `evaluation/dimensions/`.
- It combines the **deterministic scorer** (Stage 2, run over every
  player-facing text field: `one_liner`, `premise`, `mystery_summary`, location
  descriptions, clue text, starting-knowledge summaries) with an **LLM lens**
  for things metrics miss (tone, scariness, idioms a young child wouldn't get).
- Mirror it for the trace pipeline (`evaluation/trace/`) so we also score what
  the narrator *actually produced at runtime*, not just the blueprint.

### Stage 5 — Measurement harness (prove it works)
- A script that generates sample narration at ages **6 / 8 / 11** for a fixed
  scenario, runs the scorer, and reports before/after the Stage 3 prompt
  changes — demonstrating the differentiation is real and the bias-toward-short
  goal holds. Calibrate the Stage 1 targets against these results.

### Out of scope for this spike (note, don't build)
- Content-theme / scariness modelling beyond the readability lens.
- A per-player (vs per-blueprint) age profile or parental-controls UI.
- Runtime regenerate-on-fail loop (the scorer makes it *possible*; whether to
  gate live narration on it is a separate product decision).

## Open decisions for sign-off
1. **Scope of the first build** — stop after the doc, or proceed through the
   scorer (Stages 1–2), or take the full vertical slice (Stages 1–5)?
2. **Strictness of the runtime path** — is the scorer advisory (eval-only) for
   now, or do we want a regenerate-on-fail guard in the runtime later?
3. **Word-list sourcing** — bundle Dolch + Fry (small, public, sufficient) for
   v1, with age-of-acquisition norms as a later refinement? Recommended: yes.
