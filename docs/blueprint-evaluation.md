# Blueprint Evaluation

This document describes the current evaluator assets used to judge blueprint
quality as a mystery artifact.

Scope note:

- This is not a gameplay runtime flow.
- This is not yet wired into any specific ingestion path.
- The goal is to keep the evaluator prompt and output contract explicit and
  versionable.

## Canonical Assets

- Evaluator prompt:
  `packages/shared/src/evaluation/prompt.ts`
- Evaluator output schema:
  `packages/shared/src/evaluation/schema.ts`
- Shared exports:
  `packages/shared/src/evaluation/index.ts`
- Markdown packet builder:
  `scripts/build-blueprint-evaluation-markdown.mjs`

## Building A Chat Packet

To generate one self-contained markdown document for a chat-based evaluation
run:

```bash
npm run build:evaluation-markdown -- \
  --brief-file path/to/story-brief.json \
  --blueprint-file path/to/blueprint.json \
  --output path/to/evaluation-packet.md
```

Optional:

- `--title "My Evaluation Packet"` to change the markdown heading

The generated markdown packet includes:

- the evaluator prompt
- the evaluator output schema as Zod source
- the story-brief schema reference
- the blueprint schema reference
- the concrete story brief JSON
- the concrete blueprint JSON

This is intended for copy/paste into a chat window when you want the model to
evaluate a specific blueprint without wiring up a dedicated runtime path yet.

## Current Evaluator Scope

The evaluator currently focuses on:

- brief alignment
- ground-truth quality
- existence of one or more solution paths
- role of every location clue
- role of every knowledge item
- fairness of red herrings
- presence of dead ends
- consistency of canonical facts
- redundant clues / redundant knowledge

Current simplifying assumptions:

- the investigator can eventually discover all location clues
- the investigator can eventually obtain all character knowledge
- time-to-solve and action economy are intentionally ignored for now

The evaluator returns binary `yes|no` judgments per dimension rather than
scores. Passing dimensions provide concise reasoning. Failing dimensions provide
concrete issues with blueprint-path evidence.

## Current Limits

- The evaluator infers clue roles, red-herring structure, and solution paths
  from free-form blueprint text because the canonical blueprint schema does not
  yet model them explicitly.
- `world.characters[].stated_alibi` is treated as a claim, not a canonical fact.
- Knowledge items may be mystery-relevant or may be optional flavor; the
  current schema does not explicitly distinguish those cases.

## Possible Next Steps

These are design ideas surfaced by the evaluator work. They are not implemented
in the canonical blueprint schema or generator yet.

- Add explicit `red_herrings` structures to the blueprint schema instead of
  forcing the evaluator and accusation judge to infer them from free-form clues
  and character facts.
- Add explicit suspect-elimination paths so innocents are rule-out-able through
  first-class blueprint data, not just indirect clue interpretation.
- Ask the blueprint generator to emit explicit resolution paths for:
  - the real mystery solution
  - each red herring
  - each suspect-elimination path
- Replace bare clue / knowledge strings with structured objects that can carry:
  - intended role
  - whether they support the real solution, a red herring, or an elimination path
  - whether they support, contradict, or resolve that path
  - optional linkage to other clue-chain nodes
- Require location clues to connect to either:
  - the real solution
  - a red-herring path
  - a suspect-elimination path
- Allow character knowledge to connect optionally to the same path types, while
  still permitting explicit flavor-only knowledge.
- Add an explicit per-character factual field for what the character was really
  doing during the mystery window. This would separate hidden truth from
  `stated_alibi` and reduce ambiguity when checking consistency against
  `ground_truth.timeline`.
- Consider a lightweight fact-graph or reasoning-graph section in the blueprint
  so the generator can prove the case structure directly instead of relying on
  downstream inference.
