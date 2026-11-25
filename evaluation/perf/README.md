# Evaluation performance

What an evaluation run records about itself, so runs compare across machines.
Design: `docs/evaluation-pipeline.md`; commands: `evaluation/README.md`. Run
folders stay the source of truth.

## What a run records

`result.json` (`evaluation/core/result.ts`, schema `mystery-eval-result/3`)
holds each model call's duration, cost and tokens, per attempt and call.

**Tokens.** An attempt's `tokens` holds `input`, `output`, `cache_read` and
`cache_write`: the Claude CLI's `usage` counts. Cost is its own estimate and
differs by login; tokens are the comparable measure.

- Lacking them, `tokens` is null, as in versions 1 and 2; a call's sums its
  attempts'.

**Who ran what.** Every result's `run` block also names:

- `suite` and `label`, from `--suite` and `--label`; null when absent.
- `developer`, from the config's `developer`, else the OS user name, never an
  email address; and `host`.
- `parent_run`: the play run's id, for `judge game` started by `play --judge`.
- `prompt_versions`: `narrator` and `generator`, each a 12-digit SHA-256 prefix
  over its prompt files (`evaluation/core/prompt-versions.ts`).

**Suite attributes.** `run.attributes` holds what the run held fixed
(`evaluation/core/suite-attributes.ts`).

## The game's narrator calls

`judge turn --narrator server` and `play` narrate through the game, which logs
each AI call to `AI_CALL_LOG` (`packages/game-engine/src/ai-call-log.ts`).
`evaluation/lib/game-ai-calls.ts` reads it back as the subject's
`production.calls`, binding `server`. Cache counts are null.

## The run record

A finished run writes `record.json` beside `run.json`, never replaced
(`evaluation/perf/record.ts`, schema `mystery-eval-record/1`): the run block
whole, `exit_code`, `comparable`, each subject, and flat call and verdict rows
naming their subject's position and round (null without rounds); the file's
header lists the fields.

- A `play --judge` record repeats its `judge game` record's judge rows.
- `comparable` is false for a tree not known clean, or a verdict from a judge
  with no recorded version. No prompt, answer, finding or log text.

## The data repository

A private git repository, `perf.remote` in `evaluation/config.json`.

`./dev eval perf push [<run>...]` (`evaluation/perf/push.ts`) sends the records
of every run under the output root, or of the runs named (a folder or id), to
`records/<yyyy>/<mm>/<developer>/<run>.json`: by UTC start month;
characters outside `A-Za-z0-9._-` become `_`.

- Files are added, never edited.
- Never sent: a run with no `record.json`, or whose calls all went to stubs.
- It clones to `<output-root>/.perf/data`, rewound to `main` each use, and
  redoes a rejected push on the new tip, five times at most.
- Without `perf.remote`, it stops, naming it.

## The index

`./dev eval perf sync` fetches that clone and rebuilds `<output-root>/perf.db`
whole (`evaluation/perf/sync.ts`; schema in `index-db.ts`): delete it and sync
again for the same rows. Tables `runs`, `subjects`, `calls` and `verdicts` hold
the record's fields; a run's `attributes` are JSON. No migrations.

- Indexed: every run folder (its `record.json`, else one built from its
  results, old fields null) and every fetched record. A run in both is one
  row, by developer and run id.
- `loop`: `blueprint` for `generate` and `judge blueprint`, `narration` for
  `judge turn`, `play` and `judge game`. Other commands are not indexed.
- `narrator_prompt_seq` and `generator_prompt_seq` number prompt versions by
  the start of the first run that has each.
- Without `perf.remote`, or when the fetch fails, it says so and uses the last
  fetch. An unreadable run folder or record is named, skipped, and exits 1;
  older layouts and `suites/` are skipped silently.

## Baseline suites

`./dev eval perf baseline <name>` (`evaluation/perf/baseline.ts`) makes the
runs in `suites/<name>.json` with `--suite <name>`, its `models` as overrides,
refusing a dirty tree, then pushes them; a failed push is said once, leaving
the exit code.

- `blueprint-loop`: `generate --judge --repair 2`, the three committed briefs.
- `narration-loop`: `judge turn` on Haiku per case folder, the runs each
  `baselines/haiku.json` is saved from.
