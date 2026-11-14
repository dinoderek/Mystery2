# Evaluation runbook

The one runbook for `./dev eval`: its commands, the config file, results and
exit codes. The design is `docs/evaluation-pipeline.md`. The trace, runtime and
playtest READMEs beside their code cover only what is particular to each.

## Commands

| Command | Does |
|---|---|
| `generate <brief>...` | Makes a blueprint per brief, then checks it. `--backend agent` (default) or `api`, `--model`, `--judge`, `--install`, `--parallelism` |
| `validate <file>` | Schema and mechanical checks, no model. `--brief` |
| `judge blueprint <file>` | Checks, analyzers and the blueprint judges. `--brief`, `--judges`, `--no-judges` |
| `judge game <session or trace>` | The `gm_*` judges on a played game (`evaluation/trace/README.md`). `--database`, `--judges`, `--no-judges` |
| `judge turn <cases or turn.json>...` | Replays one turn per case and judges it (`evaluation/runtime/README.md`). `--narrator`, `--ai-profile`, `--judges`, `--judge-binding`, `--concurrency` |
| `cases <trace>` | Turns a played game into runtime cases. `--out`, `--types`, `--max`, `--judges` |
| `play` | Self-play through the real server (`evaluation/playtest/README.md`). `--blueprint` or `--replay`, `--games`, `--judge` |
| `report <run>` | Writes `report.html` for a self-play run |

Every command takes `--config`, `--output-root` and `--model-override
<binding>=<model>`, which changes one binding's model for one run; the flag
repeats. `./dev eval <command> --help` lists the options. For `judge`, name the
subcommand: `./dev eval judge turn --help`.

## Quick start

```bash
# Judge a blueprint you already have (it needs its brief):
./dev eval judge blueprint path/to/blueprint.json --brief evaluation/specs/001-lighthouse-lens

# Only the schema and mechanical checks, no model:
./dev eval validate path/to/blueprint.json

# Generate one from a brief, then judge it:
./dev eval generate evaluation/specs/001-lighthouse-lens --judge
```

`generate` runs the Claude agent in its workspace through `generator-agent`
(`--backend agent`), or makes one OpenRouter call through `generator-api`
(`--backend api`). The API backend needs a model from `--model <OpenRouter id>`
or the config, and reads `OPENROUTER_API_KEY` from the environment, else
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
whose command cannot run, stops the command with an error naming it; no judge
is skipped silently. A wrapper may also stream its events as newline-delimited
JSON to `$EVAL_STREAM_FILE`, which never affects the result.

## Output

Every run writes under `--output-root`, else `$MYSTERYEVALS_DIR`, else
`~/mysteryevals`. It is outside the repo, and nothing is overwritten. A
blueprint run looks like this (the other harnesses name their own layout):

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

The agents' workspaces, each with its `claude.stderr.log`, survive for debugging.

## Result

`result.json` is written even when the run aborts. Its schema is
`evaluation/core/result.ts`, with one `schema_version` for every command.

- `run_error: { stage, message }`, set only when the run itself failed.
- `verdicts`: one per check or judge, with its status. A dimension's analyzer is
  `<dimension>.analyzer`; the dimension passes when it and its judge both do. A
  judge's entry holds its model call (model, prompt hash, time, cost, every
  attempt) and its full `answer`.
- `summary`: counts by status and one `passed` flag.
- `production`: for `generate`, the generation attempts.
- `timing`: monotonic milliseconds for each stage and dimension. The
  `dimensions` stage is wall-clock, roughly the slowest dimension, not the sum.
  A stage's duration includes its retries, and a failed stage records how long
  it ran, marked `failed`.

## Exit codes

The same for every command. **0**: everything passed. **1**: the run broke (an
unreadable file, a missing binding, `run_error` in the result). **2**: a check
or judge failed, or could not judge.

## Live progress

Every 20s (`EVAL_HEARTBEAT_MS`) a tick prints elapsed time, estimated thinking
tokens and the messages since the last tick; during the parallel judge phase it
shows `done/total`. `--quiet` keeps only the milestones. The raw stream,
`logs/<step>*.stream.jsonl`, is for watching only: the result comes from the
artifact the agent writes (`blueprint.json`, `verdict.json`).

## Retries

`retries: N` allows N more attempts after the first. A judge is retried on a
non-zero exit, a timeout, stdout that is not JSON, an `extract_path` miss, or an
answer failing the dimension's Zod schema. Generation is retried on the same,
and on output failing Blueprint V2 validation. Each attempt has its own log,
such as `judge-solve_depth.attempt-2.stderr.log`.

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

Only `clue_graph` and `age_appropriate` have analyzers
(`evaluation/checks/analyzers/`). To iterate on the evaluator, run `judge
blueprint` on a saved blueprint, so generation cost stays out of the loop, then
edit the brief, its `<id>.schema.ts` (where schema and brief disagree, the
schema wins), the analyzer, or `evaluation/prompts/judge-system.md`.
