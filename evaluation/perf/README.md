# Evaluation performance

What an evaluation run records about itself, so runs compare over time across
machines. Design: `docs/evaluation-pipeline.md`; commands: `evaluation/README.md`.

Run folders stay the source of truth; whatever is shared, indexed or reported
derives from them. The data repository, index, report, baseline suites and
`./dev eval perf` commands are still to come.

## What a run records

Every model call through the runner (`evaluation/core/runner.ts`) is written to
`result.json` (`evaluation/core/result.ts`, schema `mystery-eval-result/3`)
with its duration, cost and tokens, per attempt and summed per call.

**Tokens.** An attempt's `tokens` holds `input`, `output`, `cache_read` and
`cache_write`: the Claude CLI's `usage` counts, read where its cost is read,
from the wrapper's JSON stdout, else the last `result` event of the attempt's
stream file. Cost is the CLI's own estimate and differs by login; tokens are
the comparable measure.

- Any other shape, or no usage, records `tokens: null`; a failed attempt keeps
  what it reported.
- A call's `tokens` sums its attempts', null only when none reported any.
- Versions 1 and 2 read back with `tokens` null; a later version 3 field
  defaults to null.

**Who ran what.** Every result's `run` block also names:

- `suite` and `label`, from `--suite` and `--label`; null when absent.
- `developer`, from a top-level `developer` key in `evaluation/config.json` (or
  the `--config` file), else the OS user name; never an email address.
- `host`, the host name.
- `parent_run`: `judge game` started by `play --judge` records the play run's
  id, so the pair counts as one loop.
- `prompt_versions`: `narrator` and `generator`, each the first 12 hex digits of
  a SHA-256 over its prompt files' paths and content
  (`evaluation/core/prompt-versions.ts`), the narrator's under the paths
  `baseline status` treats as read. The index orders versions by first sight.

**Suite attributes.** `run.attributes` holds what the run held fixed: command,
options that change what runs, each input's id and content hash, judges, models
per role, samples, concurrency and suite (`evaluation/core/suite-attributes.ts`).

## The game's narrator calls

`judge turn --narrator server` and `play` narrate through the game, which logs
each AI call to `AI_CALL_LOG` (`packages/game-engine/src/ai-call-log.ts`), set
to a file in the run folder. `evaluation/lib/game-ai-calls.ts` reads it back as
the subject's `production.calls`, binding `server`, after any investigator's.

- A turn's calls are the lines with the `x-request-id` the harness sent; a
  game's, its game id's. A last line without its newline is not read.
- Model, duration, cost and tokens are the line's; cache counts are null.
- A line is one attempt. Only the prompt's hash is kept, no text.

## The run record

A finished run writes `record.json` beside `run.json`, never replaced
(`evaluation/perf/record.ts`, schema `mystery-eval-record/1`): the run block
whole, `exit_code`, `comparable`, and per subject its kind, id, `passed`, round
count and the stage it broke at. Calls and verdicts are flat rows naming their
subject's position and their round (null without rounds).

- A call row: role, judge and version, binding, model, duration, cost, tokens,
  attempt count and last outcome. A verdict row: id, tier, status, judge version
  and finding count.
- Roles: a verdict's call is the judge's, a round's the generator's; a production
  call the generator's (blueprint), narrator's (turn, `server` binding), else
  the investigator's.
- `comparable` is false for a tree not known clean, or a judge that passed or
  failed with no recorded version.
- No prompt, answer, finding, reason, error or log text.
- `run.developer` with `run.id` identifies a run; one that recorded no
  developer takes the local one.

`recordFromFolder` (`evaluation/core/run-folder.ts`) builds the same record from
any run folder of result versions 1 to 3, even one stopped before `run.json`.
