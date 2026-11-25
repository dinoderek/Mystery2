# Evaluation runbook

The rules for running `./dev eval`. Design: `docs/evaluation-pipeline.md`.
`./dev eval --help` lists the commands; `./dev eval <command> --help`, their
options.

Each harness has its README beside its code:

- played games, `judge game`: `evaluation/trace/README.md`
- one turn replayed, `judge turn`, `cases` and `baseline`: `evaluation/runtime/README.md`
- self-play, `play` and `report`: `evaluation/playtest/README.md`
- the `gm_*` judges: `evaluation/judges/README.md`
- what a run records, its `--suite`/`--label`, and the `perf` commands (to come): `evaluation/perf/README.md`
- the generator agent's workspace: `evaluation/generator-harness/template/README.md`
- the judge agent's workspace: `evaluation/judge-harness/template/README.md`

## Bindings

Every model call goes through a binding, named in `evaluation/config.json`
(gitignored), else `evaluation/config.example.json`; `--config <file>`
replaces both. `--model-override <binding>=<model>` changes one binding's
model for one run. A missing or broken binding stops the command, naming it. Wrappers may stream to `$EVAL_STREAM_FILE`, never
affecting the result. A turn judge hands its answer schema in
`$EVAL_JSON_SCHEMA_FILE`; `claude-runtime.sh` holds answers to it.

## Judges

`evaluation/core/registry.ts` lists the case's check and four judges; each
judge's question is its brief, `evaluation/dimensions/<id>.md` (underscores
become hyphens). `--judges` and
`--no-judges` mark unselected judges skipped; candidates run only when named.
To iterate on a judge, run `judge blueprint` on a saved case and edit its
files.

**Case judges** are scored on both hand-written stories and their broken
copies (`node evaluation/blueprint/clue-graph-breaks.ts <case> <out>`): a
change keeps every story passing and every copy failing.

**Versions.** `evaluation/core/judge-versions.json` holds each judge's hashes,
version N the Nth; runs record them. Changing a judge's registry files fails
the gate until its new hash is appended; append one by hand otherwise.

## Generation

`./dev generate` creates clue-graph cases from clue-graph briefs, kept even
when invalid; `./dev eval judge blueprint` judges saved ones. `--install`
copies a case that passed everything into the config root's
`blueprints/clue-graph/`, never replacing files; a failed install exits 1.

**Repair** (`docs/blueprint-generation-flows.md`): round `n` is kept in
`rounds/<n>/` and `result.json`'s `rounds[]`; the result is the last round's,
installed only if it passed everything.

## Output

Runs write under `--output-root`, else `$MYSTERYEVALS_DIR`, else
`~/mysteryevals`, never overwriting. A run folder,
`<root>/<date>/<time>-<command>/`, holds `run.json` (the index), `record.json`
(the run record) and a folder per subject: its `result.json`, inputs, prompts,
logs and agent workspaces.

`result.json` (`evaluation/core/result.ts`) is written even when the run
aborts. `logs/<step>*.stream.jsonl` is for watching.

## Exit codes

For every command, **0**: everything passed. **1**: the run broke (a bad
file or binding, `run_error` in the result, the usage limit). **2**: a check
or judge failed, or could not judge.

## Retries

A call is retried, up to its binding's `retries`, on a non-zero exit, a
timeout, stdout that is not JSON, an `extract_path` miss, or an answer failing
its schema.

At the login's usage limit nothing is retried and no judge records an error:
the run breaks, exiting 1.
