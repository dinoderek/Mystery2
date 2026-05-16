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
node evaluation/pipeline/run.mjs --spec evaluation/specs/001-lighthouse-lens

# Or skip generation and evaluate an existing blueprint:
node evaluation/pipeline/run.mjs \
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

To bind a different LLM CLI: write a wrapper that takes the two paths as
args, calls your CLI, and prints `{ "result": "<model-output>" }` (or any
shape whose `extract_path` resolves to the model's output string).

## Mechanical vs analyzer vs judge

Three result kinds, one envelope.

- **Mechanical** — runs on every blueprint regardless of outcome spec.
  Failure means the artifact is broken (schema invalid, mustInclude missing,
  brief counts wrong, orphan clues, etc.).
- **Analyzer** — deterministic code per dimension. Cheap. Runs first, in
  process. Catches obvious structural failures before paying for an LLM
  judgment.
- **Judge** — LLM call per dimension via the pluggable CLI. Each dimension
  has a `dimensions/<id>.md` file with the judge instructions and required
  output shape.

A dimension's `overall` is `pass` only if every sub-result it produced is
`pass`. If only an analyzer is defined and it passes, that's a pass. If
only a judge is configured and it passes, that's a pass.

## Tier 1 dimensions (current scope)

1. **Solvability** — analyzer + judge.
2. **Fairness / convergence** — analyzer + judge.
3. **Internal coherence** — analyzer + judge.
4. **Character grounding (anti-hallucination)** — analyzer + judge.

Tiers 2 and 3 (clue economy, red-herring quality, cover-up quality, narrative
economy, resolution, path independence, challenge, interest, hook, tone)
are not yet in scope.

## Iterating the evaluator

The evaluator itself is the moving target. To improve it:

- Edit `dimensions/<id>.md` — that's the judge prompt.
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

## What's next

- Storage and visualizer for run history.
- Tier 2 dimensions.
- Multiple samples per brief (K-run aggregation).
- Judge self-consistency sampling.
