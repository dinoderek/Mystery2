# Implementation Plan: Actor-Aware Message Rendering

**Branch**: `006-actor-aware-messaging` | **Date**: 2026-03-09 | **Spec**: [/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/spec.md](/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/spec.md)
**Input**: Feature specification from `/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/spec.md`

## Summary

Introduce explicit speaker metadata at the API boundary and UI message model so every rendered line includes a reliable actor label. Keep accusation and conversation start/end narration mapped to narrator, keep character rendering as one generic character style per theme, and keep local system feedback strictly client-side (styled as system but not persisted into backend history).

## Technical Context

**Language/Version**: TypeScript 5.x (SvelteKit web + shared package), TypeScript on Deno runtime for Supabase Edge Functions  
**Primary Dependencies**: SvelteKit, Tailwind CSS, Supabase Edge Functions, Supabase JS client v2, Zod, Vitest, Playwright  
**Storage**: Supabase Postgres (`game_sessions`, `game_events`) and Supabase Storage (blueprints)  
**Testing**: Vitest (`tests/api/unit`, `tests/api/integration`, `tests/api/e2e`), Playwright (`web/e2e`)  
**Target Platform**: Static SvelteKit web UI + Supabase local/cloud backend  
**Project Type**: Web application monorepo (frontend + backend + shared contracts)  
**Performance Goals**: No observable regression in command-response flow latency; 100% of rendered message blocks include a speaker label in E2E checks  
**Constraints**: No API/session backward compatibility requirement for older formats; client-generated system lines must not be persisted; conversation start/end and accusation narration remain narrator; per-character color customization is out of scope  
**Scale/Scope**: 8 gameplay endpoints (`game-start/get/move/search/talk/ask/end-talk/accuse`), shared API contracts, UI store/message rendering, and full test + doc updates

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Documentation reviewed and lean? (`/Users/dinohughes/Projects/my2/w3/docs/architecture.md`, `/Users/dinohughes/Projects/my2/w3/docs/game.md`, `/Users/dinohughes/Projects/my2/w3/docs/project-structure.md`, `/Users/dinohughes/Projects/my2/w3/docs/testing.md`)
- [x] Testing strategy includes E2E (mandatory) and Unit/Integration? (unit + integration + API E2E + Playwright E2E coverage expanded for speaker attribution)
- [x] Quality gates runnable? (`npm run test:all` remains the required final gate)
- [x] Static UI + Supabase backend constraints respected? (speaker data produced server-side in Edge Functions and rendered client-side; no browser secrets)
- [x] Context-specific conventions applied? (`/Users/dinohughes/Projects/my2/w3/docs/backend-conventions.md`, `/Users/dinohughes/Projects/my2/w3/docs/styling-conventions.md`, `/Users/dinohughes/Projects/my2/w3/docs/component-inventory.md`)

**Post-design re-check**: PASS. Phase 1 design artifacts keep contract-first shared schemas, Supabase function boundaries, Tailwind-only styling approach, and mandatory test/doc coverage.

## Project Structure

### Documentation (this feature)

```text
/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── actor-aware-messaging.openapi.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
/Users/dinohughes/Projects/my2/w3/
├── packages/
│   └── shared/
│       └── src/
│           └── mystery-api-contracts.ts
├── supabase/
│   └── functions/
│       ├── _shared/
│       │   └── speaker.ts                    # new shared speaker helpers/constants
│       ├── game-start/index.ts
│       ├── game-get/index.ts
│       ├── game-move/index.ts
│       ├── game-search/index.ts
│       ├── game-talk/index.ts
│       ├── game-ask/index.ts
│       ├── game-end-talk/index.ts
│       └── game-accuse/index.ts
├── web/
│   └── src/
│       └── lib/
│           ├── domain/store.svelte.ts
│           ├── components/TerminalMessage.svelte
│           └── types/game.ts
├── tests/
│   └── api/
│       ├── unit/
│       ├── integration/
│       └── e2e/
├── web/e2e/
└── docs/
    ├── architecture.md
    ├── game.md
    ├── testing.md
    ├── project-structure.md
    └── component-inventory.md
```

**Structure Decision**: Keep the existing function-per-endpoint backend architecture and centralized UI store flow. Add one shared speaker helper module in backend, extend shared API schemas first, and keep UI styling mapping centralized by speaker kind with one generic character style per theme.

## Phase Plan

### Phase 0 - Research

- Confirm speaker metadata contract shape and mapping rules across all game endpoints.
- Confirm persistence boundary for backend narration vs client-only system feedback.
- Confirm theme-aware style strategy that uses speaker kind only (no per-character style overrides).
- Confirm test strategy updates needed at unit/integration/E2E levels.

### Phase 1 - Design & Contracts

- Define entities and validation/state rules in `data-model.md`.
- Define REST contracts in `contracts/actor-aware-messaging.openapi.yaml`.
- Draft execution and verification flow in `quickstart.md`.
- Update agent context via `.specify/scripts/bash/update-agent-context.sh codex`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
