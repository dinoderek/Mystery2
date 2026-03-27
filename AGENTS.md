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
- **Final summaries:** Always state which quality gates ran. If anything was
  skipped, explain why.
- **Edge Function changes:** If you modify files under `supabase/functions/` or
  `supabase/functions/_shared/`, run `npm run supabase:restart` before
  integration tests, API E2E tests, browser E2E tests, or `npm test`. The test
  scripts call `ensureSupabaseRunning()`, but they do not restart stale Edge
  Function code automatically.
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
