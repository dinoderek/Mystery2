# Blueprint Evaluation

This document describes the evaluator assets used to judge blueprint quality as
a mystery artifact.

Scope note:

- This is not a gameplay runtime flow.
- The evaluator targets **Blueprint V2** authoring data.
- Live gameplay runtime also consumes **Blueprint V2**.

## Canonical Assets

- Evaluator prompt:
  `packages/shared/src/evaluation/prompt.ts`
- Evaluator output schema:
  `packages/shared/src/evaluation/schema.ts`
- Shared exports:
  `packages/shared/src/evaluation/index.ts`
- Markdown packet builder:
  `scripts/build-blueprint-evaluation-markdown.mjs`
- Blueprint V2 schema reference:
  `packages/shared/src/blueprint-schema-v2.ts`

## Building A Chat Packet

To generate one self-contained markdown document for a chat-based evaluation
run:

```bash
npm run build:evaluation-markdown -- \
  --brief-file path/to/story-brief.json \
  --blueprint-file path/to/blueprint-v2.json \
  --output path/to/evaluation-packet.md
```

Optional:

- `--title "My Evaluation Packet"` to change the markdown heading

The generated markdown packet includes:

- the evaluator prompt
- the evaluator output schema as Zod source
- the story-brief schema reference
- the Blueprint V2 schema reference
- the concrete story brief JSON
- the concrete Blueprint V2 JSON

This is intended for copy/paste into a chat window when you want the model to
evaluate a specific Blueprint V2 without wiring up a dedicated runtime path yet.

The local generator CLI now also uses the same evaluator assets for
post-generation verification. When `scripts/generate-blueprint.mjs` writes a
blueprint file, it writes a sibling `*.verification.json` file with either the
parsed evaluator result or the verification error details.

## Current Evaluator Scope

The evaluator currently focuses on:

- brief alignment
- ground-truth quality
- existence of one or more solution paths
- role of every location clue
- role of every character clue
- fairness of red herrings
- presence of dead ends
- consistency of canonical facts
- redundant location clues / character clues

Current simplifying assumptions:

- the investigator can eventually discover all location clues
- the investigator can eventually obtain all character clues
- time-to-solve and action economy are intentionally ignored for now

The evaluator returns binary `yes|no` judgments per dimension rather than
scores. Passing dimensions provide concise reasoning. Failing dimensions provide
concrete issues with blueprint-path evidence.

## Blueprint V2 Assumptions

The evaluator expects Blueprint V2 to provide explicit authoring structure for:

- `solution_paths[]`
- `red_herrings[]`
- `suspect_elimination_paths[]`
- structured location clues
- structured character clues
- separate `flavor_knowledge[]`
- ordered `actual_actions[]`

The evaluator uses authored path arrays as the intended reasoning structure, but
still verifies that the clue texts and hidden truth genuinely support them.

`flavor_knowledge[]` is treated as optional worldbuilding rather than mystery
evidence.

## Runtime Boundary

All runtime components now use Blueprint V2:

- generator output is Blueprint V2
- evaluator input is Blueprint V2
- gameplay runtime consumes Blueprint V2

