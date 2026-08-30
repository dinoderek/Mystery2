# AI Agent Operations Guide

This file operationalizes `.specify/memory/constitution.md`. If this file
conflicts with the Constitution, the Constitution wins.

## Required Reading

For any significant task, review these core docs first:

- `docs/architecture.md`
- `docs/game.md`
- `docs/project-structure.md`
- `docs/testing.md`

When the task changes governance, templates, or compliance checks, also review:

- `.specify/memory/constitution.md`

Treat these documents as both guardrails and low-cost project context. Pull the
relevant facts and constraints forward into specs, plans, tasks, and final
summaries rather than treating them as passive background reading.

## Agent Execution Rules

- **Quality gates:** Any non-documentation change must finish with `npm test`.
  Focused scripts (`test:unit`, `test:integration`, etc.) are for iteration,
  not final sign-off.
- **Reading gate results:** `npm test` takes about a minute. Run it in the
  background redirected to a file, then **read that file** when the completion
  notification arrives:

  ```bash
  ( npm test; echo "GATE_EXIT=$?" ) > /tmp/gate.log 2>&1
  ```

  Never block on `tail -f`, `while sleep`, or similar — `tail -f` does not
  return when the command finishes, it keeps following the file, so the call
  hangs until it is killed. (`timeout` is also unavailable on macOS.) The
  harness re-invokes you when a background command exits; just read the log
  then.

  Two traps when reading the result:

  - **Check `GATE_EXIT`, not the task's exit code.** `( npm test; echo ... )`
    reports the exit status of the final `echo`, so the notification says
    "exit code 0" even when the gate failed. Likewise, piping `npm test` into
    `tail` masks the real status.
  - **Check the `Total` line, not the last line printed.** The per-step summary
    prints a trailing detail line under a failing step that can be a _passing_
    test name, and a `=== Coverage ===` section follows the table.
    `Total ... FAIL` is the verdict, and nothing under it can change it.

- **Coverage:** the gate measures it and never enforces it. `summary.log` ends
  with per-project totals and the files under the low-coverage threshold;
  `coverage.log` in the same run directory lists all of them. Treat a named
  file as a lead, not a failure — and remember the figures come from the unit
  suites alone, so anything reached only over HTTP reads as 0%. See
  `docs/testing.md`.
- **Quality-gate environment policy:** The `npm test` gate is mandatory, and
  every step of it runs everywhere. The gate builds the game and runs it
  against a throwaway database in a temporary directory; it needs nothing
  installed beyond this repo, so there is no environment in which a suite may
  be skipped or waived. "It wouldn't start" is a bug to fix, not a reason to
  report a partial run.
- **Final summaries:** Always state which quality gates ran. If anything was
  skipped, explain why.
- **The game database:** the gate and the suites never touch the database you
  play on. `scripts/lib/test-server.mjs` points the server at a temporary
  config root and deletes it afterwards. Anything that opens a database in a
  test must be given an explicit path — never `resolveDatabasePath()`.
- **Engine changes:** the engine is `packages/game-engine/`, imported by the
  SvelteKit server in `web/src/routes/api/`. Nothing needs restarting after an
  edit: `vite dev` reloads it, and the test scripts rebuild before each run.
- **AI/runtime changes:** If you change AI contracts, prompts, runtime context,
  or provider selection, update the mock runtime behavior and affected tests in
  the same change. Typical touchpoints are
  `packages/game-engine/src/ai-provider.ts`,
  `packages/game-engine/src/ai-profile.ts`, `tests/api/unit/ai-provider.test.ts`,
  and any integration or API E2E suite that relies on mock narration or the
  `default` profile.

## Task-Specific Loading Rules

Load additional guidance based on the area you are touching:

- SvelteKit styling or themes in `web/`: `docs/styling-conventions.md`
- New UI elements or component reuse in `web/`: `docs/component-inventory.md`
- SvelteKit routing or page architecture in `web/`: `docs/screen-navigation.md`
- The engine, API contracts, or database work: `docs/backend-conventions.md`
- Running the game, worktree isolation, or port issues:
  `docs/local-infrastructure.md`
- Structural mystery data-model changes:
  `packages/shared/src/blueprint-schema-v2.ts`
- Blueprint schema/generation flow changes or narrator/AI runtime changes:
  `docs/blueprint-generation-flows.md`, `docs/ai-runtime.md`, and
  `docs/ai-configuration.md`
- Blueprint or game-master-trace evaluation work (anything under
  `evaluation/` or the generator/judge harnesses): start with
  `docs/evaluation-pipeline.md` — the shared high-level design, with
  conditional pointers onward. The runbook + in-depth reference live next to
  the code, one per pipeline: `evaluation/README.md` (blueprint pipeline),
  `evaluation/trace/README.md` (game-master trace pipeline), and
  `evaluation/runtime/README.md` (runtime narrator harness). The game-master
  judges shared by the last two — their briefs, schemas, subject projection,
  and verdict rule — are documented in `evaluation/judges/README.md`; read it
  before adding or editing a `gm_*` judge.

## Documentation Maintenance

Keep documentation lean and current.

- Update the relevant files in `docs/` or `QUICKSTART.md` in the same change
  when setup steps, developer/operator workflows, runtime behavior, or
  debugging guidance changes.
- When touching blueprint fields, blueprint-fed generation paths, narrator
  prompts, narrator context, or other AI runtime behavior, review and update
  `docs/blueprint-generation-flows.md` and `docs/ai-runtime.md` in the same
  change.
- When touching seeded AI profile behavior, local profile selection, or mock
  vs live AI workflows, review and update `docs/ai-configuration.md` in the
  same change.
- Suggest a dedicated `docs/*.md` file when a change is significant enough that
  the core docs would become cluttered.
- In documentation-only changes, validate commands, paths, and links even when
  code quality gates are skipped.
