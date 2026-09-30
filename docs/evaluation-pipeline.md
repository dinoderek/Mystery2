# Evaluation

Four harnesses judge the game's AI from different angles. They share
machinery, so this doc is the map and the design; how to run each one is the
README beside its code.

| Harness | Subject | Question | Runbook |
|---|---|---|---|
| Blueprint | A generated blueprint | Is this a good, fair, solvable mystery? | `evaluation/README.md` |
| Trace | A played session | Did the narrator play it faithfully? | `evaluation/trace/README.md` |
| Runtime | One interaction, fixed history | How does a model narrate this exact turn? | `evaluation/runtime/README.md` |
| Playtest | Nothing — it plays | What happens when an AI plays whole games? | `evaluation/playtest/README.md` |

How they connect:

- **Trace** reuses the blueprint pipeline's CLI runner, timing, result
  combination and dimension convention, and rebuilds what the narrator saw with
  the runtime's own context builders.
- **Runtime** makes one `game-*` interaction deterministic — same input across
  runs and models — by fixing the prior state and history. It collects
  narration from the real endpoint or by replaying the real prompt through a
  local CLI, and grades it with `flesch` (Flesch–Kincaid for the target age),
  `age_appropriate`, and the `gm_*` judges.
- **The `gm_*` judges** (`gm_roleplay`, `gm_clue_discipline`, `gm_fabrication`,
  `gm_spoiler`) belong to neither: they live in `evaluation/judges/` and are
  written against a subject projection. Trace judges every turn of a session;
  runtime judges one turn and treats its history as context. So a failure found
  in play can be frozen into a runtime case and re-judged against another model
  by the same standard (`evaluation/judges/README.md`).
- **Playtest** produces sessions rather than grades: an AI investigator plays
  through the real server and parser, and each game leaves a transcript and a
  replayable script. `--judge` hands the games to trace.

The rest of this doc is the blueprint pipeline's design, which the others
inherit.

## What the blueprint pipeline is for

Given a brief, it generates a Blueprint V2 through a pluggable LLM CLI and
judges it, producing one structured verdict. The harness — its judges,
prompts and schemas — is the thing expected to change, so it is shaped to be
cheap to change:

1. **Catch authoring failures before play.** A blueprint with structural
   holes, ungrounded characters or non-converging evidence invites the narrator
   to fabricate.
2. **A new quality dimension is files, not code.**
3. **No LLM SDK.** Every model call is a subprocess, so the pipeline runs
   against any CLI bound in `evaluation/config/cli.json`.
4. **Parallel.** Wall-clock time is the slowest judge, not their sum.
5. **Legible under failure.** A run that aborts still writes its envelope, with
   per-attempt logs.

## Three tiers of check

| Tier | What | Where | Runs |
|---|---|---|---|
| Mechanical | Deterministic structural checks | `evaluation/checks/mechanical.mjs` | Always |
| Analyzer | Deterministic, per dimension | `evaluation/checks/analyzers/<id>.mjs` | If the dimension has one |
| Judge | One LLM call per dimension | `evaluation/dimensions/<id>.md` + `<id>.schema.ts` | Per enabled dimension |

Both lessons come from the single-prompt evaluator this replaced:

- **A judge with a narrow job judges better.** One prompt assessing
  solvability, fairness, coherence and grounding at once gave worse signal on
  each than focused judges do, and a small output schema can be enforced.
- **What code can check, code checks.** LLM time is the bottleneck and LLM
  judgement drifts. Schema validity, brief-derived counts and orphan clues are
  mechanical; the judge is kept for genuinely qualitative questions.

One judge per dimension also buys parallelism, isolation (editing the fairness
prompt cannot move solve-depth scores) and targeted retries.

A dimension's result is `skipped` if nothing ran, `error` if its analyzer or
judge failed after retries, `fail` if any result failed, else `pass`. The run
summary counts them; there is no single overall verdict — consumers decide what
is ship-ready.

## Stages

`evaluation/pipeline/run.mjs`:

1. **Load** the brief (`--spec` takes a spec directory or a brief file). Which
   dimensions run, and their context, comes from
   `evaluation/dimensions/registry.json`, the same battery for every blueprint.
   It used to be per spec, and specs quietly lost dimensions nobody listed.
2. **Generate**, or read `--blueprint`. The result must parse as
   `BlueprintV2Schema`; if it does not, the run stops, and still writes its
   envelope with `run_error.stage`.
3. **Mechanical checks**, including that the clue discovery graph is acyclic,
   references real clues, and reaches every solution clue from an ungated root.
   A failure does not stop the dimensions: judges often surface the same
   problem from another angle.
4. **Dimensions**, all in parallel. Within one, the analyzer runs before the
   judge, and an analyzer error skips only that dimension's judge.

`scripts/generate-blueprint.mjs` runs the same mechanical checks in-process
after every generation, so the two cannot drift.

## Workspaces

Generation and judging are not single prompt/response calls. Each runs an
agent in a one-shot **workspace** — the prompt or dimension brief, the inputs,
reference docs, a validator it must pass, and an output path — and the agent
iterates until its output validates.

| Harness | Template | Output | Validator |
|---|---|---|---|
| Generator | `evaluation/generator-harness/template/` | `blueprint.json` | `scripts/validate-blueprint.mjs` |
| Judge | `evaluation/judge-harness/template/` | `verdict.json` | `evaluation/pipeline/validate.mjs` |

- **Self-correction.** An agent that runs its own validator fixes its schema
  mistakes before the pipeline sees them, so a retry exercises a real failure.
- **Reproducibility.** A workspace is a complete record of what the agent saw;
  a bug reproduces by re-running it.

The generator workspace gets **curated extracts** of the repo docs rather than
the docs, pinned to the sections they summarise and checked by the gate
(`evaluation/generator-harness/template/README.md`).

Runs are written outside the repo, one self-contained directory each, with the
agents' workspaces kept, so a failure stays debuggable after the fact. The
layout, the envelope's fields, timing and retry settings are in
`evaluation/README.md`.

## Dimensions

`evaluation/dimensions/registry.json` is the battery; `evaluation/README.md`
lists what each dimension asks. Adding one is three files, and no code:

- `evaluation/dimensions/<id>.md` — the judge's brief and documented output.
- `evaluation/dimensions/<id>.schema.ts` — the Zod schema for its output. It is
  appended to the prompt as JSON Schema and validates the answer; where brief
  and schema disagree, the schema wins.
- `evaluation/checks/analyzers/<id>.mjs` — optional deterministic pre-check.

If the verdict cites blueprint ids that can be checked, register a semantic
check in `evaluation/judge-harness/scripts/validate-judge-output.mjs`;
otherwise only the shape is checked.

## Deliberately not done yet

- Evaluating several blueprints per brief, or sampling a judge several times
  and voting. One of each, per run.
- Storing and browsing run history beyond the run directories.
- Further dimensions — clue economy, red-herring quality, cover-ups, narrative
  economy, tone — are intended but not built.
- Measuring how long a case takes to solve in play — a runtime concern.
