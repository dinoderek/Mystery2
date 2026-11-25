# Evaluation performance

What an evaluation run records about itself, so runs compare across machines.
Design: `docs/evaluation-pipeline.md`; commands: `evaluation/README.md`. Run
folders stay the source of truth. The index, report and suites are still to come.

## What a run records

Every model call through the runner (`evaluation/core/runner.ts`) is written to
`result.json` (`evaluation/core/result.ts`, schema `mystery-eval-result/3`) with
duration, cost and tokens, per attempt and call.

**Tokens.** An attempt's `tokens` holds `input`, `output`, `cache_read` and
`cache_write`: the Claude CLI's `usage` counts, read where its cost is read
(the wrapper's JSON, else its stream's last `result` event). Cost is the CLI's
own estimate and differs by login; tokens are the comparable measure.

- Any other shape, or no usage, records `tokens: null`; a failed attempt keeps
  what it reported. A call's `tokens` sums its attempts'. Versions 1 and 2
  read back null.

**Who ran what.** Every result's `run` block also names:

- `suite` and `label`, from `--suite` and `--label`; null when absent.
- `developer`, from a top-level `developer` key in the config, else the OS user
  name; never an email address. And `host`.
- `parent_run`: the play run's id, for `judge game` started by `play --judge`.
- `prompt_versions`: `narrator` and `generator`, each the first 12 hex digits of
  a SHA-256 over its prompt files' paths and content
  (`evaluation/core/prompt-versions.ts`), the narrator's under the paths
  `baseline status` treats as read.

**Suite attributes.** `run.attributes` holds what the run held fixed: command,
options, each input's id and content hash, judges, models per role, samples,
concurrency and suite (`evaluation/core/suite-attributes.ts`).

## The game's narrator calls

`judge turn --narrator server` and `play` narrate through the game, which logs
each AI call to `AI_CALL_LOG` (`packages/game-engine/src/ai-call-log.ts`), a file
in the run folder. `evaluation/lib/game-ai-calls.ts` reads it back as the
subject's `production.calls`, binding `server`.

- A turn's calls are the lines with the `x-request-id` the harness sent; a
  game's carry its game id.
- Model, duration, cost and tokens are the line's; cache counts, null.

## The run record

A finished run writes `record.json` beside `run.json`, never replaced
(`evaluation/perf/record.ts`, schema `mystery-eval-record/1`): the run block
whole, `exit_code`, `comparable`, and per subject its kind, id, `passed`, round
count and break stage. Calls and verdicts are flat rows naming their subject's
position and round (null without rounds).

- A call row: role, judge and version, binding, model, duration, cost, tokens,
  attempts and outcome. A verdict row: id, tier, status, version, finding count.
- A `play --judge` record repeats the judge rows of the `judge game` record
  naming it `parent_run`: count them once.
- `comparable` is false for a tree not known clean, or a verdict from a judge
  with no recorded version.
- No prompt, answer, finding, reason, error or log text.

`recordFromFolder` (`evaluation/core/run-folder.ts`) rebuilds one from any run folder.

## The data repository

Records are shared through a private git repository: its URL is `remote` under
a top-level `perf` key in `evaluation/config.json`.

`./dev eval perf push [<run>...]` (`evaluation/perf/push.ts`) sends the records
of every run under the output root, or of the runs named (a folder, or an id
like `2026-11-25/10-00-00-generate`), to
`records/<yyyy>/<mm>/<developer>/<run>.json`: the UTC month the run started; in
the developer and run id, each `/` or character outside `A-Za-z0-9._-` becomes `_`.

- Files are added, never edited: a record already there is left alone.
- Never sent: a run with no `record.json`, or whose calls all went to stubs
  (no model, or the game's `mock`).
- It clones to `<output-root>/.perf/data`, rewound to `main` on each use, with
  the host's git and credentials. A rejected push is redone on the remote's new
  tip, five attempts at most.
- Without `perf.remote`, it stops, naming it.
