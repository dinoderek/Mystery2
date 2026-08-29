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

### Active multi-phase work

An in-flight architecture change is tracked in `docs/plans/`. **Before touching
`supabase/functions/`, `web/src/lib/api/`, the local stack scripts, or the deploy
path, check whether a plan there already covers it**, and read that plan's
`status.md` first — it records which phases have landed and what comes next.

- `docs/plans/local-execution/` — moving the game to fully local execution
  (SvelteKit + SQLite, no Docker, no cloud backend). Start with
  [`status.md`](docs/plans/local-execution/status.md).

A phase is only "done" when its PR is merged and `status.md` says so. Update
`status.md` in the same PR as the phase it describes.

## Agent Execution Rules

- **Quality gates:** Any non-documentation change must finish with `npm test`.
  Focused scripts (`test:unit`, `test:integration`, etc.) are for iteration,
  not final sign-off.
- **Reading gate results:** `npm test` takes ~30s once the stack is warm, but
  much longer on a cold start (Docker image pulls). Run it in the background
  redirected to a file, then **read that file** when the completion
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
    prints a trailing detail line under a failing step that can be a *passing*
    test name. `Total ... FAIL` is the verdict.
- **Quality-gate environment policy:** The `npm test` gate is mandatory and is
  **not** optional based on tool availability.
  - **Local / any environment where `MYSTERY_CLOUD_SESSION` is unset (the
    default):** run the full gate, including the Supabase-backed suites
    (integration, API E2E, browser E2E). If the local Supabase stack is not
    running, **start it** (`npm run supabase:restart`, then the relevant
    `seed:*` scripts) and run the suites. "Supabase wasn't running," "Docker
    wasn't started," or "the stack was unavailable" are setup steps you are
    responsible for completing — **never** reasons to skip a suite. A change
    whose backend suites did not run has not passed the gate, and the gate
    itself fails rather than skips when the stack cannot start.
  - **Cloud session only (`MYSTERY_CLOUD_SESSION=1`, set by the environment,
    never by you):** the Supabase-backed suites are **waived** because the
    cloud container has no Docker. The gate runs the full Phase 1 subset
    (lint, typecheck, svelte-check, both unit suites) and marks the backend
    suites `WAIVED`. In your summary, record them as
    `waived: cloud session (MYSTERY_CLOUD_SESSION)` and run them locally before
    merge. Do not claim the backend suites passed.
  - You may not set, export, or fabricate `MYSTERY_CLOUD_SESSION` to authorize
    a waiver. If it is absent, there is no waiver.
- **Final summaries:** Always state which quality gates ran. If anything was
  skipped, explain why.
- **Edge Function changes:** If you modify files under `supabase/functions/` or
  `supabase/functions/_shared/`, run `npm run supabase:restart` before
  integration tests, API E2E tests, browser E2E tests, or `npm test`. The test
  scripts call `ensureSupabaseRunning()`, but they do not restart stale Edge
  Function code automatically.
- **Mirrored shared modules:** Some `packages/shared/src/*.ts` modules are
  mirrored byte-for-byte into `supabase/functions/_shared/` because an Edge
  Function cannot import out of `supabase/functions`. Edit only the canonical
  file in `packages/shared/src/`, then run `npm run sync:shared`. The pairs are
  declared in `MIRRORED_FILES` (`scripts/sync-shared.mjs`); the `shared-sync`
  gate step fails on drift. See `docs/backend-conventions.md`.
- **Worktree-safe commands:** In a worktree, use `npm run supabase:*`,
  `npm run seed:*`, and repo test scripts instead of raw `npx supabase`
  commands. Use `QUICKSTART.md` for the command runbook and
  `docs/local-infrastructure.md` for the architecture and troubleshooting.
- **Stateful backend changes:** If you touch migrations, storage seeding, auth
  seeding, AI profiles, or local infrastructure, use the wrapper scripts
  (`supabase:restart`, `supabase:reset`, `seed:all`, `seed:ai`, etc.) rather
  than raw CLI commands.
- **AI/runtime changes:** If you change AI contracts, prompts, runtime context,
  provider selection, or seeded AI profiles, update the mock runtime behavior
  and affected tests in the same change. Typical touchpoints are
  `supabase/functions/_shared/ai-provider.ts`, `scripts/seed-ai.mjs`,
  `tests/api/unit/ai-provider.test.ts`, and any integration or API E2E suites
  that rely on mock narration or the seeded `default` profile.
- **AI reseeding:** After changing seeded profile behavior or local AI mode
  configuration, rerun `npm run seed:ai` or `npm run seed:all` as appropriate.

## Task-Specific Loading Rules

Load additional guidance based on the area you are touching:

- SvelteKit styling or themes in `web/`: `docs/styling-conventions.md`
- New UI elements or component reuse in `web/`: `docs/component-inventory.md`
- SvelteKit routing or page architecture in `web/`: `docs/screen-navigation.md`
- Edge Functions, API contracts, or database work:
  `docs/backend-conventions.md`
- Local Supabase stack, worktree isolation, or port issues:
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
