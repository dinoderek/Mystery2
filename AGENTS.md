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
- Structural mystery data-model changes:
  `supabase/functions/_shared/blueprints/blueprint-schema.ts`

## Documentation Maintenance

Keep documentation lean and current.

- Update the relevant files in `docs/` or `QUICKSTART.md` in the same change
  when setup steps, developer/operator workflows, runtime behavior, or
  debugging guidance changes.
- Suggest a dedicated `docs/*.md` file when a change is significant enough that
  the core docs would become cluttered.
- In final summaries, call out which docs changed and note any skipped quality
  gates when the change is documentation-only.

## Active Technologies
- Supabase Postgres (`game_sessions`, `game_events`) + Supabase Storage (`blueprints`) (004-ai-backend-integration, 006-actor-aware-messaging, 007-sessions)
- TypeScript 5.x (web/shared + Node scripts), TypeScript on Deno runtime for Supabase Edge Functions, SvelteKit, Tailwind CSS (`t-*` tokens), Supabase Edge Functions, Supabase JS client v2, Supabase Storage, Zod, Vitest, Playwright, OpenRouter HTTP API (004-ai-backend-integration, 006-actor-aware-messaging, 009-static-blueprint-images)
- Supabase Storage bucket `blueprints` (JSON), planned image bucket for static blueprint assets, local operator image output directory (009-static-blueprint-images)

## Recent Changes
- 004-ai-backend-integration: Added TypeScript (Deno runtime for Supabase Edge Functions), TypeScript 5.x for tests and shared package + Supabase Edge Functions, Supabase JS client v2, Zod, OpenRouter HTTP API, Vitest, Playwright
