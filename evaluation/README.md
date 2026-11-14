# Blueprint evaluation pipeline

Generates a Blueprint V2 from an authored brief and judges it against the
standard dimension battery. This is the runbook; the design — tiers, why one
judge per dimension, workspaces, how results combine, adding a dimension — is
`docs/evaluation-pipeline.md`.

## Quick start

```bash
# Judge a blueprint you already have (needs its brief):
./dev eval judge blueprint path/to/blueprint.json --brief evaluation/specs/001-lighthouse-lens

# Only the schema and mechanical checks, no model:
./dev eval validate path/to/blueprint.json

# Generate one from a brief, then judge it:
./dev eval generate evaluation/specs/001-lighthouse-lens --judge
```

`--brief` and `generate`'s briefs take a spec directory (which holds only
`input.brief.json`) or a brief file. A blueprint stored beside a `brief.json`
needs no `--brief`, so a stored subject is judged again by pointing the command
at it. `judge blueprint` also takes `--judges a,b` (only those dimensions) and
`--no-judges` (checks and analyzers only); a judge is skipped only when one of
them says so.

`generate <brief>...` makes a blueprint per brief. `--backend agent` (the
default) runs the Claude agent in its workspace through `generator-agent`;
`--backend api` makes one OpenRouter call through `generator-api`, which has no
model until `--model <OpenRouter id>` or the config gives one, and reads
`OPENROUTER_API_KEY` from the environment, else `.env.local` in the config root.
Backends and `--model` repeat; one run holds a subject for each brief, backend
and model, so two models read side by side. Each blueprint is checked against
the schema and the mechanical checks, or with `--judge` judged as above; one
that never passes the schema is kept and fails its check. `--install` copies a
blueprint that passed its mechanical checks into the game's library
(`blueprints/` in the config root); it never replaces a file there, and an install that fails makes the command exit 1.

## `./dev eval`

`./dev eval` lists the commands built on `evaluation/core/`. The model
bindings are in `evaluation/config.json` (else `evaluation/config.example.json`;
`--config` replaces both); the blueprint judges use `blueprint-judge`. A missing
binding, or one whose command does not exist, stops the run with an error naming
it. `--model-override blueprint-judge=<model>` changes its model for one run.

Exit codes, for every command: 0 everything passed, 1 the run broke (an unreadable
file, a missing binding, `run_error` in the result), 2 a check or judge failed or
could not judge.

## Output directory

Every run writes under `--output-root`, else `$MYSTERYEVALS_DIR`, else
`~/mysteryevals`, outside the repo, and nothing is overwritten:

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

`result.json` is written even when the run aborts. Its schema is in
`evaluation/core/result.ts`. Where to look:

- `run_error: { stage, message }` — set only when the run itself failed.
- `verdicts` — one per check or judge, with its status. A dimension's analyzer is
  `<dimension>.analyzer`; the dimension passes when it and its judge both do. A
  judge's entry holds its model call (model, prompt hash, time, cost, every
  attempt) and its full answer under `answer`.
- `summary` — counts by status and one `passed` flag.
- `production` — for `generate`, the generation attempts.
- `timing` — see below.

## Live progress

The agent steps can each run for many minutes, so the commands report as they
go. `--quiet` suppresses the ticks but keeps the milestone lines.

- The wrappers write the agent's live event stream to
  `logs/<step>*.stream.jsonl`; `tail -f` it for the raw stream.
- Every 20s (`EVAL_HEARTBEAT_MS`) a tick prints elapsed time, an estimated
  thinking-token total and the messages since the last tick. A quiet interval
  collapses to `· no new activity`.
- During the parallel judge phase a tick shows `done/total` and a short block per
  running judge. Each judge prints its own `[eval][<dim>] judge:` line when done.

The stream is for watching only; the result comes from the artifact the agent
writes in its workspace (`blueprint.json`, `verdict.json`).

## Pluggable CLI

No LLM SDK is imported; every model call is a subprocess. A binding's fields are
explained in the `_comment` of `evaluation/config.example.json`. To bind another
CLI, write a wrapper that:

- takes the system-prompt file and user-message file as arguments
  (`{{system_prompt_file}}`, `{{user_message_file}}` in `args`) and the model as
  `$EVAL_MODEL`;
- prints JSON on stdout whose `extract_path` (e.g. `result`) is the model's
  output string, which is then parsed as JSON;
- optionally streams its events as newline-delimited JSON to `$EVAL_STREAM_FILE`.
  This never affects the result.

## Retries

`retries: N` on a binding allows N more attempts after the first. A judge is
retried on a non-zero exit, a timeout, stdout that is not JSON, an `extract_path`
miss, or an answer failing the dimension's Zod schema; generation on the same,
plus output failing Blueprint V2 validation. Each attempt has its own logs
(`judge-solve_depth.attempt-2.stderr.log`).

## Timing

Every result records `timing` (monotonic clock, integer milliseconds) and the
command prints a summary: each top-level stage, and each dimension's own steps.

- The `dimensions` stage is wall-clock, roughly the slowest dimension, not the
  sum.
- A stage's duration includes its retries.
- A stage that failed still records how long it ran, marked `failed`.

## Enabled dimensions

The registry, `evaluation/core/registry.ts`, is the battery, run on every blueprint.
Each dimension's full question is its brief, `evaluation/dimensions/<id>.md`:

- `solve_depth` — solvable, deep enough (the brief's `minPathLength`, else the
  registry's `min_clues`), and every suspect has a measured elimination path.
- `fairness` — the evidence points uniquely at the culprit.
- `timeline_coherence` — positions around the crime are consistent
  (`actual_actions` authoritative).
- `knowledge_coherence` — what each character could observe, the integrity
  of their deceptions, and whether every physical fact agrees across fields
  with nothing given away before its clue is found.
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

The evaluator is the moving target. Run `judge blueprint` on a saved blueprint to
keep generation cost out of the loop, then edit:

- `evaluation/dimensions/<id>.md` — a judge's brief.
- `evaluation/dimensions/<id>.schema.ts` — its output schema, appended to the
  prompt and used to validate the answer. Where brief and schema disagree, the
  schema wins.
- `evaluation/checks/analyzers/<id>.ts` — a deterministic pre-check.
- `evaluation/prompts/judge-system.md` — the system prefix shared by every
  judge.
