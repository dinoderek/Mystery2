# Mystery blueprint evaluation pipeline

A walking-skeleton pipeline for evaluating Blueprint V2 generation against
an authored input brief, using a central, story-agnostic dimension battery.

**Status:** seven dimensions enabled (see `dimensions/registry.json`); multiple specs under `specs/`.

## What this is

Given:

- An **input brief** (`specs/<id>/input.brief.json`) — a `story_brief` of the
  same shape the production generator consumes. A spec directory contains only
  this file.
- The **standard dimension battery** (`dimensions/registry.json`) — the
  quality dimensions evaluated on every blueprint beyond the always-on
  mechanical checks, plus their default context (e.g. character-grounding
  probe topics). Central, not per-mystery.

The pipeline:

1. Generates a Blueprint V2 by shelling out to a pluggable LLM CLI
   (`config/cli.json` → `generate` step). Or skips generation if you pass
   `--blueprint <path>`.
2. Runs always-on **mechanical** checks (schema, brief-derived counts,
   `mustInclude`, cover-ups, orphan clues, and `requires_satisfiable` — the
   clue discovery graph references real clues, is acyclic, and keeps every
   solution clue reachable from ungated roots).
3. For each dimension in the registry, runs the **analyzer** (cheap
   deterministic code) and then the **judge** (shells out to the LLM CLI's
   `judge` step) and combines them into a per-dimension verdict.
4. Writes everything for the run into one self-contained output directory
   outside the repo (default `~/mysteryevals/<date>/<time>/run-<brief>/`): the
   `result.json` envelope, the generated `blueprint.json`, per-step CLI `logs/`,
   and the `generator/` + `evaluators/<dimension>/` agent workspaces.

## Quick start

```bash
# 1. Configure your LLM CLI bindings.
cp evaluation/config/cli.example.json evaluation/config/cli.json
# Edit cli.json to point at your wrapper scripts. The default uses the
# bundled wrappers in evaluation/config/wrappers/ which invoke `claude`.

# 2. Run end-to-end (generation + evaluation):
npm run eval -- --spec evaluation/specs/001-lighthouse-lens

# --spec also accepts a brief JSON file directly — no enclosing directory needed:
npm run eval -- --spec path/to/some.brief.json

# Or skip generation and evaluate an existing blueprint:
npm run eval -- \
  --spec evaluation/specs/001-lighthouse-lens \
  --blueprint path/to/blueprint.json
```

`--spec` takes either a spec directory containing `input.brief.json` or a path
to a brief JSON file. With a directory the run slug is the directory name; with
a file it is the file name (minus a trailing `.brief.json`/`.json`), or the
parent directory name when the file is itself `input.brief.json`.

## Layout

```
evaluation/
├── specs/                  # one directory per input brief (brief only)
│   └── 001-lighthouse-lens/
│       └── input.brief.json
├── dimensions/             # one .md per quality dimension (the judge prompt)
│   └── registry.json       # the standard battery + default per-dimension context
├── prompts/                # shared prompt fragments
│   └── judge-system.md
├── checks/
│   ├── mechanical.mjs      # always-on mechanical checks
│   ├── lib/clue-graph.mjs  # shared clue discovery-graph analysis
│   └── analyzers/          # optional per-dimension analyzer (.mjs); clue-graph.mjs
├── pipeline/
│   ├── run.mjs             # entrypoint
│   ├── cli-runner.mjs      # pluggable CLI shell-out
│   ├── load.mjs            # spec / dimension / analyzer loaders
│   └── envelope.mjs        # result envelope shape
├── config/
│   ├── cli.example.json    # template — copy to cli.json
│   └── wrappers/           # bundled default CLI wrappers
└── (no runs/ — output goes outside the repo, see below)
```

## Output directory

Every run writes one self-contained directory **outside the repo** so debug
iterations don't churn git. Default root is `$MYSTERYEVALS_DIR` or
`~/mysteryevals`; override with `--output-root <dir>`.

```
<root>/<date>/<time>/run-<brief>/
├── result.json                 the structured envelope (always written)
├── blueprint.json              the generated or supplied blueprint
├── logs/                       per-step CLI stdout/stderr/invocation +
│                               <step>.stream.jsonl (live agent event stream)
├── generator/                  generator agent workspace (preserved)
└── evaluators/<dimension>/     each judge agent workspace (preserved)
```

Each run gets its own `<date>/<time>/` subtree, so prior runs are never
overwritten or deleted — including each agent's `claude.stderr.log`, which makes
failures debuggable after the fact.

## Live progress

The agent steps can each run for many minutes, so the pipeline reports progress
as it goes (suppress with `--quiet` / `--no-progress` — milestone lines and the
log-path hints stay):

- The agent wrappers run `claude --output-format stream-json --verbose` and
  write the live event stream to `logs/<step>.stream.jsonl`. `tail -f` that file
  (the pipeline prints the path) for the raw, real-time stream. The per-step
  `logs/<step>.{stdout,stderr}.log` are also written live (not buffered to the
  end).
- The pipeline tails those streams and prints a **batched tick** on a fixed
  interval (default 20s, tune with `EVAL_HEARTBEAT_MS`). Each tick is a header
  with elapsed time and the running estimated-thinking-token total (summed from
  the stream's `thinking_tokens` deltas), followed by the digest messages that
  accumulated since the last tick — capped, with `+N more` when over. A quiet
  interval collapses to a single `· no new activity` line, where the climbing
  token total still shows the step is alive:

  ```
  [eval] generate · 7m20s · 39.4k tok
    > Tool: Write (blueprint.json)
    > Tool: Bash (node validate.mjs)
  [eval] generate · 8m40s · 52.1k tok · no new activity
  ```

- The parallel judge phase ticks with a `done/total` header, then a short
  per-judge block (token total + up to ~3 new messages); finished judges drop
  out, and each prints its own `[eval][<dim>] judge: pass|fail` verdict line:

  ```
  [eval] dimensions · 2m10s · 2/6 done
    fairness · 120k tok
      > Tool: Read (blueprint.json)
    solve_depth · 88k tok · no new activity
  ```

`<step>.stream.jsonl` is the tailable event log; the result contract is
unchanged — `generate`/`judge` still read their artifact (`blueprint.json` /
`verdict.json`) from the workspace, so the output format does not affect it.

## Pluggable CLI

The pipeline never imports an LLM SDK. Every model call is a subprocess.

`config/cli.json` defines two steps: `generate` and `judge`. Each has:

| field          | meaning                                                                                                              |
|----------------|----------------------------------------------------------------------------------------------------------------------|
| `cmd`          | The executable to invoke.                                                                                            |
| `args`         | Argument array. `{{system_prompt_file}}` and `{{user_message_file}}` are replaced with paths to temp files.          |
| `extract_path` | After parsing stdout as JSON, walk this dotted path. The extracted value (a string) is then JSON-parsed by the pipe. |
| `timeout_ms`   | Hard kill after this many milliseconds.                                                                              |
| `retries`      | Optional. Up to N additional attempts on transient failures (total = 1 + N). Default 0. See "Retries" below.         |

To bind a different LLM CLI: write a wrapper that takes the two paths as
args, calls your CLI, and prints `{ "result": "<model-output>" }` (or any
shape whose `extract_path` resolves to the model's output string). For the live
digest, also stream your CLI's events (newline-delimited JSON) to the path in
`$EVAL_STREAM_FILE` when set; this is optional and never affects the result.

## Execution graph

- The enabled dimensions are evaluated **in parallel** via `Promise.all`.
  Analyzer (in-process) and judge (CLI shell-out) for each dimension run
  sequentially within the dimension, but the dimensions overlap.
- Generation, mechanical checks, and blueprint schema validation all run
  before any dimension is dispatched.
- A `result.json` envelope is **always written**, even when the run aborts
  mid-flight (e.g., generation fails). On whole-run failure the envelope
  carries `run_error: { stage, message }` and exits non-zero. Consumers can
  distinguish "didn't run" from "crashed in generation" by the presence and
  contents of the envelope.

## Retries

`retries: N` on a step config gives that step up to N additional attempts
after the first (total = 1 + N), configured per-step (generate and judge are
independent). The code default is `0` (no retries); the bundled `cli.json` sets
`1` (up to 2 attempts).

| step       | retriable conditions                                                                            |
|------------|-------------------------------------------------------------------------------------------------|
| `generate` | CLI non-zero exit, timeout, stdout not JSON, `extract_path` miss, Blueprint V2 Zod validation failure. |
| `judge`    | All of the above, plus Zod validation failure of the model's structured output (`judge_parse`). |

Per-attempt diagnostics are written to the envelope:

- `generation.attempts: [{ attempt, outcome: "ok"|"cli_fail", duration_ms, error? }]`
- `dimensions[].judge.attempts: [...]` on success, or
  `dimensions[].error.attempts: [...]` on final failure, with outcomes
  `"ok" | "cli_fail" | "schema_fail"`.
- `summary.retries.generate` and `summary.retries.judge_total` aggregate
  the extra attempts used.

When a step has `retries > 0`, each attempt gets its own log files:
`generate.attempt-1.stdout.log`, `judge-solve_depth.attempt-2.stderr.log`,
etc. When `retries: 0` (the default) the original filenames are kept
(`generate.stdout.log`).

## Mechanical vs analyzer vs judge

Three result kinds, one envelope (rationale in `docs/evaluation-pipeline.md`
→ "Architecture: three tiers"):

- **Mechanical** — always-on deterministic checks (schema, brief-derived
  counts, orphan clues). Failure means the artifact is broken.
- **Analyzer** — optional deterministic per-dimension pre-check
  (`checks/analyzers/<id>.mjs`). None are implemented today.
- **Judge** — one LLM call per dimension via the pluggable CLI, using
  `dimensions/<id>.md` (prompt) + `dimensions/<id>.schema.ts` (Zod). The
  pipeline appends the schema as JSON Schema and validates the response; a
  mismatch is a `judge_parse` error.

A dimension's `overall` is `pass` only if every sub-result it produced is
`pass`; see `docs/evaluation-pipeline.md` → "Combining results" for the full
pass / fail / error / skipped rules.

## Enabled dimensions

Six dimensions run on every blueprint (defined in `dimensions/registry.json`).
For what each one asks, see the dimension table in
`docs/evaluation-pipeline.md` → "Dimensions":

- `solve_depth` — solvable, deep enough (brief `minPathLength` floor, else
  registry `min_clues`, else 3), and every suspect has a measured elimination
  path.
- `fairness` — the evidence uniquely points at the culprit.
- `timeline_coherence` — positions around the crime are consistent
  (`actual_actions` authoritative).
- `knowledge_coherence` — observability + deception integrity.
- `character_grounding` — enough authored material to avoid narrator fabrication.
- `path_payoff` — every authored path pays off.

All are judge-only; no analyzers are implemented yet.

## Iterating the evaluator

The evaluator itself is the moving target. To improve it:

- Edit `dimensions/<id>.md` — that's the judge prompt (prose contract).
- Edit `dimensions/<id>.schema.ts` — that's the Zod schema injected into
  the prompt and used to validate the judge's output. If the prose and
  schema drift, the schema is treated as authoritative in the system
  prompt.
- Edit `checks/analyzers/<id>.mjs` — that's the deterministic pre-check.
- Re-run with `--blueprint` against a saved blueprint to keep the
  generation cost out of the loop.

`prompts/judge-system.md` is the shared system prefix for all judge calls;
edit it to change how the judge frames itself across dimensions.

## Output envelope

```jsonc
{
  "schema_version": "0.3",
  "run_id": "...",
  "started_at": "...",
  "ended_at": "...",
  "spec_dir": "evaluation/specs/001-lighthouse-lens",
  "blueprint_path": "/Users/you/mysteryevals/<date>/<time>/run-<brief>/blueprint.json",
  "generation": { "skipped": false, "source": "cli", "duration_ms": 42000, "cmd": "..." },
  "mechanical": [
    { "id": "schema_valid", "kind": "mechanical", "status": "pass", "details": null }
  ],
  "dimensions": [
    {
      "id": "solve_depth",
      "analyzer": { "status": "pass", "details": { ... }, "kind": "analyzer" },
      "judge": { "status": "pass", "reasoning": "...", "raw": { ... }, "kind": "judge" },
      "overall": "pass"
    }
  ],
  "summary": {
    "mechanical": { "pass": 7, "fail": 0 },
    "dimensions":  { "pass": 4, "fail": 2, "error": 0, "skipped": 0 },
    "retries":     { "generate": 0, "judge_total": 0 }
  },
  "timing": {
    "total_ms": 92400,
    "clock": "monotonic",
    "stages": [
      { "name": "load_spec", "duration_ms": 2 },
      { "name": "build_generation_input", "duration_ms": 340 },
      { "name": "generate", "duration_ms": 44100, "detail": { "attempts": 1 } },
      { "name": "mechanical", "duration_ms": 12, "detail": { "checks": 7 } },
      { "name": "blueprint_schema_validate", "duration_ms": 8 },
      { "name": "dimensions", "duration_ms": 47800, "detail": { "count": 6, "parallel": true } }
    ],
    "dimensions": [
      {
        "id": "solve_depth",
        "duration_ms": 47800,
        "steps": [
          { "name": "compose_prompt", "duration_ms": 18 },
          { "name": "judge", "duration_ms": 47760, "detail": { "attempts": 1 } }
        ]
      }
    ]
  }
}
```

## Timing

Every run records a `timing` block (monotonic clock, integer milliseconds) and
prints a matching summary to stdout. It covers each top-level stage —
`load_spec`, `load_dimensions`, `load_cli_config` (or `load_blueprint` when
`--blueprint` is passed), `build_generation_input`, `generate`,
`write_blueprint`, `mechanical`, `blueprint_schema_validate`,
`load_judge_system_prompt`, and the parallel `dimensions` phase — plus
per-dimension sub-steps (`load_analyzer`, `analyzer`, `load_definition`,
`compose_prompt`, `judge`).

Because dimensions run in parallel, the `dimensions` stage duration is
wall-clock (≈ the slowest dimension), not the sum; each entry under
`timing.dimensions` carries its own wall-clock so the overlap is visible. A
stage duration is the wall-clock of the whole stage **including retries**, so it
can exceed the sum of the per-attempt `duration_ms` values under
`generation`/`judge`. A stage that failed still records its duration with
`"failed": true`. The result-write itself is reported only on the
`[eval] result:` stdout line — it can't appear inside the file it writes.

## What's next

Roadmap lives in `docs/evaluation-pipeline.md` → "Intentionally out of scope
(for now)": run storage/visualizer, Tier 2 dimensions, K-run aggregation, and
judge self-consistency sampling.

The `npm run eval` script wraps `node evaluation/pipeline/run.mjs`; pass
pipeline flags after `--`.
