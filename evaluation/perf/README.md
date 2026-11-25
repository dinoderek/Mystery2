# Evaluation performance

What an evaluation run records about itself, so runs compare across machines.
Design: `docs/evaluation-pipeline.md`; commands: `evaluation/README.md`. Run
folders stay the source of truth. Index and report: to come.

## What a run records

Every model call through the runner (`evaluation/core/runner.ts`) is written to
`result.json` (`evaluation/core/result.ts`, schema `mystery-eval-result/3`) with
duration, cost and tokens, per attempt and call.

**Tokens.** An attempt's `tokens` holds `input`, `output`, `cache_read` and
`cache_write`: the Claude CLI's `usage` counts. Cost is the CLI's
own estimate and differs by login; tokens are the comparable measure.

- Without them, `tokens` is null, as versions 1 and 2 read back; a failed attempt
  keeps what it reported, and a call's sums its attempts'.

**Who ran what.** Every result's `run` block also names:

- `suite` and `label`, from `--suite` and `--label`; null when absent.
- `developer`, from the config's `developer`, else the OS user name, never an
  email address; and `host`.
- `parent_run`: the play run's id, for `judge game` started by `play --judge`.
- `prompt_versions`: `narrator` and `generator`, each a 12-digit SHA-256 prefix
  over its prompt files (`evaluation/core/prompt-versions.ts`); the narrator's
  are the paths `baseline status` treats as read.

**Suite attributes.** `run.attributes` holds what the run held fixed
(`evaluation/core/suite-attributes.ts`): command, options, inputs hashed,
judges, models per role, samples, concurrency, suite.

## The game's narrator calls

`judge turn --narrator server` and `play` narrate through the game, which logs
each AI call to `AI_CALL_LOG` (`packages/game-engine/src/ai-call-log.ts`), a file
in the run folder. `evaluation/lib/game-ai-calls.ts` reads it back as the
subject's `production.calls`, binding `server`.

- A turn's calls are the lines with the `x-request-id` the harness sent; a
  game's carry its game id.
- Model, duration, cost and tokens are the line's; cache counts, null; the
  prompt as its hash only.

## The run record

A finished run writes `record.json` beside `run.json`, never replaced
(`evaluation/perf/record.ts`, schema `mystery-eval-record/1`): the run block
whole, `exit_code`, `comparable`, and per subject its kind, id, `passed`, round
count and break stage. Calls and verdicts are flat rows naming their subject's
position and round.

- A call row: role, judge and version, binding, model, duration, cost, tokens,
  attempts and outcome. A verdict row: id, tier, status, version, finding count.
- A `play --judge` record repeats its `judge game` record's judge rows: count
  them once.
- `comparable` is false for a tree not known clean, or a verdict from a judge
  with no recorded version.
- No prompt, answer, finding, reason, error or log text.

`recordFromFolder` (`evaluation/core/run-folder.ts`) rebuilds one from any run folder.

## The data repository

Records are shared through a private git repository, `perf.remote` in
`evaluation/config.json`.

`./dev eval perf push [<run>...]` (`evaluation/perf/push.ts`) sends the records
of every run under the output root, or of the runs named (a folder or id), to
`records/<yyyy>/<mm>/<developer>/<run>.json`: the UTC month the run started;
other characters than `A-Za-z0-9._-` become `_`.

- Files are added, never edited.
- Never sent: a run with no `record.json`, or whose calls all went to stubs
  (no model, or the game's `mock`).
- It clones to `<output-root>/.perf/data` with the host's git, rewound to
  `main` each use, and redoes a rejected push on the new tip, five times at most.
- Without `perf.remote`, it stops, naming it.

## Baseline suites

`./dev eval perf baseline <name>` (`evaluation/perf/baseline.ts`) makes each
run in `evaluation/perf/suites/<name>.json` with `--suite <name>`, and the
file's `models` as `--model-override`s. It refuses a dirty tree, then pushes
the new records; a failed push is said once, leaving the runs' exit code.

- `blueprint-loop`: `generate --judge --repair 2` on the three committed briefs.
- `narration-loop`: `judge turn` on Haiku, one run per case folder: the run its
  `baselines/haiku.json` is saved from.
