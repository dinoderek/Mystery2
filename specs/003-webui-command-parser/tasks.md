# Tasks: Web UI Command Parser

**Input**: Design documents from `/Users/dinohughes/Projects/my2/w1/specs/003-webui-command-parser/`
**Prerequisites**: `/Users/dinohughes/Projects/my2/w1/specs/003-webui-command-parser/plan.md`, `/Users/dinohughes/Projects/my2/w1/specs/003-webui-command-parser/spec.md`, `/Users/dinohughes/Projects/my2/w1/specs/003-webui-command-parser/research.md`, `/Users/dinohughes/Projects/my2/w1/specs/003-webui-command-parser/data-model.md`, `/Users/dinohughes/Projects/my2/w1/specs/003-webui-command-parser/contracts/parser-contract.md`

**Tests**: Unit and E2E coverage are required by the feature spec and plan. Add tests before implementation in each user story phase.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the web workspace to run parser-focused unit and E2E coverage.

- [ ] T001 Update unit-test script and dependencies in /Users/dinohughes/Projects/my2/w1/web/package.json to run Vitest for domain tests
- [ ] T002 Configure Vitest options for domain test execution in /Users/dinohughes/Projects/my2/w1/web/vite.config.ts
- [ ] T003 [P] Create parser test scaffold and shared ParseContext fixtures in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.test.ts
- [ ] T004 [P] Expand parser-focused network fixtures for command scenarios in /Users/dinohughes/Projects/my2/w1/web/e2e/input.test.ts
- [ ] T005 [P] Expand help-flow fixtures for command guidance scenarios in /Users/dinohughes/Projects/my2/w1/web/e2e/help.test.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish parser/store contracts that all user stories depend on.

**⚠️ CRITICAL**: No user story implementation starts until this phase is complete.

- [ ] T006 Define `ParseContext` and `ParseResult` discriminated unions in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.ts
- [ ] T007 Implement shared input normalization and token extraction helpers in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.ts
- [ ] T008 Refactor command submission flow to switch on `ParseResult` before backend invoke in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts
- [ ] T009 Add reusable history message helpers for system feedback and errors in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts
- [ ] T010 Create retry utility module scaffold for error classification/backoff in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.retry.ts

**Checkpoint**: Parser/store foundation is ready for independent user-story delivery.

---

## Phase 3: User Story 1 - Intelligent Command Recognition with Aliases (Priority: P1) 🎯 MVP

**Goal**: Recognize command aliases across modes and map valid commands to correct actions.

**Independent Test**: Alias variants for move/talk/search/end/quit parse correctly in explore/talk/accuse/ended modes and valid commands still submit successfully.

### Tests for User Story 1

- [ ] T011 [P] [US1] Add unit tests for alias recognition, longest-prefix matching, and mode-aware routing in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.test.ts
- [ ] T012 [P] [US1] Add E2E tests for alias submissions that should succeed in /Users/dinohughes/Projects/my2/w1/web/e2e/input.test.ts

### Implementation for User Story 1

- [ ] T013 [US1] Implement explore-mode alias tables (`move`, `talk`, `search`, `help`, `quit`) in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.ts
- [ ] T014 [US1] Implement exact-match handling for talk/accuse/ended modes with ask fallback in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.ts
- [ ] T015 [US1] Map `ParseResult type='valid'` commands to existing game endpoints in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts
- [ ] T016 [US1] Handle `type='quit'` command flow and user-facing history entry in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts

**Checkpoint**: User Story 1 is independently functional and testable.

---

## Phase 4: User Story 2 - Target Validation with Helpful Feedback (Priority: P1)

**Goal**: Validate targets client-side, block invalid/missing target submissions, and expose list commands.

**Independent Test**: Missing/invalid move and talk targets are caught client-side with suggestions; valid targets submit; `locations` and `characters` commands return inline lists.

### Tests for User Story 2

- [ ] T017 [P] [US2] Add unit tests for missing-target and invalid-target branches for move/talk in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.test.ts
- [ ] T018 [P] [US2] Add E2E tests that verify no backend call on invalid/missing targets plus list commands in /Users/dinohughes/Projects/my2/w1/web/e2e/input.test.ts

### Implementation for User Story 2

- [ ] T019 [US2] Implement movement target validation against known locations with suggestion generation in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.ts
- [ ] T020 [US2] Implement talk-target validation against character first/last names in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.ts
- [ ] T021 [US2] Implement `locations`/`where can i go` and `characters`/`who is here` list parsing in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.ts
- [ ] T022 [US2] Handle `missing-target`, `invalid-target`, and `list` parser branches without backend invocation in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts
- [ ] T023 [US2] Format movement/talk suggestion text and list output for narration history in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts

**Checkpoint**: User Story 2 is independently functional and testable.

---

## Phase 5: User Story 3 - Unrecognized Command Guidance (Priority: P2)

**Goal**: Show concise mode-specific inline command guidance for unrecognized input and keep detailed help in the modal.

**Independent Test**: Unrecognized inputs in each mode show short inline hints; `help` opens detailed modal with full alias coverage.

### Tests for User Story 3

- [ ] T024 [P] [US3] Add unit tests for mode-specific unrecognized hint strings and help detection in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.test.ts
- [ ] T025 [P] [US3] Add E2E tests for brief inline hints and help modal behavior in /Users/dinohughes/Projects/my2/w1/web/e2e/help.test.ts

### Implementation for User Story 3

- [ ] T026 [US3] Implement mode-specific unrecognized command hints in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.ts
- [ ] T027 [US3] Render concise inline unrecognized feedback with `help` prompt in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts
- [ ] T028 [US3] Update extended command reference content and aliases in /Users/dinohughes/Projects/my2/w1/web/src/lib/components/HelpModal.svelte

**Checkpoint**: User Story 3 is independently functional and testable.

---

## Phase 6: User Story 4 - Graceful Backend Error Handling with Retries (Priority: P2)

**Goal**: Retry transient backend failures up to 3 times with visible status and clear terminal errors.

**Independent Test**: Simulated transient failures auto-retry and recover/fail correctly; 4xx errors do not retry; manual retry remains possible.

### Tests for User Story 4

- [ ] T029 [P] [US4] Add unit tests for transient/permanent error classification and backoff sequencing in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.retry.test.ts
- [ ] T030 [P] [US4] Add E2E tests for retry success, retry exhaustion, and no-retry 4xx behavior in /Users/dinohughes/Projects/my2/w1/web/e2e/input.test.ts

### Implementation for User Story 4

- [ ] T031 [US4] Implement transient error classifier and exponential backoff helper in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.retry.ts
- [ ] T032 [US4] Integrate max-3 retry loop into backend invocation flow in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts
- [ ] T033 [US4] Track `isRetrying` and `retryCount` state and push retry progress/failure history messages in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts
- [ ] T034 [US4] Show retry-in-progress indicator and manual retry affordance in /Users/dinohughes/Projects/my2/w1/web/src/lib/components/InputBox.svelte

**Checkpoint**: User Story 4 is independently functional and testable.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency, documentation sync, and full quality gate verification.

- [ ] T035 [P] Synchronize parser contract details with final parser/store behavior in /Users/dinohughes/Projects/my2/w1/specs/003-webui-command-parser/contracts/parser-contract.md
- [ ] T036 [P] Document manual verification scenarios for this feature in /Users/dinohughes/Projects/my2/w1/specs/003-webui-command-parser/quickstart.md
- [ ] T037 [P] Update command parsing and retry guidance in /Users/dinohughes/Projects/my2/w1/docs/testing.md
- [ ] T038 Run full quality gates from /Users/dinohughes/Projects/my2/w1 via `npm run test:all`
- [ ] T039 Completion gate: update all impacted documentation under /Users/dinohughes/Projects/my2/w1/docs/* and re-run full test suite via `npm run test:all` from /Users/dinohughes/Projects/my2/w1 before marking the feature complete

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 (Setup) has no dependencies.
- Phase 2 (Foundational) depends on Phase 1 completion.
- Phases 3-6 (User Stories) depend on Phase 2 completion.
- Phase 7 (Polish) depends on completion of all targeted user stories.

### User Story Dependencies

- US1 (P1) starts first after Foundational and is the MVP slice.
- US2 (P1) depends on US1 parser contract shape (`ParseResult`) but remains independently testable.
- US3 (P2) depends on US1 mode-aware parsing and is independently testable.
- US4 (P2) depends on Foundational store pipeline and is independently testable.

### Dependency Graph

- Setup → Foundational → US1 → {US2, US3, US4} → Polish

---

## Parallel Execution Examples Per User Story

### US1 Parallel Example

- Run T011 and T012 together (unit + E2E in different files).
- After T013/T014 complete, T015 and T016 run sequentially in `store.svelte.ts`.

### US2 Parallel Example

- Run T017 and T018 together (unit + E2E).
- Run T019/T020/T021 sequentially in `parser.ts`, then T022/T023 in `store.svelte.ts`.

### US3 Parallel Example

- Run T024 and T025 together (unit + E2E).
- Run T026 and T027 sequentially, then T028 for detailed help content.

### US4 Parallel Example

- Run T029 and T030 together (unit + E2E).
- Run T031 before T032/T033, then T034 for UI status display.

---

## Implementation Strategy

### MVP First (US1 only)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational).
3. Complete Phase 3 (US1).
4. Validate US1 independently with T011/T012 and targeted manual checks.

### Incremental Delivery

1. Deliver MVP (US1).
2. Add US2 for target validation/list commands and validate independently.
3. Add US3 for unrecognized guidance/help behavior and validate independently.
4. Add US4 retry resilience and validate independently.
5. Run Phase 7 polish and full quality gates before merge.

### Completeness Validation Checklist

- Every user story has explicit tests and implementation tasks.
- Every task includes an exact file path.
- Each story has an independent test criterion.
- Story sequencing preserves priority and minimizes cross-story coupling.
- All tasks follow required checklist format: `- [ ] T### [P?] [US?] Description with file path`.
