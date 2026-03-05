# Implementation Plan: Supabase API Implementation

**Branch**: `001-supabase-api` | **Date**: 2026-03-05 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/001-supabase-api/spec.md`

## Summary

Implement the full Mystery Game backend API on Supabase. This covers: Postgres schema (migrations + RLS), 10 Supabase Edge Functions (Deno) implementing the API contract defined in `plan/B1-api-contract.md`, a shared AI provider abstraction (interface + `MockAIProvider` only — OpenRouter integration is deferred to a later feature), shared public types package, unit/integration tests for all API operations, and a full E2E test using a mock blueprint and mock AI running the complete investigation flow. The frontend (SvelteKit) is out of scope for this feature.

## Technical Context

**Language/Version**: TypeScript via Deno (Edge Functions) + TypeScript (Vitest/Playwright tests)  
**Primary Dependencies**: Supabase Edge Functions (Deno runtime), Supabase JS client (v2), Zod (schema validation)  
**Storage**: Postgres (Supabase) — `game_sessions` + `game_events` tables; Supabase Storage — `blueprints` bucket  
**Testing**: Deno test (unit), Vitest + `packages/testkit` (integration), Playwright (E2E)  
**Target Platform**: Supabase hosted + local Supabase CLI stack  
**Project Type**: Backend API (Supabase Edge Functions + Postgres)  
**Performance Goals**: All API operations respond within interactive game expectations (sub-2s for non-AI operations; AI-backed operations best-effort)  
**Constraints**: No secrets in client; all AI calls server-side; anonymous sessions for this feature  
**Scale/Scope**: Single-player sessions, local dev first; no multi-tenancy or scaling requirements in this feature

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Documentation reviewed and lean? (`architecture.md`, `testing.md`, `game.md`, `B1-api-contract.md` all read)
- [x] Testing strategy includes E2E (mandatory) and Unit/Integration? (Unit: Deno test; Integration: Vitest + local Supabase; E2E: Playwright with mock AI)
- [x] Quality gates runnable? (lint, typecheck, test:unit, test:integration, test:e2e all planned)
- [x] Static UI + Supabase backend constraints respected? (no logic in UI this feature; all AI calls in Edge Functions)
- [x] Context-specific conventions applied? (append-only event log, session snapshot, one function per endpoint)

## Project Structure

### Documentation (this feature)

```text
specs/001-supabase-api/
├── plan.md              # This file
├── research.md          # Phase 0 — 8 key technical decisions
├── data-model.md        # Phase 1 — Postgres schema, state machine, clue schema
├── contracts/
│   └── api.md           # Phase 1 — Full Edge Function API contract
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
supabase/
├── config.toml                          # Supabase project config
├── migrations/
│   ├── 0001_game_sessions.sql           # game_sessions table + RLS
│   ├── 0002_game_events.sql             # game_events table + RLS
│   └── 0003_blueprints_storage.sql      # blueprints storage bucket + policy
├── seed/
│   └── blueprints/                      # Test fixture blueprints (JSON)
│       └── mock-blueprint.json          # Deterministic mock for E2E/integration
└── functions/
    ├── _shared/
    │   ├── blueprints/
    │   │   └── blueprint-schema.ts      # Existing – Blueprint Zod schema
    │   ├── ai-provider.ts               # AIProvider interface + implementations
    │   ├── db.ts                        # Supabase client factory
    │   ├── state-machine.ts             # Mode transition validator
    │   └── errors.ts                    # Shared HTTP error helpers
    ├── blueprints-list/index.ts         # GET /api/blueprints
    ├── game-start/index.ts              # POST /api/game/start
    ├── game-get/index.ts                # GET /api/game/{id}
    ├── game-move/index.ts               # POST /api/game/{id}/move
    ├── game-search/index.ts             # POST /api/game/{id}/search
    ├── game-talk/index.ts               # POST /api/game/{id}/talk
    ├── game-ask/index.ts                # POST /api/game/{id}/ask
    ├── game-end-talk/index.ts           # POST /api/game/{id}/end_talk
    ├── game-accuse/index.ts             # POST /api/game/{id}/accuse
    └── game-accuse-reasoning/index.ts   # POST /api/game/{id}/accuse/reasoning

packages/
├── shared/
│   └── src/
│       └── api-types.ts                 # Public request/response types (GameState etc.)
└── testkit/
    └── src/
        ├── seed.ts                      # Test seeding helpers
        ├── auth.ts                      # Anonymous session helpers
        └── assertions.ts               # Common game state assertions

apps/web/tests/                          # (Stub locations — UI work in separate feature)
├── unit/                                # Deno: pure function tests
├── integration/                         # Vitest: real Supabase local stack
│   ├── blueprints.test.ts
│   ├── game-start.test.ts
│   ├── game-move.test.ts
│   ├── game-search.test.ts
│   ├── game-talk.test.ts
│   ├── game-ask.test.ts
│   ├── game-end-talk.test.ts
│   ├── game-accuse.test.ts
│   └── game-accuse-reasoning.test.ts
└── e2e/
    └── full-investigation.test.ts       # Playwright: complete mock investigation
```

**Structure Decision**: Supabase-native — one folder per Edge Function under `supabase/functions/`. Shared utilities in `_shared/`. Tests in `apps/web/tests/` as per architecture doc. Public types in `packages/shared/`. Test helpers in `packages/testkit/`.

## Implementation Phases

### Phase A — Foundation (no AI, no game logic)

1. Create `supabase/config.toml` (if not present)
2. Write migrations: `game_sessions`, `game_events`, blueprints storage bucket + policies
3. Implement `_shared/db.ts`, `_shared/errors.ts`, `_shared/state-machine.ts`
4. Implement `_shared/ai-provider.ts` (interface + `MockAIProvider` only — `OpenRouterProvider` is **deferred** to a future feature)
5. Create `packages/shared/src/api-types.ts` with all public types
6. Create `packages/testkit` with seed helpers
7. Implement `blueprints-list` function
8. Implement `game-start` function (with mock AI)
9. Implement `game-get` function

### Phase B — Exploration Loop

10. Implement `game-move` function
11. Implement `game-search` function

### Phase C — Interrogation Loop

12. Implement `game-talk` function
13. Implement `game-ask` function (AI conversation)
14. Implement `game-end-talk` function

### Phase D — Endgame

15. Implement `game-accuse` function
16. Implement `game-accuse-reasoning` function (AI adjudication)

### Phase E — Tests

17. Write unit tests (Deno): state machine, schema validation, prompt builders
18. Write integration tests (Vitest): all 10 API operations individually
19. Write E2E test (Playwright): full investigation with mock blueprint + mock AI
20. Add `package.json` scripts: `test:unit`, `test:integration`, `test:e2e`
21. Run quality gates

## Verification Plan

### Automated Tests

All tests require the local Supabase stack running (`supabase start`).

#### Unit Tests (Deno)
```bash
# Run pure Edge Function unit tests
deno test supabase/functions/ --allow-env --allow-net
```
- State machine: valid/invalid transitions for all mode pairs
- Zod schemas: valid and invalid blueprint payloads
- Prompt builder utilities: correct character context assembly

#### Integration Tests (Vitest)
```bash
# Ensure local Supabase is running first
supabase start

# Run integration test suite
npm run test:integration
```
Tests in `apps/web/tests/integration/`:
- `blueprints.test.ts` — lists blueprints, returns correct metadata shape
- `game-start.test.ts` — creates session, returns full state, mock AI narration
- `game-move.test.ts` — valid move updates state; invalid destination returns 400
- `game-search.test.ts` — finds clue; no-clue location returns null; time decrements
- `game-talk.test.ts` — enters talk mode; character not present returns 400
- `game-ask.test.ts` — returns AI response; context includes conversation history
- `game-end-talk.test.ts` — returns to explore mode
- `game-accuse.test.ts` — enters accuse mode
- `game-accuse-reasoning.test.ts` — win/loss resolution; multi-turn dialogue
- RLS: session A cannot be read with session B's ID

#### E2E Test (Playwright)
```bash
# Ensure local Supabase + SvelteKit dev server are running
supabase start
npm run dev  # (in apps/web)

# Run E2E suite
npm run test:e2e
```
Test `e2e/full-investigation.test.ts` covers:
1. Load blueprint list — assert at least 1 blueprint
2. Start game with `mock-blueprint.json` fixture, assert opening state
3. Move to a non-starting location, assert narration + updated location
4. Search current location, assert clue discovered
5. Talk to a character, assert talk mode entry
6. Ask a question, assert mock AI response + time decremented
7. End talk, assert explore mode restored
8. Resume session: fetch `GET /game/{id}` and assert state matches last known state
9. Accuse the culprit, assert accuse mode
10. Submit reasoning, assert `outcome: "win"` with mock AI

### Quality Gates (run before marking feature complete)

```bash
npm run lint          # Linting & formatting
npm run typecheck     # TypeScript type checking
npm run test:unit     # Deno unit tests
npm run test:integration  # Vitest integration tests
npm run test:e2e      # Playwright E2E tests
```

## Complexity Tracking

> No constitution violations. Standard Supabase Edge Function architecture; complexity is proportional to the number of API operations.
