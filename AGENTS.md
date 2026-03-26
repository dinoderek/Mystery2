# AI Agent Operations Guide

This file operationalizes
`.specify/memory/constitution.md`. If this file conflicts with the Constitution,
the Constitution wins.

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

For testing, quality-gate, observability, and summary requirements, follow the
Constitution and `docs/testing.md`.

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
  `docs/blueprint-generation-flows.md` and `docs/ai-runtime.md`

## Documentation Maintenance

Keep documentation lean and current.

- Update the relevant files in `docs/` or `QUICKSTART.md` in the same change
  when setup steps, developer/operator workflows, runtime behavior, or
  debugging guidance changes.
- When touching blueprint fields, blueprint-fed generation paths, narrator
  prompts, narrator context, or other AI runtime behavior, always review and
  update `docs/blueprint-generation-flows.md` and `docs/ai-runtime.md` in the
  same change.
- Suggest a dedicated `docs/*.md` file when a change is significant enough that
  the core docs would become cluttered.
- In final summaries, call out which docs changed and note any skipped quality
  gates when the change is documentation-only.

## Supabase Edge Functions

When you modify files under `supabase/functions/` (including shared modules in
`supabase/functions/_shared/`), the running `supabase functions serve` process
**does not hot-reload**. You must restart it for changes to take effect.
Integration tests that hit Edge Function endpoints will keep testing stale code
until the server is restarted — this is a common source of false passes or
confusing failures.

## Worktree Isolation

Each git worktree automatically receives its own Supabase stack (unique
`project_id` and port range) when `ensureSupabaseRunning()` is called. This
enables concurrent test execution across worktrees. Orphaned stacks from
deleted worktrees are garbage-collected automatically. See
[`docs/local-infrastructure.md`](docs/local-infrastructure.md) for the full
design.

**In a worktree, always use `npm run` scripts** (`supabase:restart`,
`supabase:reset`, `seed:all`, `test:integration`, etc.) rather than raw
`npx supabase` commands. The npm scripts patch `supabase/config.toml` with
the worktree's project_id and ports before invoking the CLI.

## Active Technologies
- Supabase Postgres (`game_sessions`, `game_events`) + Supabase Storage (`blueprints`) (004-ai-backend-integration, 006-actor-aware-messaging, 007-sessions)
- TypeScript 5.x (web/shared + Node scripts), TypeScript on Deno runtime for Supabase Edge Functions, SvelteKit, Tailwind CSS (`t-*` tokens), Supabase Edge Functions, Supabase JS client v2, Supabase Storage, Zod, Vitest, Playwright, OpenRouter HTTP API (004-ai-backend-integration, 006-actor-aware-messaging, 009-static-blueprint-images)
- Supabase Storage bucket `blueprints` (JSON), planned image bucket for static blueprint assets, local operator image output directory (009-static-blueprint-images)

## Recent Changes
- 004-ai-backend-integration: Added TypeScript (Deno runtime for Supabase Edge Functions), TypeScript 5.x for tests and shared package + Supabase Edge Functions, Supabase JS client v2, Zod, OpenRouter HTTP API, Vitest, Playwright
