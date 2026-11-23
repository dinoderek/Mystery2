# AI Agent Operations Guide

## Objectives

1. Great text mystery games for the operator's daughters.
2. Practice using AI to generate blueprints and run the game: agents in
   production, and evaluation infrastructure, hence the size of `evaluation/`.

Any rewrite keeps the blueprint/narrator split, model calls as pluggable CLI
subprocess wrappers, the evaluators' direction, and replay and self-play.

## Architecture

One local Node process: SvelteKit serves the SPA and `/api` over SQLite and
the filesystem. `packages/game-engine/` holds the game, `packages/shared/` the
schemas both sides import, `evaluation/` the judges and pipelines. Detail:
`docs/architecture.md`.

## Invariants

- Secrets stay on the server.
- Ownership is enforced in the engine's repositories.
- The engine reaches its host only through `EngineContext`.
- The narrator never contradicts the blueprint.
- A failure is logged once, with enough context, and never swallowed.
- Reintroducing a hosted backend, container or build step is agreed first.

## Load per task

`docs/architecture.md` for any significant task; otherwise only:

| Task | Load |
|---|---|
| Game rules and turns | `docs/game.md`, `docs/backend-conventions.md` |
| Narrator (prompts, contracts, context, mock) | `docs/game.md`, `docs/ai-runtime.md` |
| AI backends and settings | `docs/ai-configuration.md` |
| UI | `docs/ui.md`, `docs/game.md` |
| API and database | `docs/backend-conventions.md` |
| Blueprint generation | `packages/shared/src/blueprint-schema-v2.ts`, `docs/blueprint-generation-flows.md`, `packages/blueprint-generator/src/generator-prompt.md`, `evaluation/generator-harness/template/README.md` |
| Blueprint judges | `docs/evaluation-pipeline.md`, `evaluation/README.md` |
| `gm_*` judges | `evaluation/judges/README.md`, "Earned, not free" in `docs/ai-runtime.md` |
| Trace, runtime, playtest | the README beside the code |
| Running, databases, worktrees | `docs/local-infrastructure.md` |
| Writing tests, or a failing gate step | `docs/testing.md` |

## Workflow

- Any workflow ending in a green gate and PR works.
- Worktrees: `./dev worktree create <branch>`, `./dev worktree release <branch>`.
- PRs use `.github/pull_request_template.md` and merge by squash.

## The gate

Any non-documentation change finishes with `npm test`; rerun it after any later
edit. It takes about 20 seconds. Run it in the background into a log named
after the worktree (a shared name gets overwritten), and read it on completion:

```bash
( npm test; echo "GATE_EXIT=$?" ) > "/tmp/gate-$(basename "$PWD").log" 2>&1
```

Never block on `tail -f` or a `while sleep` loop. Two traps:

- **Check `GATE_EXIT`**, not the task's exit code (the `echo`'s). Piping into
  `tail` masks it too.
- **Check the `Total` line**, not the last line. `Total ... FAIL` is the verdict.

Every step runs everywhere, no suite is skipped, and coverage floors hold.
Final summaries state which gates ran, and why anything was skipped.

## Documentation

Each topic has one owning doc: link to it, and update it with the behaviour.
Operator setup belongs in `QUICKSTART.md`.
