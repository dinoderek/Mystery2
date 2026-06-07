# Evaluation Pipeline (Design)

**Status:** In active development. Supersedes the single-prompt evaluator
described in `docs/blueprint-evaluation.md` (now deprecated; scheduled for
removal in a follow-up branch).

This document explains **why** the evaluation pipeline at `evaluation/` is
shaped the way it is. For how to run it, see `evaluation/README.md`.

## What this is

A harness for judging the quality of a generated Blueprint V2 as a mystery
artifact. Given an authored input brief, it generates a blueprint with a
pluggable LLM CLI and then runs a battery of mechanical checks, deterministic
analyzers, and LLM judges against the result, producing a single structured
verdict envelope.

The harness itself — not any individual blueprint — is the moving target. The
shape below exists to make the harness cheap to iterate on: judges, prompts,
schemas, and dimensions are all expected to change.

## Goals

1. **Catch authoring failures before runtime.** A blueprint that ships to the
   gameplay runtime with structural holes, ungrounded characters, or
   non-converging evidence will invite the runtime narrator to fabricate. We
   want those failures surfaced at authoring time, not at play time.
2. **Be cheap to iterate on.** Adding a new quality dimension should be a
   matter of writing one markdown brief + one Zod schema + (optionally) one
   deterministic analyzer. No code-path changes.
3. **Run inside arbitrary execution environments.** The pipeline itself never
   imports an LLM SDK. Every model call is a subprocess, so the same pipeline
   runs against any LLM CLI you bind in `config/cli.json` — the bundled
   wrappers invoke `claude`.
4. **Be parallel.** Independent dimensions evaluate concurrently so wall-clock
   time scales with the slowest judge, not their sum.
5. **Stay legible under failure.** A run that aborts mid-flight still writes a
   structured envelope. Per-attempt logs and retry diagnostics are always
   captured.

## Architecture: three tiers

Each Blueprint V2 is evaluated by **three kinds of check**, in order of cost.

| Tier        | What it is                                    | Where it lives                       | Cost   | Always runs?                       |
|-------------|-----------------------------------------------|--------------------------------------|--------|------------------------------------|
| Mechanical  | Deterministic structural checks               | `evaluation/checks/mechanical.mjs`   | Free   | Yes — on every run                 |
| Analyzer    | Deterministic per-dimension checks            | `evaluation/checks/analyzers/<id>.mjs` | Free | Only if a dimension defines one    |
| Judge       | LLM call per dimension via the pluggable CLI  | `evaluation/dimensions/<id>.md` + `<id>.schema.ts` | Expensive | Per dimension enabled for the run |

### Why split mechanical / analyzer / judge

Two reasons, both empirical from iterating on the old single-prompt evaluator:

- **Judge quality goes up when each judge has a narrow job.** A single
  prompt that has to assess solvability, fairness, coherence, and character
  grounding all at once produces worse signal on each of them than a set of
  focused, single-purpose judges. The judge stays inside its dimension's frame
  and its output schema is small enough to be enforced.
- **Anything a judge can be replaced by code, should be.** LLM time is the
  bottleneck and LLM judgments drift. If a check is fully expressible as code
  (schema validity, brief-derived counts, orphan clues), it belongs in the
  mechanical tier or in an analyzer. The judge is reserved for genuinely
  qualitative questions.

### Why one judge per dimension

- **Parallelism.** Dimensions are independent. Running several 30s judges in
  parallel is ~30s of wall-clock; running one mega-judge is their sum.
- **Iteration isolation.** Editing the fairness prompt cannot regress
  solve_depth scores. Each dimension's prompt, output schema, and analyzer
  evolve on their own clock.
- **Targeted retries.** A schema-validation failure on the knowledge_coherence
  judge retries only that judge, not the entire evaluation.

### Combining results

For each dimension:

- If neither analyzer nor judge produces a result, `overall = "skipped"`.
- If any non-skipped result is `"fail"`, `overall = "fail"`.
- If an analyzer or judge errored (CLI failure, schema mismatch after
  retries), `overall = "error"`.
- Otherwise `overall = "pass"`.

A run's summary aggregates `mechanical: {pass, fail}` and
`dimensions: {pass, fail, error, skipped}` plus retry counters. There is no
single overall pass/fail flag — consumers decide what counts as ship-ready.

## Pipeline stages

`evaluation/pipeline/run.mjs` runs four sequential stages.

```
load spec ──► generate blueprint ──► mechanical checks ──► dimensions
                                                            ├─ solve_depth         (judge)
                                                            ├─ fairness            (judge)
                                                            ├─ timeline_coherence  (judge)
                                                            ├─ knowledge_coherence (judge)
                                                            ├─ character_grounding (judge)
                                                            └─ path_payoff         (judge)
                                                            // all in parallel
```

1. **Load spec.** Reads `input.brief.json`. The dimension set + context comes
   from `evaluation/dimensions/registry.json` (see "Spec file" below).
2. **Generate blueprint.** Either reads `--blueprint <path>` or shells out to
   the generator CLI. Output is validated against `BlueprintV2Schema`. Failure
   here aborts the run; the envelope still gets written with
   `run_error: { stage: "generate", message }`.
3. **Mechanical checks.** Cheap structural checks against the brief and
   blueprint. Failures here do **not** block dimension evaluation — we still
   want LLM judgments on a partially-broken blueprint, because they often
   surface the same problem from a different angle.
4. **Dimensions.** All enabled dimensions evaluate in parallel via
   `Promise.all`. Inside a dimension, analyzer runs before judge; analyzer
   error skips the judge for that dimension only.

The envelope is always written, even on whole-run failure.

## Pluggable CLI

The pipeline never imports an LLM SDK. Every model call is a subprocess spawned
per `evaluation/config/cli.json` (field-by-field reference in
`evaluation/README.md` → "Pluggable CLI").

`cmd` is a shell script that wraps any LLM CLI. The runner writes the system
prompt and user message to two temp files, substitutes their paths into `args`
(via the placeholders `{{system_prompt_file}}` and `{{user_message_file}}`),
spawns the process, captures stdout, parses it as JSON, and walks `extract_path`
to get the model's text. That text is then parsed against the dimension's Zod
schema.

To bind a new LLM: write a wrapper that takes the two file paths, calls your
CLI, and prints `{ "result": "<model-output>" }` on stdout. The bundled
wrappers in `evaluation/config/wrappers/` invoke `claude`.

## Generator and judge harnesses

Generation and judgment both run inside one-shot **workspaces**, not as
single-turn prompt/response calls. A workspace is a directory the wrapper
populates with everything the agent needs:

- the canonical prompt or dimension brief
- the inputs (brief, blueprint, schemas)
- read-only reference docs (game overview, runtime consumption, briefs guide)
- a validator script the agent must run before declaring done
- an output path

The agent inside the workspace iterates until its output passes the
validator, then exits. The wrapper reads the output and returns it to the
pipeline.

| Harness  | Workspace template                           | Output            | Validator                                |
|----------|----------------------------------------------|-------------------|------------------------------------------|
| Generator | `evaluation/generator-harness/template/`    | `blueprint.json`  | `scripts/validate-blueprint.mjs`         |
| Judge    | `evaluation/judge-harness/template/`        | `verdict.json`    | `evaluation/pipeline/validate.mjs <schema>` |

This pattern matters for two reasons:

- **Self-correction.** Agents that can run their own validator catch their
  own schema and semantic mistakes before the pipeline does, so retries
  exercise the model on a real failure rather than on a trivial JSON typo.
- **Reproducibility.** A workspace is a complete record of what the agent
  saw. Bugs reproduce by re-running the workspace; we don't have to
  reconstruct the prompt context after the fact.

## Output envelope

Every run writes one self-contained output directory outside the repo (default
`~/mysteryevals/<date>/<time>/run-<brief>/`, override with `--output-root` /
`$MYSTERYEVALS_DIR`). It holds the `result.json` envelope, the `blueprint.json`,
per-step `logs/`, and the preserved `generator/` + `evaluators/<dimension>/`
agent workspaces — see `evaluation/README.md` → "Output directory" for the
layout. Each run gets its own subtree, so prior runs (including each agent's
`claude.stderr.log`) are never overwritten.

The envelope shape is version-tagged (`schema_version`). Top-level fields:
`run_id`, `started_at`, `ended_at`, `spec_dir`, `blueprint_path`,
`generation`, `mechanical[]`, `dimensions[]`, `run_error`, `summary`, and
`timing`. Each dimension carries its analyzer result, judge result, attempts,
and combined `overall` status. Consumers can distinguish "didn't run" from
"crashed during generation" by inspecting `run_error.stage`.

`timing` is a monotonic-clock breakdown (integer milliseconds) of every
pipeline stage plus per-dimension sub-steps, mirrored to stdout at the end of
each run. Because dimensions evaluate in parallel, the `dimensions` stage
duration is wall-clock (≈ the slowest dimension), not the sum of the
per-dimension durations; and a stage's duration is the wall-clock of the whole
stage **including retries**, so it can exceed the summed per-attempt
`duration_ms` under `generation`/`judge`. See `evaluation/README.md` for the
field-by-field shape.

## Retries

Each step (`generate`, `judge`) retries on transient failures, configured by its
`retries` count — covering CLI failures *and* schema validation of the model's
output, so a retry re-exercises the model on a real failure rather than a flake.
Per-attempt outcomes (`ok | cli_fail | schema_fail`) are recorded in the
envelope so we can tell whether retries are reducing flake or masking a
systematic bug. See `evaluation/README.md` → "Retries" for the per-step
retriable conditions and the default counts.

## Dimensions

Today's enabled set (`evaluation/dimensions/registry.json`):

| ID                  | Question                                                                                                    | Analyzer? |
|---------------------|-------------------------------------------------------------------------------------------------------------|-----------|
| `solve_depth`       | Is the case solvable; does the **shortest** route to the culprit need ≥ `minPathLength` distinct clues (from `story_brief.minPathLength`, else registry `min_clues`, else 3 — enforced on the main suspect only); and does every suspect have an elimination path (lengths **measured**, not floored)? Supersedes `solvability`. | No        |
| `fairness`          | Does the evidence **uniquely** point at the culprit? (No non-culprit is equally well supported.)            | No        |
| `timeline_coherence`  | Around the crime, do characters' `actual_actions` produce `what_happened` and place each suspect consistently with the clues that clear/implicate them? (`actual_actions` are authoritative; the prose `ground_truth.timeline` is a non-binding summary.) | No        |
| `knowledge_coherence` | Can each character know the clues they reveal (observability), and is every falsehood an *authored, intended* lie rather than an accidental contradiction (deception integrity)? | No        |
| `character_grounding` | Does each character have enough authored material that the runtime narrator won't need to fabricate?      | No        |
| `path_payoff`       | Does **every** authored path (solution, red herring, elimination) give the player a concrete payoff?        | No        |

The dimensions are an active work-in-progress. Expected near-term changes:

- The character-grounding probe topics are now a fixed generic baseline in
  `evaluation/dimensions/registry.json` — the character's own background and
  life, likes & dislikes, personality / attitude / appearance, and knowledge
  of the other characters, the locations, and the mystery — applied to every
  character in every mystery rather than hand-authored per spec.
- The schema's `red_herrings` field is named for the genre convention but
  obscures what it actually is: a set of leads pointing the investigator at
  the wrong conclusion, always with an authored way to disprove them. A
  rename to something like `false_leads` is on the table, along with making
  the "reward" for solving a false lead explicit in the schema (eliminates
  suspect X / unlocks clue Y / disproves false lead Z).
- Tier 2/3 dimensions (clue economy, red-herring quality, cover-up quality,
  narrative economy, resolution, path independence, interest, hook, tone) are
  intended but not yet in scope. The minimum-path-length aspect of challenge is
  now covered by `solve_depth`; broader challenge tuning is still future work.

### Adding a dimension

Three files:

- `evaluation/dimensions/<id>.md` — the judge's prose contract, including
  what it asks, judge instructions, and a documented output shape.
- `evaluation/dimensions/<id>.schema.ts` — the Zod schema for the judge's
  JSON output. The pipeline serializes this to JSON Schema, appends it to
  the system prompt, and uses it to validate the judge's response. When the
  prose and schema disagree, the schema is authoritative.
- `evaluation/checks/analyzers/<id>.mjs` — optional. A deterministic
  pre-check that runs before the judge.

No code changes elsewhere. The loader picks them up by ID.

## Spec file

Each `evaluation/specs/<id>/` directory holds **only** an `input.brief.json`;
there is no per-mystery `outcome.spec.json`.

The set of dimensions to run, and all dimension context (probe-topic
baselines, thresholds, …), lives centrally in
`evaluation/dimensions/registry.json` — the standard evaluation battery
applied to every blueprint. `loadDimensions()` reads it; `loadSpec()` reads
only the brief.

The motivation: a new mystery used to quietly lose dimension coverage if its
spec author forgot a dimension or its `context` (e.g. specs 002/003 silently
never ran `path_payoff`). With the battery centralized, every mystery gets the
same baseline treatment for free and runs stay comparable. Per-mystery
customization, if ever needed again, should re-enter through a different door
(e.g. opt-in per-dimension override files), not a mandatory spec file.

## Relationship to the old evaluator

The single-prompt evaluator at `packages/shared/src/evaluation/`
(`prompt.ts`, `schema.ts`) is **deprecated**. It is still wired into
`scripts/generate-blueprint.mjs` for post-generation verification (writes a
sibling `*.verification.json` file) and that path still works.

Direction:

- No new dimensions or features land in the old evaluator.
- The new pipeline is the only place evaluator work happens.
- A follow-up branch will delete the old evaluator and migrate the
  post-generation verification call to invoke the new pipeline (or a
  pipeline-aligned variant), then remove `docs/blueprint-evaluation.md`.

Until that follow-up lands, treat the old doc as historical. This doc is the
canonical reference.

## Intentionally out of scope (for now)

- **Multi-sample / K-run aggregation.** Each run evaluates one blueprint
  once. Sampling K blueprints per brief and aggregating verdicts is roadmap.
- **Judge self-consistency sampling.** Each dimension runs its judge once
  per attempt. Sampling the same judge multiple times and majority-voting
  is roadmap.
- **Run storage and visualization.** Runs live on disk in per-run output
  directories under the output root (default `~/mysteryevals/`). A storage
  layer and visualizer for run history is roadmap.
- **Action economy / time-to-solve.** Whether the mystery is solvable in
  reasonable wall-clock time at play time is not measured. Game-runtime
  concerns belong in a different harness.
