# Blueprint evaluation pipeline

Generates a Blueprint V2 from an authored brief and judges it against the
standard dimension battery. This is the runbook; the design — tiers, why one
judge per dimension, workspaces, how results combine, adding a dimension — is
`docs/evaluation-pipeline.md`.

## Quick start

```bash
# 1. Bind the LLM CLI. The example uses the bundled wrappers in
#    evaluation/config/wrappers/, which invoke `claude`.
cp evaluation/config/cli.example.json evaluation/config/cli.json

# 2. Generate and judge:
npm run eval -- --spec evaluation/specs/001-lighthouse-lens

# Judge an existing blueprint, skipping generation:
npm run eval -- --spec evaluation/specs/001-lighthouse-lens --blueprint path/to/blueprint.json
```

`npm run eval` is `node evaluation/pipeline/run.mjs`; pass its flags after `--`
and see `--help` for the rest. `--spec` takes a spec directory (which holds only
`input.brief.json`) or a brief file directly; the run is named after the
directory, or after the file minus `.brief.json` or `.json`.

`cli.json` is gitignored and has no fallback. Without it generation refuses to
start, and a `--blueprint` run still runs the mechanical checks and analyzers
but skips every judge (`judge: skipped (no cli.json judge step)`).

The process exits non-zero only when the run itself breaks (`run_error` in the
envelope). A failing check or dimension still exits 0; read the summary.

## Output directory

Every run writes one self-contained directory outside the repo, so debug
iterations don't churn git:

```
<root>/<date>/<time>/run-<brief>/
├── result.json              the envelope (always written)
├── blueprint.json           the generated or supplied blueprint
├── logs/                    per-step CLI stdout/stderr/invocation and <step>.stream.jsonl
├── generator/               generator agent workspace
└── evaluators/<dimension>/  each judge's agent workspace
```

The root is `--output-root`, else `$MYSTERYEVALS_DIR`, else `~/mysteryevals`.
Each run gets its own `<date>/<time>/` subtree and nothing is overwritten, so
the agents' workspaces — including each one's `claude.stderr.log` — survive for
debugging after the fact.

## Result envelope

`result.json` is written even when the run aborts, so "didn't run" and "crashed
in generation" are distinguishable. Its shape is documented at the top of
`evaluation/pipeline/envelope.mjs`. Where to look:

- `run_error: { stage, message }` — set only when the run itself failed.
- `summary` — mechanical and per-dimension counts, and retries used. There is
  no overall verdict; consumers decide what is ship-ready.
- `dimensions[].overall`, with the analyzer and judge results beside it; a
  judge's full answer is under `judge.raw`.
- `generation.attempts`, `dimensions[].judge.attempts` (or `error.attempts` on
  final failure) — one entry per attempt, with its outcome and error.

## Live progress

The agent steps can each run for many minutes, so the pipeline reports as it
goes. `--quiet` (or `--no-progress`) suppresses the ticks but keeps the
milestone lines and log paths.

- The wrappers write the agent's live event stream to `logs/<step>.stream.jsonl`
  (the pipeline prints the path); `tail -f` it for the raw stream. The per-step
  stdout/stderr logs are also written live.
- Every 20s (`EVAL_HEARTBEAT_MS`) the pipeline prints a tick: elapsed time, an
  estimated thinking-token total, and the messages since the last tick. A quiet
  interval collapses to `· no new activity`; a climbing token total still shows
  the step is alive.
- During the parallel judge phase a tick shows `done/total` and a short block
  per running judge. Each judge prints its own `[eval][<dim>] judge:` line when
  it finishes.

```
[eval] generate · 7m20s · 39.4k tok
  > Tool: Write (blueprint.json)
  > Tool: Bash (node validate.mjs)
[eval] generate · 8m40s · 52.1k tok · no new activity
```

The stream is for watching only. The result still comes from the artifact the
agent writes in its workspace (`blueprint.json`, `verdict.json`).

## Pluggable CLI

The pipeline never imports an LLM SDK; every model call is a subprocess.
`evaluation/config/cli.json` binds two steps, `generate` and `judge`. Its fields
are explained in the `_comment` of `evaluation/config/cli.example.json`.

To bind another CLI, write a wrapper that:

- takes the system-prompt file and user-message file as arguments
  (`{{system_prompt_file}}`, `{{user_message_file}}` in `args`);
- prints JSON on stdout whose `extract_path` (e.g. `result`) is the model's
  output string, which the pipeline then parses as JSON;
- optionally streams its events as newline-delimited JSON to `$EVAL_STREAM_FILE`
  for the live digest. This never affects the result.

## Retries

`retries: N` on a step allows N more attempts after the first. Steps are
configured independently. The code default is 0; the example config sets 1.

| Step | Retried on |
|---|---|
| `generate` | non-zero exit, timeout, stdout not JSON, `extract_path` miss, output failing Blueprint V2 validation |
| `judge` | all of the above, plus output failing the dimension's Zod schema |

With `retries > 0` each attempt gets its own logs
(`generate.attempt-1.stdout.log`, `judge-solve_depth.attempt-2.stderr.log`);
with 0 the names carry no attempt number (`generate.stdout.log`).

## Timing

Every run records a `timing` block in the envelope (monotonic clock, integer
milliseconds) and prints a matching summary: each top-level stage, and each
dimension's own steps (analyzer, prompt composition, judge).

- The `dimensions` stage is wall-clock, roughly the slowest dimension, not the
  sum; each dimension's entry carries its own duration so the overlap is
  visible.
- A stage's duration includes its retries, so it can exceed the sum of the
  per-attempt `duration_ms` values.
- A stage that failed still records how long it ran, marked `failed`.
- Writing `result.json` is timed only on the `[eval] result:` stdout line; it
  cannot appear inside the file it writes.

## Enabled dimensions

`evaluation/dimensions/registry.json` is the battery, run on every blueprint.
Each dimension's full question is its brief, `evaluation/dimensions/<id>.md`:

- `solve_depth` — solvable, deep enough (the brief's `minPathLength`, else the
  registry's `min_clues`), and every suspect has a measured elimination path.
- `fairness` — the evidence points uniquely at the culprit.
- `timeline_coherence` — positions around the crime are consistent
  (`actual_actions` authoritative).
- `knowledge_coherence` — what each character could observe, and the integrity
  of their deceptions.
- `character_grounding` — enough authored material that the narrator need not
  fabricate.
- `path_payoff` — every authored path pays off.
- `clue_graph` — the analyzer checks the discovery graph is sound; the judge
  asks whether the gating is fun and fair.
- `age_appropriate` — the analyzer screens every player-facing string with the
  Flesch–Kincaid grade for `metadata.target_age`; the judge assesses what the
  formula can't see against the age profile in
  `packages/shared/src/age-profile.ts`.

Only `clue_graph` and `age_appropriate` have analyzers
(`evaluation/checks/analyzers/`); the rest are judge-only.

## Iterating the evaluator

The evaluator is the moving target. Re-run with `--blueprint` against a saved
blueprint to keep generation cost out of the loop, then edit:

- `evaluation/dimensions/<id>.md` — a judge's brief.
- `evaluation/dimensions/<id>.schema.ts` — its output schema, appended to the
  prompt and used to validate the answer. Where brief and schema disagree, the
  schema wins.
- `evaluation/checks/analyzers/<id>.mjs` — a deterministic pre-check.
- `evaluation/prompts/judge-system.md` — the system prefix shared by every
  judge.
