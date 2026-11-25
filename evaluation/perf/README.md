# Evaluation performance

What an evaluation run records about itself, so runs can be compared over time
across machines. Design and the pipeline around it: `docs/evaluation-pipeline.md`;
running the commands: `evaluation/README.md`.

Run folders stay the source of truth. Whatever is shared, indexed or reported is
derived from them. The data repository, index, report and baseline suites, and
the `./dev eval perf` commands with the `--suite` and `--label` options that go
with them, are not built yet; this file grows with each.

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
  no stream file result), record `tokens: null`. Wrappers other than the Claude
  CLI's stay null until they report the same shape.
- A failed attempt keeps what it reported, as it keeps its cost.
- A call's `tokens` is its attempts' summed field by field, null only when no
  attempt reported any.
- Results of versions 1 and 2 read back with `tokens` null. A field a later
  version 3 addition introduces defaults to null when absent, so every version 3
  result already written stays readable.

## The game's narrator calls

`judge turn --narrator server` and `play` narrate through the game, which logs
each AI call when `AI_CALL_LOG` is set (`packages/game-engine/src/ai-call-log.ts`).
Both set it, to a file in the run folder (`ai-calls.jsonl`; `play`'s is
`ai-calls.all.jsonl`), and read the lines back as model calls
(`evaluation/lib/game-ai-calls.ts`) in `production.calls` of the subject's
`result.json`, under the binding `server`; `play` lists them after the
investigator's, told apart by binding. A last line without its newline is still
being written, and is not read.

- A turn's calls are the lines carrying the `x-request-id` the harness sent with
  its request, so concurrent samples never share one, and a turn that failed
  keeps the calls it made. A game's are the lines of its game id.
- The model is the AI profile's resolved model; duration, cost and tokens are the
  line's. The game counts input and output only, the cache folded into input, so
  both cache counts are null and a provider reporting no usage (mock) gives null
  tokens and cost.
- A line is one attempt, retries included. Only the prompt's hash is kept,
  over its text and context, and an outcome: no prompt, answer or error text
  reaches `result.json`.
