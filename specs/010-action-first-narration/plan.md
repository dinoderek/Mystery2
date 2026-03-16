# Implementation Plan: Action-First Multi-Part Narration

**Branch**: `010-action-first-narration` | **Date**: 2026-03-16 | **Spec**: [/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/spec.md](/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/spec.md)
**Input**: Feature specification from `/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/spec.md`

## Summary

Replace single-string narration across the gameplay boundary with ordered narration parts, make time-consuming actions resolve before forced accusation framing is appended, and make session start/resume rebuild the narration box strictly from persisted narration events rather than top-level narration summaries.

## Technical Context

**Language/Version**: TypeScript 5.x (SvelteKit web + shared package), TypeScript on Deno runtime for Supabase Edge Functions  
**Primary Dependencies**: SvelteKit, Supabase Edge Functions, Supabase JS client v2, Zod, Tailwind CSS, Vitest, Playwright  
**Storage**: Supabase Postgres (`game_sessions`, `game_events`) + Supabase Storage (`blueprints`)  
**Testing**: Vitest (`packages/shared/tests`, `tests/api/unit`, `tests/api/integration`, `tests/api/e2e`), Playwright (`web/e2e`)  
**Target Platform**: Static SvelteKit web UI + Supabase local/cloud backend  
**Project Type**: Web application monorepo (frontend + backend + shared contracts)  
**Performance Goals**: No observable regression in command-response flow latency; exact narration-area text parity across resume for mid-game, forced-accusation, and completed sessions  
**Constraints**: No backward compatibility for old narration payloads or old `game_events` rows; ordered `narration_parts` must be non-empty everywhere; any image shown in narration must be attached to the relevant narration part rather than gameplay state; move/search/ask resolve before timeout framing; `talk` and `end_talk` become non-time-consuming; local system/help/retry lines remain client-only; no client secrets or auth model changes  
**Scale/Scope**: 8 gameplay endpoints (`game-start`, `game-get`, `game-move`, `game-search`, `game-talk`, `game-ask`, `game-end-talk`, `game-accuse`), shared contracts, `game_events` persistence, UI store/rendering, and docs/tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Core docs reviewed and any required doc updates identified? (`/Users/dinohughes/Projects/my2/w1/docs/architecture.md`, `/Users/dinohughes/Projects/my2/w1/docs/game.md`, `/Users/dinohughes/Projects/my2/w1/docs/project-structure.md`, `/Users/dinohughes/Projects/my2/w1/docs/testing.md`, `/Users/dinohughes/Projects/my2/w1/docs/backend-conventions.md`, `/Users/dinohughes/Projects/my2/w1/docs/accusation-flow.md`)
- [x] Critical doc constraints and project knowledge are carried into this plan? (append-only event log + session snapshot preserved, accusation lifecycle preserved, shared contract first, docs requiring updates identified)
- [x] Testing strategy covers the required Unit, Integration, and E2E/browser tiers for this change? (shared contract tests, store/parser unit tests, backend integration/API E2E, and browser resume-parity E2E)
- [x] Quality gates are runnable for this change, or doc-only validation is explicitly justified? (`npm run test:all` remains the required final gate; no doc-only shortcut applies)
- [x] Static UI + Supabase backend constraints, auth, and no-client-secrets rules respected? (all gameplay changes remain in shared schemas, Edge Functions, Postgres, and browser rendering only)
- [x] Context-specific conventions and schema references were loaded for touched areas? (`/Users/dinohughes/Projects/my2/w1/docs/backend-conventions.md` and `/Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts`)
- [x] Observability/logging and failure-debugging expectations are defined? (timeout ordering, narration-event persistence, and resume failures captured in research and data model)

**Post-design re-check**: PASS. Phase 1 artifacts preserve shared-contract-first design, the existing function-per-endpoint architecture, authenticated Supabase boundaries, and the Constitution’s documentation/testing/observability requirements.

## Project Structure

### Documentation (this feature)

```text
/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── action-first-narration.openapi.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
/Users/dinohughes/Projects/my2/w1/
├── packages/
│   └── shared/
│       └── src/
│           └── mystery-api-contracts.ts
├── supabase/
│   ├── migrations/
│   │   └── *.sql                           # game_events narration-parts storage update
│   └── functions/
│       ├── _shared/
│       │   ├── forced-endgame.ts
│       │   ├── logging.ts
│       │   └── state-machine.ts
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
│           ├── types/game.ts
│           ├── domain/store.svelte.ts
│           └── components/NarrationBox.svelte
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
    └── accusation-flow.md
```

**Structure Decision**: Keep the existing SvelteKit + Supabase split and the append-only event-log architecture. Make the shared gameplay contract the source of truth, persist narration parts on `game_events`, keep session snapshots focused on playable state, attach any displayed image to the relevant narration part, and flatten persisted narration events into browser-rendered message lines without top-level narration fallback fields.

## Phase Plan

### Phase 0 - Research

- Define the public narration contract for turn responses and session load/start responses.
- Define the persistence model for ordered narration parts within the existing event log.
- Define the timeout sequencing rules for move, search, and ask versus free talk transitions.
- Define the browser resume strategy that guarantees exact narration text parity from persisted events only.
- Define observability requirements and required test/doc updates for the new behavior.

### Phase 1 - Design & Contracts

- Model narration parts, narration events, session snapshot boundaries, and timeout transitions in `data-model.md`.
- Define gameplay endpoint contracts in `contracts/action-first-narration.openapi.yaml`.
- Draft implementation and verification flow in `quickstart.md`.
- Update agent context via `/Users/dinohughes/Projects/my2/w1/.specify/scripts/bash/update-agent-context.sh codex`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
