# Evaluation runbook

The rules for running `./dev eval`. Design: `docs/evaluation-pipeline.md`.
`./dev eval --help` lists the commands; `./dev eval <command> --help`, their
options.

Each harness has its README beside its code:

- played games, `judge game`: `evaluation/trace/README.md`
- one turn replayed, `judge turn`, `cases` and `baseline`: `evaluation/runtime/README.md`
- self-play, `play` and `report`: `evaluation/playtest/README.md`
- the truth set, `label`, `score`, `compare` and `suite`:
  `evaluation/truth/README.md`
- the `gm_*` judges: `evaluation/judges/README.md`
- the generator agent's workspace: `evaluation/generator-harness/template/README.md`

## Bindings

Every model call goes through a binding, named in `evaluation/config.json`
(gitignored), else `evaluation/config.example.json`; `--config <file>` replaces both. `--model-override <binding>=<model>` changes
one binding's model for one run. A missing binding, or one whose command cannot
run, stops the command, naming it: no judge is skipped silently. Wrappers may
stream to `$EVAL_STREAM_FILE`, never affecting the result. A turn judge hands its answer
schema in `$EVAL_JSON_SCHEMA_FILE`; `claude-runtime.sh` holds answers to it.

## Judges

`evaluation/core/registry.ts` lists the blueprint battery, run on every
blueprint; each judge's question is its brief, `evaluation/dimensions/<id>.md`.
A dimension passes when its analyzer and its judge both do. `--judges` and
`--no-judges` mark unselected judges skipped; candidates run only when named.
To iterate on a judge, run `judge blueprint` on a saved blueprint and edit its
files or `evaluation/prompts/judge-system.md`. On the
`judge-stub` binding the whole battery passes the test fixture blueprint offline.

**Versions.** `evaluation/core/judge-versions.json` holds each judge's hashes,
version N the Nth; runs record them. Changing a judge's registry files fails
the gate until its new hash is appended; append one by hand otherwise.

## Generation

`./dev generate` creates blueprints; `./dev eval judge blueprint` judges saved ones.
Schema failures remain.
`--install` copies a blueprint that passed its mechanical checks into
`blueprints/` in the config root; it never replaces files; a failed
install exits 1.

**Repair.** With `--repair <n>` (`docs/blueprint-generation-flows.md`), round
`n` is kept in `rounds/<n>/` and in `result.json`'s `rounds[]`; the result is
the last round's, and installs only if it passed everything.

## Output

Every run writes under `--output-root`, else `$MYSTERYEVALS_DIR`, else
`~/mysteryevals`: outside the repo, and nothing is overwritten. A run folder,
`<root>/<date>/<time>-<command>/`, holds `run.json` (the index) and a folder per
subject with its `result.json`, stored inputs, every call's prompts and logs,
and each agent's workspace. A suite keeps its journal and runs in
`<root>/suites/<name>/`; only its results file goes in the repo.

`result.json` (`evaluation/core/result.ts`) is written even when the run
aborts. `logs/<step>*.stream.jsonl` is for watching only.

## Exit codes

For every command, **0**: everything passed. **1**: the run broke (an
unreadable file, a missing binding, `run_error` in the result, the usage
limit). **2**: a check or judge failed, or could not judge (`suite`: a
threshold was not met).

## Retries

A call is retried, up to its binding's `retries`, on a non-zero exit, a
timeout, stdout that is not JSON, an `extract_path` miss, or an answer failing
its schema (a dimension's, or Blueprint V2).

At the login's usage limit nothing is retried and no judge records an error:
the run breaks, exiting 1. A `suite` rerun resumes, repeating no finished call.
