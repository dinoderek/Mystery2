# AI Agent Operations Guide

`docs/constitution.md` governs; this file is how agents work within it.

## Read first

For any significant task: `docs/constitution.md`, `docs/architecture.md`,
`docs/game.md`, `docs/testing.md`. Carry the relevant constraints into plans and
final summaries.

## Load for the area you touch

- `web/` — screens, components, styling: `docs/ui.md`
- The engine, API contracts, the database: `docs/backend-conventions.md`
- Running the game, worktrees, databases, ports: `docs/local-infrastructure.md`
- Narrator prompts, AI contracts, runtime context: `docs/ai-runtime.md`
- AI profiles, providers, the settings page, mock vs live:
  `docs/ai-configuration.md`
- Blueprint fields or the generation paths they feed:
  `docs/blueprint-generation-flows.md` and
  `packages/shared/src/blueprint-schema-v2.ts`
- Anything under `evaluation/`: `docs/evaluation-pipeline.md`, then the README
  beside the code (`evaluation/README.md`, `evaluation/trace/README.md`,
  `evaluation/runtime/README.md`, `evaluation/playtest/README.md`). Read
  `evaluation/judges/README.md` before adding or editing a `gm_*` judge.

## The gate

Any non-documentation change finishes with `npm test`. Focused scripts are for
iteration. The gate takes about a minute; run it in the background into a file
and read the file when the completion notification arrives:

```bash
( npm test; echo "GATE_EXIT=$?" ) > /tmp/gate.log 2>&1
```

Never block on `tail -f` or a `while sleep` loop: `tail -f` keeps following the
file after the command ends, so the call hangs until killed. (`timeout` is not
available on macOS.)

Two traps when reading it:

- **Check `GATE_EXIT`, not the task's exit code**, which is the final `echo`'s.
  Piping `npm test` into `tail` masks the status the same way.
- **Check the `Total` line, not the last line.** A failing step can print a
  passing test name under it, and the coverage section follows the table.
  `Total ... FAIL` is the verdict.

Every step runs in every environment; the gate needs nothing beyond this repo.
A suite that will not start is a bug to fix, not a partial run to report.
Coverage is reported, never enforced — `docs/testing.md` explains how to read it.

Final summaries state which gates ran, and why anything was skipped.

## Things that bite

- **The database you play on.** Anything that opens a database in a test gets
  an explicit path, never `resolveDatabasePath()`. A `SCHEMA_VERSION` bump
  reaches `prod` the first time any branch opens it and cannot be undone
  (`docs/backend-conventions.md`).
- **AI changes.** Changing contracts, prompts, runtime context or provider
  selection means updating the mock provider and its tests in the same change
  ("The mock provider" in `docs/ai-runtime.md`).
- **Docs are checked by the gate.** Editing a section marked
  `<!-- extract:<id> -->` fails `curated-docs` until the extract pinned to it is
  reviewed and its hash updated; naming a path or script that does not exist
  fails `doc-refs` (`docs/testing.md`).

## Documentation

Each topic has one owning doc; link to it instead of restating it. Update the
owner in the same change as the behaviour. Describe rules, reasons and
cross-file views — not what a single file already says, such as props, flag
lists or per-field usage. Operator setup belongs in `QUICKSTART.md`.
