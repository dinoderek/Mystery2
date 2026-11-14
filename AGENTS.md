# AI Agent Operations Guide

`docs/constitution.md` governs; this file is how agents work within it.

## Read first

For any significant task: `docs/constitution.md`, `docs/architecture.md`,
`docs/game.md`, `docs/testing.md`. Carry their constraints into plans and
summaries.

## Load for the area you touch

- `web/`: screens, components, styling. `docs/ui.md`
- Engine, API contracts, database. `docs/backend-conventions.md`
- Running the game, worktrees, databases, ports. `docs/local-infrastructure.md`
- Narrator prompts, AI contracts, runtime context. `docs/ai-runtime.md`
- AI profiles, providers, settings, mock vs live. `docs/ai-configuration.md`
- Blueprint fields and generation. `docs/blueprint-generation-flows.md`,
  `packages/shared/src/blueprint-schema-v2.ts`
- `evaluation/`: `docs/evaluation-pipeline.md`, then the README beside the code.
  Read `evaluation/judges/README.md` before adding or editing a `gm_*` judge.

## Workflow

- A task goes through the engine plugin's `build` skill (`engine:build`), enabled
  by `.claude/settings.json`. The default is hands-off: merge on a green gate and
  green CI without asking.
- Worktrees: `./dev worktree create <branch>`, `./dev worktree release <branch>`.
- Pull requests use `.github/pull_request_template.md` and merge by squash.

## The gate

Any non-documentation change finishes with `npm test`. Focused scripts are for
iteration. The gate takes about 20 seconds; run it in the background into a file
named after the worktree, and read that file on the completion notification:

```bash
( npm test; echo "GATE_EXIT=$?" ) > "/tmp/gate-$(basename "$PWD").log" 2>&1
```

A shared log name gets overwritten by other worktrees' runs. Never block on
`tail -f` or a `while sleep` loop.

Two traps:

- **Check `GATE_EXIT`**, not the task's exit code, which is the final `echo`'s.
- **Check the `Total` line**, not the last line. `Total ... FAIL` is the verdict.

Every step runs in every environment; a suite that will not start is a bug to
fix, not a partial run to report. Coverage floors are enforced
(`docs/testing.md`). Final summaries state which gates ran, and why anything
was skipped.

## Things that bite

- **The database you play on.** Tests that open a database get an explicit path,
  never `resolveDatabasePath()`. A `SCHEMA_VERSION` bump reaches `prod` on first
  open and cannot be undone (`docs/backend-conventions.md`).
- **AI changes.** Changing contracts, prompts, runtime context or provider
  selection means updating the mock provider and its tests in the same change
  (`docs/ai-runtime.md`).
- **Docs are checked by the gate.** Editing an `<!-- extract:<id> -->` section
  fails `curated-docs` until its extract is reviewed and re-hashed. A path or
  script that does not exist fails `doc-refs` (`docs/testing.md`).

## Documentation

Each topic has one owning doc: link to it, do not restate it, and update the
owner in the same change as the behaviour. Describe rules and reasons, not what
one file already shows. Operator setup belongs in `QUICKSTART.md`.
