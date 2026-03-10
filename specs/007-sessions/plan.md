# Implementation Plan: Sessions Navigation, Resume, and Completed Logs

**Branch**: `007-sessions` | **Date**: 2026-03-10 | **Spec**: [/Users/dinohughes/Projects/my2/w2/specs/007-sessions/spec.md](/Users/dinohughes/Projects/my2/w2/specs/007-sessions/spec.md)
**Input**: Feature specification from `/Users/dinohughes/Projects/my2/w2/specs/007-sessions/spec.md`

## Summary

Add a session-aware landing flow with three numbered options: new game, in-progress sessions, and completed sessions. Implement a new authenticated session-catalog backend contract for summary lists, keep session loading on existing `game-get`, and enforce read-only viewing behavior when an opened session is already ended.

## Technical Context

**Language/Version**: TypeScript 5.x (SvelteKit web + shared package), TypeScript on Deno runtime for Supabase Edge Functions  
**Primary Dependencies**: SvelteKit, Supabase JS client v2, Tailwind CSS, Supabase Edge Functions, Zod, Vitest, Playwright  
**Storage**: Supabase Postgres (`game_sessions`, `game_events`) + Supabase Storage (`blueprints`)  
**Testing**: Vitest (unit/integration/API E2E), Playwright (`web/e2e`)  
**Target Platform**: Static SvelteKit frontend + Supabase local/cloud backend  
**Project Type**: Web application monorepo (frontend + backend + shared contracts)  
**Performance Goals**: No observable regression in start-screen responsiveness; session catalog and list rendering remain interactive for typical user history (up to 100 sessions)  
**Constraints**: Auth-required access, RLS isolation by user, keyboard-first numeric navigation, `b` back behavior, completed-session viewer must be read-only, missing-blueprint sessions must be listed but not openable  
**Scale/Scope**: One new session-catalog contract + edge function, landing and list navigation updates in web routes/store, reuse of `game-get` for resume/view, and docs/test updates

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Documentation reviewed and lean? (`/Users/dinohughes/Projects/my2/w2/docs/architecture.md`, `/Users/dinohughes/Projects/my2/w2/docs/game.md`, `/Users/dinohughes/Projects/my2/w2/docs/project-structure.md`, `/Users/dinohughes/Projects/my2/w2/docs/testing.md`)
- [x] Testing strategy includes E2E (mandatory) and Unit/Integration? (unit + integration + API E2E + Playwright E2E coverage planned)
- [x] Quality gates runnable? (`npm run test:all` remains the required final gate)
- [x] Static UI + Supabase backend constraints respected? (no browser secrets, auth-protected Edge Functions, RLS preserved)
- [x] Context-specific conventions applied? (`/Users/dinohughes/Projects/my2/w2/docs/screen-navigation.md`, `/Users/dinohughes/Projects/my2/w2/docs/component-inventory.md`, `/Users/dinohughes/Projects/my2/w2/docs/backend-conventions.md`)

**Post-design re-check**: PASS. Phase 1 artifacts preserve shared-contract-first API boundaries, Supabase function architecture, authenticated access controls, and mandatory testing/documentation coverage.

## Project Structure

### Documentation (this feature)

```text
/Users/dinohughes/Projects/my2/w2/specs/007-sessions/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── sessions.openapi.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
/Users/dinohughes/Projects/my2/w2/
├── packages/
│   └── shared/
│       └── src/
│           └── mystery-api-contracts.ts
├── supabase/
│   └── functions/
│       ├── game-sessions-list/             # new
│       └── game-get/
│           └── index.ts                    # resume/view contract consumer
├── web/
│   └── src/
│       ├── routes/
│       │   ├── +page.svelte                # landing menu update
│       │   └── sessions/
│       │       ├── in-progress/+page.svelte  # new
│       │       └── completed/+page.svelte    # new
│       └── lib/
│           ├── domain/store.svelte.ts
│           ├── types/game.ts
│           └── components/
├── tests/
│   └── api/
│       ├── integration/
│       └── e2e/
├── web/e2e/
└── docs/
    ├── screen-navigation.md
    ├── component-inventory.md
    └── testing.md
```

**Structure Decision**: Keep the existing SvelteKit + Supabase split. Add one dedicated Edge Function for session summaries and keep session-resume/view state hydration on existing `game-get`. Add explicit list routes for in-progress/completed to preserve browser-back semantics and clear keyboard input mapping.

## Phase Plan

### Phase 0 - Research

- Define the session catalog contract (response shape, sorting, category grouping, and missing-blueprint handling).
- Define deterministic list ordering and openability rules for sessions whose blueprint no longer exists.
- Define route/navigation pattern for landing to in-progress/completed list flows with numeric input and `b` back behavior.
- Define resumed/completed session viewer behavior on existing `/session` route.
- Define required test coverage expansion across unit/integration/API E2E/Playwright E2E.

### Phase 1 - Design & Contracts

- Model session catalog, list-view state, and viewer mode transitions in `data-model.md`.
- Define `/game-sessions-list` and `/game-get` contracts in `contracts/sessions.openapi.yaml`.
- Draft implementation and verification flow in `quickstart.md`.
- Update agent context via `/Users/dinohughes/Projects/my2/w2/.specify/scripts/bash/update-agent-context.sh codex`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
