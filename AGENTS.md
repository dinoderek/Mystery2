# AI Agent Guidelines

Welcome! As an AI agent working in this repository, you must adhere to the following rules to ensure consistency, quality, and maintainability.

## 1. Always Review Documentation
Before starting any significant task, you must load and review the core project documentation to understand the architecture, game rules, local development setup, structure, and testing strategies. 

Explicitly read these files located in the `docs/` directory:
- `docs/architecture.md`
- `docs/game.md`
- `docs/local-dev.md`
- `docs/project-structure.md`
- `docs/testing.md`

## 2. Test Everything You Build
Always ensure you have a concrete plan to test what you are building. The tests you write must be included in the project's quality gates (e.g., unit tests, integration tests, or E2E tests as appropriate for the feature).

## 3. Run Quality Gates
Always run all the quality gates described in `docs/testing.md` before finalizing your work. Never bypass these checks.

## 4. Summarize Your Changes
Always generate a detailed, clear, and comprehensive summary of the changes you have made for the user to review. This ensures the user can easily understand your work and intent.

## 5. Maintain the Documentation
Always update the documentation loaded in Step 1 to reflect your changes. **However**, ensure the documentation stays lean and highly relevant. Do not add bloat or overly verbose descriptions of minor details.

## 6. Create Dedicated Documentation When Necessary
When making significant or complex changes, suggest the creation of additional, dedicated documentation files in the `docs/` directory (e.g., `docs/auth.md` or `docs/state-management.md`). Add conditional loading or pointers from the core root documents (from Step 1) to these specific files.

## 7. Context-Specific Conventions
Depending on the task at hand, you must dynamically load the following convention files to ensure you write code in the correct paradigm:
- If working on the SvelteKit UI styling or theme, load `docs/styling-conventions.md`.
- If creating new UI elements or trying to reuse existing ones, load `docs/component-inventory.md`.
- If working on SvelteKit routing or page architecture, load `docs/screen-navigation.md`.
- If working on Edge Functions, API contracts, or the database, load `docs/backend-conventions.md`.
- If modifying the structural data model of a mystery, read `supabase/functions/_shared/blueprints/blueprint-schema.ts`.
