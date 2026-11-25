# Evaluation performance

What an evaluation run records, so runs compare across machines.
Design: `docs/evaluation-pipeline.md`; commands: `evaluation/README.md`. Run
folders stay the source of truth.

## What a run records

`result.json` (`evaluation/core/result.ts`, schema `mystery-eval-result/3`)
holds each model call's duration, cost and tokens, per attempt and call.

**Tokens.** An attempt's `tokens` holds `input`, `output`, `cache_read` and
`cache_write`: the Claude CLI's `usage` counts. Cost, its own estimate,
differs by login; tokens are comparable.

- Without them, null, as in versions 1 and 2; a call's sums its
  attempts'.

**Who ran what.** The `run` block also holds `suite` and `label` (`--suite`,
`--label`; null when absent), `developer` (the config's `developer`,
else the OS user name, never an email address), `host`, `parent_run` (the play
run's id, for `judge game` started by `play --judge`), `prompt_versions`
(`narrator`, `generator`: 12 hex digits of a SHA-256 over prompt files,
`evaluation/core/prompt-versions.ts`) and `attributes`, what the run held fixed
(`evaluation/core/suite-attributes.ts`).

**Narrator calls.** `judge turn --narrator server` and `play` narrate through
the game; `evaluation/lib/game-ai-calls.ts` reads its `AI_CALL_LOG` back as
`production.calls`, binding `server`, cache counts null.

## The run record

A finished run writes `record.json` beside `run.json`, never replaced
(`evaluation/perf/record.ts`, schema `mystery-eval-record/1`): the run block,
`exit_code`, `comparable`, each subject, and flat call and verdict rows naming
their subject's position and round.

- A `play --judge` record repeats its `judge game` record's judge rows.
- `comparable` is false for a tree not known clean, or a judge with no
  recorded version. No prompt, answer, finding or log text.

## The data repository

A private git repository, `perf.remote` (a URL or path) in
`evaluation/config.json`.

`./dev eval perf push [<run>...]` (`evaluation/perf/push.ts`) sends every record
under the output root, or the named runs' (a folder or id), to
`records/<yyyy>/<mm>/<developer>/<run>.json`.

- Files are added, never edited.
- Never sent: runs without `record.json`, or calling only stubs.
- Its clone, `<output-root>/.perf/data`, is rewound to `main` each use; a
  rejected push is redone, five times at most.

## The index

`./dev eval perf sync` fetches that clone and rebuilds `<output-root>/perf.db`
whole (`evaluation/perf/sync.ts`; schema `index-db.ts`): delete it and sync
again for the same rows. Tables `runs`, `subjects`, `calls` and `verdicts` hold
the record's fields; `attributes` as JSON. No migrations.

- Indexed: every run folder (its `record.json`, else one built from its
  results, old fields null) and fetched record, once by developer and run id.
- `loop`: `blueprint` for `generate` and `judge blueprint`, `narration` for
  `judge turn`, `play` and `judge game`.
- `*_prompt_seq` numbers prompt versions by their first run's start.
- Without `perf.remote`, or on a failed fetch, it says so and uses the last
  fetch. An unreadable folder or record is named, skipped, and exits 1.

## The report

`./dev eval perf report [--loop <name>] [--suite <name>] [--match <attributes>]
[--since <date>]` (`evaluation/perf/report.ts`) reads `perf.db` (sync first),
prints trends per loop and writes `<output-root>/perf/report.html`: one file,
inline SVG.

- A line is a loop's runs whose `--match` attributes (`run.attributes` names,
  comma-separated, default all) are equal; it states what it holds fixed.
  Inputs match as a whole set of ids and hashes.
- A step is consecutive runs on one prompt and judge versions: pass rate, calls
  per run, and median duration, cost and tokens (four counts added) per call by
  role and model.
- Runs not comparable, or without attributes, are shown apart.

## Baseline suites

`./dev eval perf baseline <name>` (`evaluation/perf/baseline.ts`) runs
`suites/<name>.json` with `--suite <name>`, its `models` as overrides, clean
trees only, then pushes; a failed push is said once, leaving the exit code.

- `blueprint-loop`: `generate --judge --repair 2` on the committed briefs.
- `narration-loop`: Haiku `judge turn` per case folder, each the run
  `baselines/haiku.json` is saved from.
