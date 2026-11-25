# Evaluation performance

What an evaluation run records about itself, so runs can be compared over time
across machines. Design and the pipeline around it: `docs/evaluation-pipeline.md`;
running the commands: `evaluation/README.md`.

Run folders stay the source of truth. Whatever is shared, indexed or reported is
derived from them. The data repository, index, report and baseline suites,
and the `./dev eval perf` commands are not built yet; this file grows with each.

## What a run records

Every model call through the runner (`evaluation/core/runner.ts`) is written to
`result.json` (`evaluation/core/result.ts`, schema `mystery-eval-result/3`)
with its duration, cost and tokens, per attempt and summed per call.

**Tokens.** An attempt's `tokens` holds `input`, `output`, `cache_read` and
`cache_write`: the Claude CLI's `usage` counts, read where its cost is read, from
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
  the paths `baseline status` treats as read. A hash needs no upkeep; the index
  orders versions by when each was first seen. Judges keep their numbered
  versions.

**Suite attributes.** `run.attributes` holds what a run held fixed, in full,
whether or not it ran a named suite (`evaluation/core/suite-attributes.ts`):
`command`; `options` that change what runs (`generate`'s `repair`, `play`'s
`persona` and `max_steps`); `inputs`, each brief, case, stored turn, trace or
replay script with its id and a 12-digit hash of its content, keys sorted;
`judges` selected; `models`, the labels per role (`generator`, `narrator`,
`investigator`, `judge`), a binding as `<binding>:<model>` and a game server's
narrator as `server:<backend>:<model>` (or `server:mock`, `server:default`);
`samples` (`play`'s games); `concurrency`; `suite`. One that does not apply is
null. Output-only options are left out. Nothing reduces them to a key: which
must match is chosen when runs are compared, input by input.

Fields absent from a version 3 result read back as null.
