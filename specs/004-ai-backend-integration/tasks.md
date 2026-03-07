# Tasks: AI Backend Integration for Narrative Turns

**Input**: Design documents from `/Users/dinohughes/Projects/my2/w1/specs/004-ai-backend-integration/`  
**Prerequisites**: `/Users/dinohughes/Projects/my2/w1/specs/004-ai-backend-integration/plan.md`, `/Users/dinohughes/Projects/my2/w1/specs/004-ai-backend-integration/spec.md`, `/Users/dinohughes/Projects/my2/w1/specs/004-ai-backend-integration/research.md`, `/Users/dinohughes/Projects/my2/w1/specs/004-ai-backend-integration/data-model.md`, `/Users/dinohughes/Projects/my2/w1/specs/004-ai-backend-integration/contracts/ai-game.openapi.yaml`, `/Users/dinohughes/Projects/my2/w1/specs/004-ai-backend-integration/quickstart.md`

**Tests**: Unit + Integration + API E2E + Web E2E are required. Dedicated live-AI suites are also required but must remain opt-in (excluded from `test:all`).

**Organization**: Tasks are grouped by user story so each story remains independently implementable and testable.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare repository scaffolding for AI runtime integration with minimal API surface changes.

- [X] T001 Create live-AI test directories at `/Users/dinohughes/Projects/my2/w1/tests/api/integration/live-ai/` and `/Users/dinohughes/Projects/my2/w1/tests/api/e2e/live-ai/`
- [X] T002 [P] Create AI prompt directory and role prompt files under `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-prompts/`
- [X] T003 [P] Add live-AI execution scripts in `/Users/dinohughes/Projects/my2/w1/package.json`
- [X] T004 [P] Add live-AI environment loading guidance in `/Users/dinohughes/Projects/my2/w1/QUICKSTART.md`
- [X] T005 Verify feature docs index includes `tasks.md` in `/Users/dinohughes/Projects/my2/w1/specs/004-ai-backend-integration/plan.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build shared backend↔AI contract and orchestration primitives required by all user stories.

**⚠️ CRITICAL**: No user story implementation should begin before this phase is complete.

- [X] T006 Implement profile-aware OpenRouter provider factory in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-provider.ts`
- [X] T007 [P] Implement role output schemas in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-contracts.ts`
- [X] T008 [P] Implement role context builders and ground-truth guardrails in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-context.ts`
- [X] T009 [P] Add backend/shared API boundary contracts in `/Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts`
- [X] T010 Add retriable AI failure helpers and consistent error payload details in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/errors.ts`
- [X] T011 Add foundational unit coverage for provider selection and schema validation in `/Users/dinohughes/Projects/my2/w1/tests/api/unit/ai-provider.test.ts`
- [X] T012 [P] Add foundational unit coverage for context redaction rules in `/Users/dinohughes/Projects/my2/w1/tests/api/unit/ai-context.test.ts`
- [X] T013 Update shared package exports for the new contracts module in `/Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts`

**Checkpoint**: Shared AI runtime contract + context + provider infrastructure is ready.

---

## Phase 3: User Story 1 - Reliable Character Conversations (Priority: P1) 🎯 MVP

**Goal**: Deliver coherent, age-appropriate talk interactions (`talk-start`, `talk-conversation`, `talk-end`) with anti-spoiler context boundaries.

**Independent Test**: Start a session, enter talk mode, ask multiple follow-ups, end talk, and verify continuity + spoiler-safe responses end-to-end.

### Tests for User Story 1

- [X] T014 [P] [US1] Add unit tests for talk output contracts in `/Users/dinohughes/Projects/my2/w1/tests/api/unit/ai-talk-contracts.test.ts`
- [X] T015 [P] [US1] Extend talk-start integration assertions in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-talk.test.ts`
- [X] T016 [P] [US1] Extend ask integration assertions for continuity and no-leak behavior in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-ask.test.ts`
- [X] T017 [P] [US1] Extend talk-end integration assertions in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-end-talk.test.ts`
- [X] T018 [P] [US1] Add API E2E talk journey assertions in `/Users/dinohughes/Projects/my2/w1/tests/api/e2e/game-flow.test.ts`

### Implementation for User Story 1

- [X] T019 [US1] Author `talk-start` prompt behavior in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-prompts/talk-start.md`
- [X] T020 [US1] Author `talk-conversation` prompt behavior in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-prompts/talk-conversation.md`
- [X] T021 [US1] Author `talk-end` prompt behavior in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-prompts/talk-end.md`
- [X] T022 [US1] Integrate `talk-start` orchestration with schema validation in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-talk/index.ts`
- [X] T023 [US1] Integrate `talk-conversation` orchestration with legacy compatibility (`clue_id` + `player_input`) in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-ask/index.ts`
- [X] T024 [US1] Integrate `talk-end` orchestration with retriable failure behavior in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-end-talk/index.ts`
- [X] T025 [US1] Ensure talk-role context boundaries and conversation history wiring in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-context.ts`

**Checkpoint**: US1 is independently functional and testable.

---

## Phase 4: User Story 2 - Search and Accusation Adjudication (Priority: P2)

**Goal**: Provide schema-validated AI narration for search and accusation adjudication while preserving existing backend endpoint surface and deterministic clue ownership.

**Independent Test**: Execute search and accusation through existing APIs, including follow-up reasoning rounds, until resolved outcome is reached with logically consistent responses.

### Tests for User Story 2

- [X] T026 [P] [US2] Add unit tests for accusation/search schemas in `/Users/dinohughes/Projects/my2/w1/tests/api/unit/ai-accusation-search-contracts.test.ts`
- [X] T027 [P] [US2] Extend search integration assertions (AI contract validity + deterministic clue behavior unchanged) in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-search.test.ts`
- [X] T028 [P] [US2] Extend accusation integration assertions for iterative adjudication in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-accuse.test.ts`
- [X] T029 [P] [US2] Extend API E2E accusation assertions in `/Users/dinohughes/Projects/my2/w1/tests/api/e2e/game-flow.test.ts`

### Implementation for User Story 2

- [X] T030 [US2] Author search prompt behavior in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-prompts/search.md`
- [X] T031 [US2] Integrate validated search narration while retaining existing clue logic in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-search/index.ts`
- [X] T032 [US2] Author accusation-start prompt behavior in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-prompts/accusation-start.md`
- [X] T033 [US2] Author accusation-judge prompt behavior in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-prompts/accusation-judge.md`
- [X] T034 [US2] Implement two-stage accusation orchestration on existing endpoint in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-accuse/index.ts`
- [X] T035 [US2] Update accusation state transition guards for round progression in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/state-machine.ts`
- [X] T036 [US2] Keep `game-get` compatible with accusation-round history retrieval in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-get/index.ts`
- [X] T037 [US2] Align backend API contract doc with implemented accusation/search behavior in `/Users/dinohughes/Projects/my2/w1/specs/004-ai-backend-integration/contracts/ai-game.openapi.yaml`

**Checkpoint**: US1 + US2 are independently functional and testable.

---

## Phase 5: User Story 3 - Live AI Regression Confidence (Priority: P3)

**Goal**: Add dedicated, opt-in live-AI regression suites for default and cost-control profiles without affecting deterministic quality gates.

**Independent Test**: Run live integration and API E2E investigator-script suites with `AI_PROFILE=default` and `AI_PROFILE=cost_control`; verify both complete with expected checkpoints while `npm run test:all` remains unchanged.

### Tests for User Story 3

- [X] T038 [P] [US3] Create live integration tests for talk/search flows in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/live-ai/live-ai-talk-search.test.ts`
- [X] T039 [P] [US3] Create live integration tests for accusation flow in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/live-ai/live-ai-accuse.test.ts`
- [X] T040 [P] [US3] Create live API E2E investigator script test in `/Users/dinohughes/Projects/my2/w1/tests/api/e2e/live-ai-flow.test.ts`
- [X] T041 [P] [US3] Create optional browser live smoke test in `/Users/dinohughes/Projects/my2/w1/web/e2e/live-ai.spec.ts`

### Implementation for User Story 3

- [X] T042 [US3] Add deterministic investigator script fixture in `/Users/dinohughes/Projects/my2/w1/tests/api/e2e/live-ai/investigator-script.ts`
- [X] T043 [US3] Add live profile/model resolution helpers in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-provider.ts`
- [X] T044 [US3] Add live test gating helpers in `/Users/dinohughes/Projects/my2/w1/tests/testkit/src/live-ai.ts`
- [X] T045 [US3] Add/adjust live-only npm scripts while keeping `test:all` deterministic in `/Users/dinohughes/Projects/my2/w1/package.json`

**Checkpoint**: Live-AI suites run explicitly per profile and deterministic baseline remains stable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Complete in-depth AI documentation, concise overview updates in core docs, and final validation.

- [X] T046 [P] Add in-depth AI runtime documentation in `/Users/dinohughes/Projects/my2/w1/docs/ai-runtime.md`
- [X] T047 [P] Update architecture overview for backend↔AI boundaries in `/Users/dinohughes/Projects/my2/w1/docs/architecture.md`
- [X] T048 [P] Update gameplay overview for AI talk/search/accusation behavior in `/Users/dinohughes/Projects/my2/w1/docs/game.md`
- [X] T049 [P] Update testing overview for deterministic vs live suites in `/Users/dinohughes/Projects/my2/w1/docs/testing.md`
- [X] T050 [P] Update structure overview for new AI runtime modules in `/Users/dinohughes/Projects/my2/w1/docs/project-structure.md`
- [X] T051 Sync quickstart runbook with final commands and checkpoints in `/Users/dinohughes/Projects/my2/w1/specs/004-ai-backend-integration/quickstart.md`
- [X] T052 Run deterministic quality gates and record pass status in `/Users/dinohughes/Projects/my2/w1/specs/004-ai-backend-integration/quickstart.md`
- [X] T053 Run both live profile suites and record profile results in `/Users/dinohughes/Projects/my2/w1/specs/004-ai-backend-integration/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies.
- **Phase 2 (Foundational)**: depends on Phase 1; blocks all user-story work.
- **Phase 3 (US1)**: depends on Phase 2.
- **Phase 4 (US2)**: depends on Phase 2; can proceed after US1 MVP validation.
- **Phase 5 (US3)**: depends on Phase 2 and implemented US1/US2 endpoints.
- **Phase 6 (Polish)**: depends on completion of selected user stories.

### User Story Dependencies

- **US1 (P1)**: starts immediately after Foundational phase; MVP target.
- **US2 (P2)**: starts after Foundational phase; functionally independent from US1 but shares runtime modules.
- **US3 (P3)**: depends on stable US1 + US2 behavior to run live regression scenarios.

### Dependency Graph

- `US1 -> US3`
- `US2 -> US3`
- `US1` and `US2` both depend on `Foundational`

---

## Parallel Execution Examples

### User Story 1

```bash
# Run US1 test tasks in parallel:
T014, T015, T016, T017, T018

# Create US1 prompt files in parallel:
T019, T020, T021
```

### User Story 2

```bash
# Run US2 test tasks in parallel:
T026, T027, T028, T029

# Author accusation/search prompt docs in parallel:
T030, T032, T033
```

### User Story 3

```bash
# Build live test suites in parallel:
T038, T039, T040, T041

# Implement live harness components in parallel:
T042, T044
```

---

## Implementation Strategy

### MVP First (US1)

1. Complete Phase 1 and Phase 2.
2. Complete US1 (Phase 3).
3. Validate independent US1 journey (talk start/ask/end + anti-leak + retries).
4. Demo/ship MVP if acceptable.

### Incremental Delivery

1. Add US2 (search + accusation adjudication) once US1 is stable.
2. Validate US2 independently with integration and API E2E flows.
3. Add US3 live regression suite last to avoid early cost and flakiness.
4. Finish with Phase 6 documentation and final validation.

### Notes

- `[P]` marks tasks safe to execute in parallel (different files, no direct dependency).
- Story labels (`[US1]`, `[US2]`, `[US3]`) are used only in user-story phases.
- Keep endpoint changes backward-compatible; prioritize internal backend↔AI contract implementation.
- Live-AI tests must remain opt-in and excluded from default deterministic quality gates.
