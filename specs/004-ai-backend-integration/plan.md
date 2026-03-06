# Implementation Plan: AI Backend Integration for Narrative Turns

**Branch**: `004-ai-backend-integration` | **Date**: 2026-03-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-ai-backend-integration/spec.md`

## Summary

Integrate a production-ready OpenRouter-backed AI runtime into the existing Supabase Edge Function APIs for talk, search, and accusation flows using role-specific prompts, schema-constrained outputs, and strict anti-leak context boundaries. Keep external backend API changes minimal (prefer internal orchestration changes over endpoint changes), add execution-profile model selection (default + cost-control), ensure failed AI calls do not finalize turns, and introduce dedicated opt-in live-AI integration/E2E suites using a deterministic investigator script while keeping default quality gates deterministic and cost-safe.

## Technical Context

**Language/Version**: TypeScript (Deno runtime for Supabase Edge Functions), TypeScript 5.x for tests and shared package  
**Primary Dependencies**: Supabase Edge Functions, Supabase JS client v2, Zod, OpenRouter HTTP API, Vitest, Playwright  
**Storage**: Supabase Postgres (`game_sessions`, `game_events`) + Supabase Storage blueprints  
**Testing**: Vitest (`tests/api/unit`, `tests/api/integration`, `tests/api/e2e`), Playwright (`web/e2e`), plus new opt-in live-AI suites  
**Target Platform**: Supabase local stack and hosted Supabase backend with static SvelteKit web client  
**Project Type**: Web application with Supabase backend functions  
**Performance Goals**: Keep non-live gameplay interactions interactive (target p95 < 2.5s per backend action). Complete each live-AI profile suite in <20 minutes median runtime.  
**Constraints**: No provider secrets in browser; non-accusation roles never receive full solution ground truth; invalid/failed AI outputs must not finalize turns; live-AI suites excluded from `npm run test:all`.  
**Scale/Scope**: Single-investigator game sessions, one active conversation context per session, two runtime model profiles, one deterministic investigator regression script.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Documentation reviewed and lean? (`docs/architecture.md`, `docs/game.md`, `docs/project-structure.md`, `docs/testing.md`, `docs/backend-conventions.md`)
- [x] Testing strategy includes E2E (mandatory) and Unit/Integration? (unit + integration + API E2E + Playwright E2E + dedicated opt-in live suites)
- [x] Quality gates runnable? (`npm run test:all` remains deterministic; live suites run via explicit commands)
- [x] Static UI + Supabase backend constraints respected? (OpenRouter calls only in Edge Functions; no UI secrets)
- [x] Context-specific conventions applied? (shared boundary contracts, Zod validation, Supabase Edge Function structure)

**Post-design re-check**: PASS. Design artifacts maintain architecture/security constraints, preserve existing endpoint surface as the default path, and keep default tests deterministic.

## Project Structure

### Documentation (this feature)

```text
specs/004-ai-backend-integration/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ai-game.openapi.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
supabase/
├── functions/
│   ├── _shared/
│   │   ├── ai-provider.ts                  # extend provider abstraction + profile routing + OpenRouter adapter
│   │   ├── ai-contracts.ts                 # new Zod output contracts per role
│   │   ├── ai-context.ts                   # new context builders + anti-leak redaction rules
│   │   ├── ai-prompts/
│   │   │   ├── talk-start.md
│   │   │   ├── talk-conversation.md
│   │   │   ├── talk-end.md
│   │   │   ├── search.md
│   │   │   ├── accusation-start.md
│   │   │   └── accusation-judge.md
│   │   └── blueprints/blueprint-schema.ts
│   ├── game-talk/index.ts                  # talk-start orchestration
│   ├── game-ask/index.ts                   # talk-conversation orchestration
│   ├── game-end-talk/index.ts              # talk-end orchestration
│   ├── game-search/index.ts                # search orchestration
│   ├── game-accuse/index.ts                # accusation orchestration (keeps existing endpoint)
│   └── game-get/index.ts
├── migrations/                             # optional session/event shape additions for accusation rounds
└── seed/blueprints/

packages/
└── shared/
    └── src/
        ├── api-types.ts
        └── schemas.ts                      # new shared boundary Zod contracts

tests/
└── api/
    ├── integration/
    │   ├── *.test.ts
    │   └── live-ai/                        # new live integration tests (opt-in)
    └── e2e/
        ├── game-flow.test.ts
        └── live-ai-flow.test.ts            # new live scripted API journey

web/
└── e2e/
    └── live-ai.spec.ts                     # optional browser-level live journey
```

**Structure Decision**: Keep existing Supabase function-per-endpoint architecture and prioritize internal AI orchestration changes inside current functions. Add AI runtime modules under `_shared` and isolate live-AI tests into dedicated opt-in paths so baseline quality gates remain deterministic.

## Documentation Deliverables

The implementation tasks MUST include explicit documentation work with both depth and overview:

1. Add a dedicated in-depth document: `docs/ai-runtime.md`
   - Role definitions and prompt responsibilities (`talk-start`, `talk-conversation`, `talk-end`, `search`, `accusation`).
   - Backend->AI input context boundaries, including non-accusation ground-truth exclusion.
   - AI output contracts and validation behavior before state mutation.
   - Failure/retry model and turn-finalization rules.
   - Live-AI profile strategy and execution modes.
2. Update existing core docs with concise change overviews:
   - `docs/architecture.md`: backend/AI interaction architecture and secret-handling boundary.
   - `docs/game.md`: gameplay implications for talk/search/accusation behavior.
   - `docs/testing.md`: deterministic vs live-AI suite split and how to run each.
   - `docs/project-structure.md`: any new AI runtime modules/files.
3. Ensure these updates remain lean: overview in core docs, implementation depth in `docs/ai-runtime.md`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
