# Evaluation runbook

Commands, config, results and exit codes for `./dev eval`. Design:
`docs/evaluation-pipeline.md`; harness details: the READMEs beside their code.

## Commands

| Command | Does |
|---|---|
| `generate <brief>...` | Makes a blueprint per brief, then checks it. `--backend agent` (default) or `api`, `--model`, `--judge`, `--install`, `--parallelism` |
| `validate <file>` | Schema and mechanical checks, no model. `--brief` |
| `judge blueprint <file>` | Checks, analyzers and the blueprint judges. `--brief`, `--judges`, `--no-judges` |
| `judge game <session or trace>` | The `gm_*` judges on a played game (`evaluation/trace/README.md`). `--database`, `--judges`, `--no-judges` |
| `judge turn <cases or turn.json>...` | Replays one turn per case and judges it (`evaluation/runtime/README.md`). `--narrator`, `--ai-profile <ai.json name>`, `--judges`, `--judge-binding`, `--concurrency` |
| `cases <trace>` | Turns a played game into runtime cases. `--out`, `--types`, `--max`, `--judges` |
| `play` | Self-play through the real server (`evaluation/playtest/README.md`). `--blueprint` or `--replay`, `--games`, `--judge` |
| `report <run>` | Writes `report.html` for a self-play run |
| `label <game>` | A local page (loopback, no model) to label a truth-set game's turns by kind of fault (`evaluation/truth/README.md`). `--pass`, `--by` |
| `score <results>...` | Scores stored results against the truth set, no model: Wilson-ranged shares per judge and kind, agreement, every subset, the smallest for a bar. `--truth`, `--out`, `--min-found` |
| `compare <results A> <results B>` | Compares two stored runs, no model, on the units both judged: per judge and kind, a difference counts only beyond each run's own sample variation (exact sign test); unmeasured with one sample. Delay and usage per run. `--truth`, `--out` |

Every command takes `--config`, `--output-root` and a repeatable
`--model-override <binding>=<model>`, which changes one binding's model for one
run. `./dev eval <command> --help` explains the rest; for `judge`, name the
subcommand.

A blueprint beside `brief.json` needs no `--brief`. For blueprint and game
judging, `--judges` and `--no-judges` mark unselected judges skipped.

## Quick start

```bash
# Judge a stored blueprint with its brief:
./dev eval judge blueprint path/to/blueprint.json --brief evaluation/specs/001-lighthouse-lens

# Mechanical checks only, no model:
./dev eval validate path/to/blueprint.json

# Generate from a brief, then judge:
./dev eval generate evaluation/specs/001-lighthouse-lens --judge
```

`generate` runs the Claude agent through `generator-agent` (`--backend agent`),
or makes one OpenRouter call through `generator-api` (`--backend api`). The API backend needs a `--model <OpenRouter id>`
or config model, and reads `OPENROUTER_API_KEY` from the environment, else
`.env.local` in the config root. One run holds a subject for each brief,
backend and model. A blueprint that never passes the schema is kept and fails
its check. `--install` copies a blueprint that passed its mechanical checks into
`blueprints/` in the config root; it never replaces a file there, and a failed
install exits 1.

## Config

`evaluation/config.json` (git-ignored) names each binding. Without it,
`evaluation/config.example.json` is the fallback; `--config <file>` replaces
both. A binding has:

- `cmd` (repo-relative when it holds a `/`, else found on PATH) and `args`,
  where `{{system_prompt_file}}` and `{{user_message_file}}` become file paths;
- `model`, passed to the wrapper in `$EVAL_MODEL`;
- `extract_path`, the dotted path to the answer in the JSON the wrapper prints
  (`null` when stdout is the answer);
- `timeout_ms`, and `retries`: extra attempts after the first.

The bindings are `generator-agent`, `generator-api`, `blueprint-judge`,
`game-judge`, `turn-judge`, `investigator`, `narrator-claude`,
`narrator-openai`, `narrator-stub` and `judge-stub`. A missing binding, or one
whose command cannot run, stops the command, naming it; no judge
is skipped silently. A wrapper may stream JSON events to
`$EVAL_STREAM_FILE`; they never affect the result.

## Output

Every run writes under `--output-root`, else `$MYSTERYEVALS_DIR`, else
`~/mysteryevals`. It is outside the repo; nothing is overwritten. A
blueprint run looks like this:

```
<root>/<date>/<time>-<command>/
├── run.json                 the index: the run and one line per subject
└── <subject>/
    ├── result.json          the result
    ├── blueprint.json       the stored blueprint, and brief.json beside it
    ├── logs/                each call's prompts, per-attempt logs and <step>*.stream.jsonl
    ├── generator/           generator agent workspace (`--backend agent`)
    └── evaluators/<dimension>/  each judge's agent workspace
```

## Result

`result.json` is written even when the run aborts. Its schema is
`evaluation/core/result.ts`.

- `run_error: { stage, message }`, set only when the run failed.
- `verdicts`: one per check or judge, with its status. A dimension's analyzer is
  `<dimension>.analyzer`; the dimension passes when it and its judge both do. A
  judge's entry holds its model call (model, prompt hash, time, cost, every
  attempt) and its full `answer`.
- `summary`: counts by status and one `passed` flag.
- `production`: for `generate`, the generation attempts. The API wrapper reports
  `usage.cost` as `total_cost_usd`; absent or invalid cost stays null.
- `timing`: monotonic milliseconds for each stage and dimension. The
  `dimensions` stage is wall-clock, roughly the slowest dimension, not the sum.
  A stage's duration includes retries; a failed stage records its time, marked
  `failed`.

## Exit codes

The same for every command. **0**: everything passed. **1**: the run broke (an
unreadable file, a missing binding, `run_error` in the result). **2**: a check
or judge failed, or could not judge.

## Live progress

Every 20s (`EVAL_HEARTBEAT_MS`) a tick prints elapsed time and the messages since the
last tick; during the judge phase it
shows `done/total`. `--quiet` keeps milestones. The raw stream
(`logs/<step>*.stream.jsonl`) is for watching only.

## Retries

A judge is retried (`retries`) on a non-zero exit, a timeout, stdout that is not
JSON, an `extract_path` miss, or an answer failing the dimension's Zod schema. Generation is retried on the same,
and on output failing Blueprint V2 validation.

## Blueprint dimensions

`evaluation/core/registry.ts` is the battery, run on every blueprint. Each
judge's full question is its brief, `evaluation/dimensions/<id>.md`.

- `solve_depth`: solvable, deep enough (the brief's `minPathLength`, else the
  registry's `min_clues`), and every suspect has a measured elimination path.
- `fairness`: the evidence points uniquely at the culprit.
- `timeline_coherence`: positions around the crime are consistent
  (`actual_actions` is authoritative).
- `knowledge_coherence`: what each character could observe, the integrity of
  their deceptions, and whether every physical fact agrees across fields with
  nothing given away before its clue is found.
- `character_grounding`: enough authored material that the narrator need not
  fabricate.
- `path_payoff`: every authored path pays off.
- `clue_graph`: the analyzer checks the discovery graph is sound; the judge asks
  whether the gating is fun and fair.
- `age_appropriate`: the analyzer screens each player-facing string with the
  Flesch–Kincaid grade for `metadata.target_age`; the judge checks what the
  formula cannot see against `packages/shared/src/age-profile.ts`.

Analyzers live in `evaluation/checks/analyzers/`. To iterate on a judge, run `judge
blueprint` on a saved blueprint, then edit the brief, its `<id>.schema.ts` (where schema and brief disagree, the
schema wins), the analyzer, or `evaluation/prompts/judge-system.md`.
