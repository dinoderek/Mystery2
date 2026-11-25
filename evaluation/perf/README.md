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
`cache_write`: the Claude CLI's `usage` counts, read where its cost is read, from
the top of the wrapper's JSON stdout, else the last `result` event of the
attempt's stream file. Cost is the CLI's own estimate and differs by login;
tokens are the comparable measure.

- Any other shape, a wrapper that reports nothing, and plain-text output
  record `tokens: null`. Wrappers other than the Claude CLI's stay null until
  they report the same shape.
- A failed attempt keeps what it reported, as it keeps its cost.
- A call's `tokens` is its attempts' summed field by field, null only when no
  attempt reported any.
- Results of versions 1 and 2 read back with `tokens` null. A field a later
  version 3 addition introduces defaults to null when absent, so every version 3
  result already written stays readable.
