# AI Agent Guidelines

Welcome! As an AI agent working in this repository, you must adhere to the following rules to ensure consistency, quality, and maintainability.

## 1. Always Review Documentation

Before starting any significant task, you must load and review the core project documentation to understand the architecture, game rules, local development setup, structure, and testing strategies.

Explicitly read these files located in the `docs/` directory:

- `docs/architecture.md`
- `docs/game.md`
- `docs/project-structure.md`
- `docs/testing.md`

## 2. Test Everything You Build

Always ensure you have a concrete plan to test what you are building. The tests you write must be included in the project's quality gates (e.g., unit tests, integration tests, or E2E tests as appropriate for the feature).

Exception (documentation-only changes):
- If a change only modifies documentation files (`*.md`) and does not alter runtime code, build tooling, migrations, tests, or environment contracts, code test execution is not required.
- In that case, validate accuracy/consistency of the docs and keep links/commands up to date.

## 3. Run Quality Gates

Always run all the quality gates described in `docs/testing.md` before finalizing your work. Never bypass these checks.

Exception (documentation-only changes):
- For doc-only updates as defined above, quality gate test runs may be skipped.

## 4. Summarize Your Changes

Always generate a detailed, clear, and comprehensive summary of the changes you have made for the user to review. This ensures the user can easily understand your work and intent.

## 5. Maintain the Documentation

Always update the documentation loaded in Step 1 to reflect your changes. **However**, ensure the documentation stays lean and highly relevant. Do not add bloat or overly verbose descriptions of minor details.

## 6. Create Dedicated Documentation When Necessary

When making significant or complex changes, suggest the creation of additional, dedicated documentation files in the `docs/` directory (e.g., `docs/auth.md` or `docs/state-management.md`). Add conditional loading or pointers from the core root documents (from Step 1) to these specific files.

## 7. Context-Specific Conventions

Depending on the task at hand, you must dynamically load the following convention files to ensure you write code in the correct paradigm:

- If working on the SvelteKit UI styling or theme in the `web/` directory, load `docs/styling-conventions.md`.
- If creating new UI elements or trying to reuse existing ones in `web/`, load `docs/component-inventory.md`.
- If working on SvelteKit routing or page architecture in `web/`, load `docs/screen-navigation.md`.
- If working on Edge Functions, API contracts, or the database, load `docs/backend-conventions.md`.
- If modifying the structural data model of a mystery, read `supabase/functions/_shared/blueprints/blueprint-schema.ts`.

## Active Technologies
- Supabase Postgres (`game_sessions`, `game_events`) + Supabase Storage (`blueprints`) (004-ai-backend-integration, 006-actor-aware-messaging, 007-sessions)
- TypeScript 5.x (web/shared + Node scripts), TypeScript on Deno runtime for Supabase Edge Functions, SvelteKit, Tailwind CSS (`t-*` tokens), Supabase Edge Functions, Supabase JS client v2, Supabase Storage, Zod, Vitest, Playwright, OpenRouter HTTP API (004-ai-backend-integration, 006-actor-aware-messaging, 009-static-blueprint-images)
- Supabase Storage bucket `blueprints` (JSON), planned image bucket for static blueprint assets, local operator image output directory (009-static-blueprint-images)

## Recent Changes
- 004-ai-backend-integration: Added TypeScript (Deno runtime for Supabase Edge Functions), TypeScript 5.x for tests and shared package + Supabase Edge Functions, Supabase JS client v2, Zod, OpenRouter HTTP API, Vitest, Playwright
