# Evaluation performance

What an evaluation run records about itself, so runs can be compared over time
across machines. Design and the pipeline around it: `docs/evaluation-pipeline.md`;
running the commands: `evaluation/README.md`.

Run folders stay the source of truth. Whatever is shared, indexed or reported is
derived from them. The data repository, index, report, baseline suites and
`./dev eval perf` commands are still to come.

## What a run records

Every model call through the runner (`evaluation/core/runner.ts`) is written to
`result.json` (`evaluation/core/result.ts`, schema `mystery-eval-result/3`)
with its duration, cost and tokens, per attempt and summed per call.

**Tokens.** An attempt's `tokens` holds `input`, `output`, `cache_read` and
`cache_write` (null where a source counts none, as below): the Claude CLI's
`usage` counts, read where its cost is read, from
the top of the wrapper's JSON stdout, else the last `result` event of the
attempt's stream file. Cost is the CLI's own estimate and differs by login;
tokens are the comparable measure.

- Any other shape, and a wrapper that reports nothing (stdout without usage and
  no stream file result), record `tokens: null`.
- A failed attempt keeps what it reported, as it keeps its cost.
- A call's `tokens` is its attempts' summed field by field, null only when no
  attempt reported any.
- Results of versions 1 and 2 read back with `tokens` null. A field a later
  version 3 addition introduces defaults to null when absent, so every version 3
  result already written stays readable.

**Who ran what.** The `run` block of every result also names:

- `suite` and `label`, from `--suite <name>` and `--label <text>`, which every
  `./dev eval` command accepts; `generate`, `judge blueprint`, `judge turn`,
  `judge game` and `play` record them, null when absent.
- `developer`, from a top-level `developer` key in `evaluation/config.json` (or
  the `--config` file), else the OS user name. A name, never an email address;
  `evaluation/config.example.json` leaves it null. It is not a binding.
- `host`, the machine's host name.
- `parent_run`: `judge game` started by `play --judge` records the play run's
  id (passed as its `--parent-run`, with the play run's suite and label), so the
  pair counts as one loop. Null otherwise.
- `prompt_versions`: `narrator` and `generator`, each the first 12 hex digits of
  a SHA-256 over its prompt files' paths and content
  (`evaluation/core/prompt-versions.ts`). The narrator's files are the role
  prompts, their guidance, the system messages and the age profile, all under
  the paths `baseline status` treats as read. The index orders versions by
  first sight. Judges keep their numbered versions.

**Suite attributes.** `run.attributes` holds what the run held fixed:
command, options that change what runs, each input's id and content hash,
judges, models per role, samples, concurrency and suite; null where one does
not apply (`evaluation/core/suite-attributes.ts`). Hashes are per input.

## The game's narrator calls

`judge turn --narrator server` and `play` narrate through the game, which logs
each AI call to `AI_CALL_LOG` (`packages/game-engine/src/ai-call-log.ts`). Both
set it to a file in the run folder, and `evaluation/lib/game-ai-calls.ts` reads
it back as model calls in the subject's `production.calls`, binding `server`;
`play` lists them after the investigator's.

- A turn's calls are the lines with the `x-request-id` the harness sent, so
  concurrent samples never mix, and a failed turn keeps its calls. A game's are
  the lines of its game id. A last line without its newline is not read.
- Model, duration, cost and tokens are the line's. Cache counts are null (the
  game folds the cache into input); no usage (mock) gives null tokens and cost.
- A line is one attempt, retries included. Only the prompt's hash and an
  outcome are kept, no text.
