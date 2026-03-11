# Tasks: Sessions Navigation, Resume, and Completed Logs

**Input**: Design documents from `/Users/dinohughes/Projects/my2/w2/specs/007-sessions/`
**Prerequisites**: `/Users/dinohughes/Projects/my2/w2/specs/007-sessions/plan.md`, `/Users/dinohughes/Projects/my2/w2/specs/007-sessions/spec.md`, `/Users/dinohughes/Projects/my2/w2/specs/007-sessions/research.md`, `/Users/dinohughes/Projects/my2/w2/specs/007-sessions/data-model.md`, `/Users/dinohughes/Projects/my2/w2/specs/007-sessions/contracts/sessions.openapi.yaml`

**Tests**: Unit, Integration, API E2E, and browser E2E coverage are required by the feature spec and must be included per story.

**Organization**: Tasks are grouped by user story so each story can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (`[US1]`, `[US2]`, `[US3]`) for story-phase tasks only
- Every task includes an exact file path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create feature scaffolding for backend, web routes, and tests.

- [X] T001 Create the new sessions catalog edge function scaffold in /Users/dinohughes/Projects/my2/w2/supabase/functions/game-sessions-list/index.ts
- [X] T002 [P] Create the in-progress sessions route scaffold in /Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/in-progress/+page.svelte
- [X] T003 [P] Create the completed sessions route scaffold in /Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/completed/+page.svelte
- [X] T004 [P] Create browser E2E scaffold for sessions navigation in /Users/dinohughes/Projects/my2/w2/web/e2e/sessions-navigation.test.ts
- [X] T005 [P] Create API integration scaffold for sessions catalog in /Users/dinohughes/Projects/my2/w2/tests/api/integration/game-sessions-list.test.ts
- [X] T006 [P] Create API E2E scaffold for resume/view session flows in /Users/dinohughes/Projects/my2/w2/tests/api/e2e/sessions-flow.test.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Complete shared contracts/types/store primitives that block all stories.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [X] T007 Extend shared session catalog schemas and exported types in /Users/dinohughes/Projects/my2/w2/packages/shared/src/mystery-api-contracts.ts
- [X] T008 [P] Add shared contract unit coverage for session catalog schemas in /Users/dinohughes/Projects/my2/w2/tests/api/unit/mystery-api-contracts.test.ts
- [X] T009 Add frontend session catalog types in /Users/dinohughes/Projects/my2/w2/web/src/lib/types/game.ts
- [X] T010 Add session catalog load/select/resume store primitives in /Users/dinohughes/Projects/my2/w2/web/src/lib/domain/store.svelte.ts
- [X] T011 [P] Add unit tests for session catalog normalization and sorting helpers in /Users/dinohughes/Projects/my2/w2/web/src/lib/domain/store.sessions.test.ts
- [X] T012 [P] Register `/game-sessions-list` preflight behavior in /Users/dinohughes/Projects/my2/w2/tests/api/integration/cors-preflight.test.ts

**Checkpoint**: Shared schemas, store primitives, and base test scaffolding are complete.

---

## Phase 3: User Story 1 - Session-Aware Landing Navigation (Priority: P1) 🎯 MVP

**Goal**: Show a three-option landing menu with correct enabled/disabled state and navigation to list routes.

**Independent Test**: On `/`, verify exactly three numbered options; options 2/3 disable correctly from catalog counts; enabled options navigate to `/sessions/in-progress` or `/sessions/completed`.

### Tests for User Story 1

- [X] T013 [P] [US1] Add integration tests for `/game-sessions-list` auth, category grouping, and counts in /Users/dinohughes/Projects/my2/w2/tests/api/integration/game-sessions-list.test.ts
- [X] T014 [P] [US1] Add Playwright coverage for three-option landing menu and disabled option behavior in /Users/dinohughes/Projects/my2/w2/web/e2e/start.test.ts

### Implementation for User Story 1

- [X] T015 [US1] Implement authenticated `/game-sessions-list` endpoint response skeleton (`in_progress`, `completed`, `counts`) in /Users/dinohughes/Projects/my2/w2/supabase/functions/game-sessions-list/index.ts
- [X] T016 [US1] Load session catalog on landing and render 3-option numeric menu in /Users/dinohughes/Projects/my2/w2/web/src/routes/+page.svelte
- [X] T017 [US1] Implement landing numeric-key navigation for options 2 and 3 in /Users/dinohughes/Projects/my2/w2/web/src/routes/+page.svelte
- [X] T018 [US1] Implement `b` keyboard back behavior for both list route scaffolds in /Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/in-progress/+page.svelte and /Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/completed/+page.svelte

**Checkpoint**: User Story 1 is independently functional and testable (MVP).

---

## Phase 4: User Story 2 - Resume In-Progress Sessions (Priority: P1)

**Goal**: Render in-progress sessions with details and resume selected sessions into interactive `/session`.

**Independent Test**: Open `/sessions/in-progress`, verify rows show mystery title/turns left/last played sorted by recency, select a row by number, and submit at least one gameplay command in `/session`.

### Tests for User Story 2

- [X] T019 [P] [US2] Add integration assertions for in-progress row fields and recency sort order in /Users/dinohughes/Projects/my2/w2/tests/api/integration/game-sessions-list.test.ts
- [X] T020 [P] [US2] Add API E2E coverage for resuming in-progress sessions via `game-get` in /Users/dinohughes/Projects/my2/w2/tests/api/e2e/sessions-flow.test.ts
- [X] T021 [P] [US2] Add Playwright coverage for in-progress list rendering and resume-by-number flow in /Users/dinohughes/Projects/my2/w2/web/e2e/sessions-navigation.test.ts

### Implementation for User Story 2

- [X] T022 [US2] Implement in-progress session query, recency sorting, and summary mapping in /Users/dinohughes/Projects/my2/w2/supabase/functions/game-sessions-list/index.ts
- [X] T023 [US2] Add reusable session list formatting helpers in /Users/dinohughes/Projects/my2/w2/web/src/lib/domain/session-list.ts
- [X] T024 [US2] Render in-progress rows with title, turns left, and last played in /Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/in-progress/+page.svelte
- [X] T025 [US2] Implement numeric row selection to hydrate session via `game-get` and navigate to `/session` in /Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/in-progress/+page.svelte
- [X] T026 [US2] Finalize store resume method to set active state for existing sessions in /Users/dinohughes/Projects/my2/w2/web/src/lib/domain/store.svelte.ts

**Checkpoint**: User Story 2 is independently functional and testable.

---

## Phase 5: User Story 3 - Browse Completed Sessions and Logs (Priority: P2)

**Goal**: Render completed sessions with outcome metadata and open completed sessions in read-only viewer mode.

**Independent Test**: Open `/sessions/completed`, verify rows show mystery title/outcome/last played sorted by recency, open a completed session, and confirm read-only prompt-only behavior with any-key return.

### Tests for User Story 3

- [X] T027 [P] [US3] Add integration assertions for completed row fields, outcome mapping, and recency sort order in /Users/dinohughes/Projects/my2/w2/tests/api/integration/game-sessions-list.test.ts
- [X] T028 [P] [US3] Add integration assertions for missing-blueprint rows (`can_open=false`) in /Users/dinohughes/Projects/my2/w2/tests/api/integration/game-sessions-list.test.ts
- [X] T029 [P] [US3] Add API E2E coverage for opening completed sessions and verifying ended-mode load behavior in /Users/dinohughes/Projects/my2/w2/tests/api/e2e/sessions-flow.test.ts
- [X] T030 [P] [US3] Add Playwright coverage for completed list selection and read-only session viewer in /Users/dinohughes/Projects/my2/w2/web/e2e/sessions-navigation.test.ts

### Implementation for User Story 3

- [X] T031 [US3] Implement completed session query and outcome mapping in /Users/dinohughes/Projects/my2/w2/supabase/functions/game-sessions-list/index.ts
- [X] T032 [US3] Implement missing-blueprint fallback title and disabled openability flags in /Users/dinohughes/Projects/my2/w2/supabase/functions/game-sessions-list/index.ts
- [X] T033 [US3] Render completed rows with title, outcome, and last played in /Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/completed/+page.svelte
- [X] T034 [US3] Enforce non-openable row UI/selection guards for `can_open=false` in /Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/completed/+page.svelte and /Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/in-progress/+page.svelte
- [X] T035 [US3] Set read-only viewer state for ended sessions loaded from catalog in /Users/dinohughes/Projects/my2/w2/web/src/lib/domain/store.svelte.ts
- [X] T036 [US3] Block ended-session command submission and preserve return prompt UX in /Users/dinohughes/Projects/my2/w2/web/src/lib/components/InputBox.svelte and /Users/dinohughes/Projects/my2/w2/web/src/lib/domain/store.svelte.ts
- [X] T037 [US3] Ensure any-key return-to-landing behavior for completed-session viewer in /Users/dinohughes/Projects/my2/w2/web/src/routes/session/+page.svelte

**Checkpoint**: User Story 3 is independently functional and testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalize docs, quality gates, and specification synchronization.

- [X] T038 [P] Update route/navigation documentation for landing and new sessions routes in /Users/dinohughes/Projects/my2/w2/docs/screen-navigation.md
- [X] T039 [P] Update component inventory for any reusable sessions UI components in /Users/dinohughes/Projects/my2/w2/docs/component-inventory.md
- [X] T040 [P] Update testing strategy documentation for session catalog and resume/completed flows in /Users/dinohughes/Projects/my2/w2/docs/testing.md
- [X] T041 [P] Update architecture and game behavior docs for session catalog and completed replay mode in /Users/dinohughes/Projects/my2/w2/docs/architecture.md and /Users/dinohughes/Projects/my2/w2/docs/game.md
- [X] T042 Run required quality gates from /Users/dinohughes/Projects/my2/w2/package.json (`npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, `npm -w web run test:e2e`, `npm run test:all`)
- [X] T043 Sync quickstart verification steps and file references in /Users/dinohughes/Projects/my2/w2/specs/007-sessions/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies.
- **Phase 2 (Foundational)**: Depends on Phase 1 completion.
- **Phase 3 (US1)**: Depends on Phase 2 completion.
- **Phase 4 (US2)**: Depends on Phase 3 completion.
- **Phase 5 (US3)**: Depends on Phase 3 completion and can run after US2 if shared capacity allows; scheduled after US2 by priority.
- **Phase 6 (Polish)**: Depends on completion of all user story phases.

### User Story Dependency Graph

```text
Setup -> Foundational -> US1 -> US2 -> US3 -> Polish
```

### Within Each User Story

- Write and run story tests before implementation updates for that story.
- Complete backend contract/behavior changes before final UI route integration.
- Validate independent test criteria for each story before moving on.

### Parallel Opportunities

- Setup: T002, T003, T004, T005, T006 can run in parallel after T001.
- Foundational: T008, T011, T012 can run in parallel after T007 and T009/T010 sequencing is respected.
- US1: T013 and T014 can run in parallel; T016 and T017 can run in parallel once T015 exists.
- US2: T019, T020, T021 can run in parallel; T023 and T024 can run in parallel after T022.
- US3: T027, T028, T029, T030 can run in parallel; T033 and T034 can run in parallel after T031/T032.
- Polish: T038, T039, T040, T041 can run in parallel before T042.

---

## Parallel Example: User Story 1

```bash
# Parallel US1 tests
Task: T013 /Users/dinohughes/Projects/my2/w2/tests/api/integration/game-sessions-list.test.ts
Task: T014 /Users/dinohughes/Projects/my2/w2/web/e2e/start.test.ts

# Parallel US1 UI wiring after endpoint skeleton
Task: T016 /Users/dinohughes/Projects/my2/w2/web/src/routes/+page.svelte
Task: T017 /Users/dinohughes/Projects/my2/w2/web/src/routes/+page.svelte
```

## Parallel Example: User Story 2

```bash
# Parallel US2 tests
Task: T019 /Users/dinohughes/Projects/my2/w2/tests/api/integration/game-sessions-list.test.ts
Task: T020 /Users/dinohughes/Projects/my2/w2/tests/api/e2e/sessions-flow.test.ts
Task: T021 /Users/dinohughes/Projects/my2/w2/web/e2e/sessions-navigation.test.ts

# Parallel US2 implementation pieces
Task: T023 /Users/dinohughes/Projects/my2/w2/web/src/lib/domain/session-list.ts
Task: T024 /Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/in-progress/+page.svelte
```

## Parallel Example: User Story 3

```bash
# Parallel US3 tests
Task: T027 /Users/dinohughes/Projects/my2/w2/tests/api/integration/game-sessions-list.test.ts
Task: T029 /Users/dinohughes/Projects/my2/w2/tests/api/e2e/sessions-flow.test.ts
Task: T030 /Users/dinohughes/Projects/my2/w2/web/e2e/sessions-navigation.test.ts

# Parallel US3 UI updates after backend mapping
Task: T033 /Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/completed/+page.svelte
Task: T037 /Users/dinohughes/Projects/my2/w2/web/src/routes/session/+page.svelte
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. Validate US1 independent test criteria end-to-end.
4. Demo MVP: landing menu with correct enable/disable states and route navigation.

### Incremental Delivery

1. Deliver US1 (landing session-aware navigation).
2. Deliver US2 (in-progress list details and resume flow).
3. Deliver US3 (completed list details and read-only replay).
4. Complete polish/docs/full quality gates.

### Parallel Team Strategy

1. Team completes Setup + Foundational together.
2. After Foundational:
   - Developer A: US1 landing and endpoint skeleton
   - Developer B: US2 resume flow
   - Developer C: US3 completed replay flow
3. Rejoin for Phase 6 documentation and full-gate validation.

---

## Notes

- All tasks use strict checklist format with checkbox, task ID, optional `[P]`, optional `[US#]`, and exact file paths.
- `[US#]` labels are used only in user story phases.
- Each user story has a defined independent test and can be validated without completing later stories.
