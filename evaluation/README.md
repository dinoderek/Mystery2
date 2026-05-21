# Mystery blueprint evaluation pipeline

A walking-skeleton pipeline for evaluating Blueprint V2 generation against
an authored input spec and an authored outcome spec.

**Status:** spec 001 (Lighthouse Lens), Tier 1 dimensions only.

## What this is

Given:

- An **input brief** (`specs/<id>/input.brief.json`) — a `story_brief` of the
  same shape the production generator consumes.
- An **outcome spec** (`specs/<id>/outcome.spec.json`) — the list of quality
  dimensions to evaluate beyond the always-on mechanical checks.

The pipeline:

1. Generates a Blueprint V2 by shelling out to a pluggable LLM CLI
   (`config/cli.json` → `generate` step). Or skips generation if you pass
   `--blueprint <path>`.
2. Runs always-on **mechanical** checks (schema, brief-derived counts,
   `mustInclude`, cover-ups, orphan clues).
3. For each dimension in the outcome spec, runs the **analyzer** (cheap
   deterministic code) and then the **judge** (shells out to the LLM CLI's
   `judge` step) and combines them into a per-dimension verdict.
4. Writes a single structured result envelope (`runs/<run_id>/result.json`)
   plus the generated blueprint and per-step CLI logs.

## Quick start

```bash
# 1. Configure your LLM CLI bindings.
cp evaluation/config/cli.example.json evaluation/config/cli.json
# Edit cli.json to point at your wrapper scripts. The default uses the
# bundled wrappers in evaluation/config/wrappers/ which invoke `claude`.

# 2. Run end-to-end (generation + evaluation):
npm run eval -- --spec evaluation/specs/001-lighthouse-lens

# Or skip generation and evaluate an existing blueprint:
npm run eval -- \
  --spec evaluation/specs/001-lighthouse-lens \
  --blueprint path/to/blueprint.json
```

## Layout

```
evaluation/
├── specs/                  # one directory per input brief + outcome spec
│   └── 001-lighthouse-lens/
│       ├── input.brief.json
│       └── outcome.spec.json
├── dimensions/             # one .md per quality dimension (the judge prompt)
├── prompts/                # shared prompt fragments
│   └── judge-system.md
├── checks/
│   ├── mechanical.mjs      # always-on mechanical checks
│   └── analyzers/          # one .mjs per dimension that has a deterministic side
├── pipeline/
│   ├── run.mjs             # entrypoint
│   ├── cli-runner.mjs      # pluggable CLI shell-out
│   ├── load.mjs            # spec / dimension / analyzer loaders
│   └── envelope.mjs        # result envelope shape
├── config/
│   ├── cli.example.json    # template — copy to cli.json
│   └── wrappers/           # bundled default CLI wrappers
└── runs/                   # gitignored; one directory per run
```

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
shape whose `extract_path` resolves to the model's output string).

## Execution graph

- The four Tier 1 dimensions are evaluated **in parallel** via `Promise.all`.
  Analyzer (in-process) and judge (CLI shell-out) for each dimension run
  sequentially within the dimension, but the four dimensions overlap.
- Generation, mechanical checks, and blueprint schema validation all run
  before any dimension is dispatched.
- A `result.json` envelope is **always written**, even when the run aborts
  mid-flight (e.g., generation fails). On whole-run failure the envelope
  carries `run_error: { stage, message }` and exits non-zero. Consumers can
  distinguish "didn't run" from "crashed in generation" by the presence and
  contents of the envelope.

## Retries

`retries: N` on a step config gives that step up to N additional attempts
after the first (total = 1 + N). Retries are configured per-step (generate
and judge are independent).

| step       | retriable conditions                                                                            |
|------------|-------------------------------------------------------------------------------------------------|
| `generate` | CLI non-zero exit, timeout, stdout not JSON, `extract_path` miss.                               |
| `judge`    | All of the above, plus Zod validation failure of the model's structured output (`judge_parse`). |

Per-attempt diagnostics are written to the envelope:

- `generation.attempts: [{ attempt, outcome: "ok"|"cli_fail", duration_ms, error? }]`
- `dimensions[].judge.attempts: [...]` on success, or
  `dimensions[].error.attempts: [...]` on final failure, with outcomes
  `"ok" | "cli_fail" | "schema_fail"`.
- `summary.retries.generate` and `summary.retries.judge_total` aggregate
  the extra attempts used.

When a step has `retries > 0`, each attempt gets its own log files:
`generate.attempt-1.stdout.log`, `judge-solvability.attempt-2.stderr.log`,
etc. When `retries: 0` (the default) the original filenames are kept
(`generate.stdout.log`).

## Mechanical vs analyzer vs judge

Three result kinds, one envelope.

- **Mechanical** — runs on every blueprint regardless of outcome spec.
  Failure means the artifact is broken (schema invalid, brief counts wrong,
  orphan clues, etc.).
- **Analyzer** — deterministic code per dimension. Cheap. Runs first, in
  process. Catches obvious structural failures before paying for an LLM
  judgment.
- **Judge** — LLM call per dimension via the pluggable CLI. Each dimension
  has a `dimensions/<id>.md` file with the judge instructions and a
  co-located `dimensions/<id>.schema.ts` Zod schema for the judge's JSON
  output. The pipeline serializes the Zod schema as JSON Schema, appends it
  to the system prompt, and validates the judge's response against it. A
  schema mismatch produces a `judge_parse` error in the envelope.

A dimension's `overall` is `pass` only if every sub-result it produced is
`pass`. If only an analyzer is defined and it passes, that's a pass. If
only a judge is configured and it passes, that's a pass.

## Tier 1 dimensions (current scope)

1. **Solvability** — judge only.
2. **Fairness / convergence** — judge only.
3. **Internal coherence** — judge only.
4. **Character grounding (anti-hallucination)** — judge + optional
   context-driven analyzer (skipped unless the outcome spec supplies
   `min_chars` / `min_flavor_items`).

Analyzers exist only where they add signal not already encoded in
`BlueprintV2Schema.superRefine`. If a structural rule should always hold,
the right home is the schema, not an evaluation analyzer.

Tiers 2 and 3 (clue economy, red-herring quality, cover-up quality, narrative
economy, resolution, path independence, challenge, interest, hook, tone)
are not yet in scope.

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
  "schema_version": "0.1",
  "run_id": "...",
  "started_at": "...",
  "ended_at": "...",
  "spec_dir": "evaluation/specs/001-lighthouse-lens",
  "blueprint_path": "evaluation/runs/.../blueprint.json",
  "generation": { "skipped": false, "source": "cli", "duration_ms": 42000, "cmd": "..." },
  "mechanical": [
    { "id": "schema_valid", "kind": "mechanical", "status": "pass", "details": null }
  ],
  "dimensions": [
    {
      "id": "solvability",
      "analyzer": { "status": "pass", "details": { ... }, "kind": "analyzer" },
      "judge": { "status": "pass", "reasoning": "...", "raw": { ... }, "kind": "judge" },
      "overall": "pass"
    }
  ],
  "summary": {
    "mechanical": { "pass": 9, "fail": 1 },
    "dimensions":  { "pass": 3, "fail": 1, "error": 0 }
  }
}
```

## Running under Claude Code (web)

In Claude Code on the web there is no shell access to external LLM CLIs, but
the in-session assistant can dispatch subagents and read/write files. The
pipeline still shells out to a `cmd` per `config/cli.json` — we just point
that `cmd` at a wrapper that talks to the assistant via a file bus instead
of an external process.

```
pipeline ──spawn──► node file-bus.mjs ──write──► evaluation/agent-bus/inbox/<id>/
                          │                              │
                          │                              ▼
                          │                       dispatcher (the session
                          │                       assistant) reads the
                          │                       request, runs a subagent,
                          │                       writes the reply
                          │                              │
                          └◄──poll──── evaluation/agent-bus/outbox/<id>.json
```

### One-time setup

```bash
cp evaluation/config/cli.claude-code.example.json evaluation/config/cli.json
```

This points both `generate` and `judge` at
`evaluation/config/wrappers/file-bus.mjs`. Timeouts and retries are
unchanged from the default config.

### Running an eval

1. Start the pipeline in a background bash:
   `npm run eval -- --spec evaluation/specs/001-lighthouse-lens`
2. Ask the session assistant to "process the agent bus." The assistant
   polls `evaluation/agent-bus/inbox/` and for each new request `<id>/`:
   - reads `system.txt` and `user.txt`,
   - dispatches a `general-purpose` subagent with the system prompt and
     user message verbatim, instructed to return only the JSON object the
     prompt asks for (no markdown fences, no commentary, no tool calls),
   - writes `evaluation/agent-bus/outbox/<id>.json` as
     `{ "result": "<subagent reply>" }`.
3. The wrapper picks up the response and prints it to stdout; the
   pipeline continues exactly as if a CLI had answered.
4. The assistant's loop terminates when the inbox has been empty for
   >30s and `pgrep -f 'evaluation/pipeline/run.mjs'` returns nothing.

### File bus contract

| Path | Shape | Producer |
|------|-------|----------|
| `agent-bus/inbox/<id>/system.txt` | system prompt verbatim | wrapper |
| `agent-bus/inbox/<id>/user.txt`   | user message verbatim  | wrapper |
| `agent-bus/inbox/<id>/request.json` | `{ id, step, system_path, user_path, created_at, deadline_at, pipeline_timeout_ms }` | wrapper |
| `agent-bus/outbox/<id>.json`       | `{ "result": "<text>" }` — `result` is the model output as a string | dispatcher |
| `agent-bus/outbox/<id>.error.json` | `{ "error": "<message>" }` — surfaces a dispatcher-side failure to the pipeline (triggers a retry per `cli.json`) | dispatcher |

`<id>` is `<step>-<utc-timestamp>-<uuid8>` (e.g.
`judge-20260521T101530-9f3ab12c`). The step prefix makes the inbox easy to
scan when debugging.

The wrapper cleans up its own inbox/outbox files on exit, so a successful
run leaves `evaluation/agent-bus/` empty. The directory is gitignored.

### Timeouts

The wrapper exits 15s before the pipeline's configured `timeout_ms` so the
pipeline gets a usable stderr instead of a generic SIGKILL message. Tune
`timeout_ms` (and the matching positional arg in `args`) in `cli.json` if
the assistant needs more time per request.

### Retries

`retries` semantics are identical to CLI mode: a dispatcher error
(`<id>.error.json`) or a wrapper timeout exits non-zero, and
`runCliWithRetries` retries up to `retries` more times. Each attempt gets
its own request id and its own log files under `runs/<run_id>/logs/`.

## What's next

- Storage and visualizer for run history.
- Tier 2 dimensions.
- Multiple samples per brief (K-run aggregation).
- Judge self-consistency sampling.

The `npm run eval` script wraps `node evaluation/pipeline/run.mjs`; pass
pipeline flags after `--`.
