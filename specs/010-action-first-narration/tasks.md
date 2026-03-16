# Tasks: Action-First Multi-Part Narration

**Input**: Design documents from `/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/`
**Prerequisites**: `/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/plan.md`, `/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/spec.md`, `/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/research.md`, `/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/data-model.md`, `/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/contracts/action-first-narration.openapi.yaml`

**Tests**: This feature requires Unit, Integration, API E2E, and browser E2E coverage per `/Users/dinohughes/Projects/my2/w1/docs/testing.md`.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

**Documentation carry-through**: Preserve constraints from `/Users/dinohughes/Projects/my2/w1/docs/architecture.md`, `/Users/dinohughes/Projects/my2/w1/docs/game.md`, `/Users/dinohughes/Projects/my2/w1/docs/testing.md`, `/Users/dinohughes/Projects/my2/w1/docs/project-structure.md`, `/Users/dinohughes/Projects/my2/w1/docs/backend-conventions.md`, and `/Users/dinohughes/Projects/my2/w1/docs/accusation-flow.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- All task descriptions include exact file paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the shared scaffolding for narration-part persistence, typing, and validation before touching story-specific flows.

- [ ] T001 Create shared narration-event helper scaffolding in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/narration.ts`
- [ ] T002 [P] Extend shared and web-facing type scaffolding for narration parts in `/Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts` and `/Users/dinohughes/Projects/my2/w1/web/src/lib/types/game.ts`
- [ ] T003 [P] Add baseline contract fixture coverage for narration-part payloads in `/Users/dinohughes/Projects/my2/w1/tests/api/unit/mystery-api-contracts.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Complete the blocking persistence, contract, and normalization changes required before any user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Add the `game_events` narration-parts migration in `/Users/dinohughes/Projects/my2/w1/supabase/migrations/0008_narration_parts.sql`
- [ ] T005 Update the canonical gameplay contract for `narration_parts`, `narration_events`, part-level `image_id`, and optional accusation reasoning in `/Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts`
- [ ] T006 Implement canonical narration-event persistence and flattening helpers in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/narration.ts` and `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/forced-endgame.ts`
- [ ] T007 [P] Refactor browser transcript normalization to consume `narration_events` and part-level images in `/Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts` and `/Users/dinohughes/Projects/my2/w1/web/src/lib/types/game.ts`
- [ ] T008 [P] Update non-time-consuming talk transition coverage in `/Users/dinohughes/Projects/my2/w1/tests/api/unit/state-machine.test.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Preserve The Last Action (Priority: P1) 🎯 MVP

**Goal**: Ensure the final time-consuming move, search, or question completes visibly before the game appends forced accusation framing, while `talk` and `end_talk` no longer consume time.

**Independent Test**: Run final-turn `move`, `search`, and `ask` flows and confirm the action narration persists first, forced accusation framing appears second, and `talk`/`end_talk` leave time unchanged.

### Tests for User Story 1

- [ ] T009 [P] [US1] Add action-first timeout integration coverage for `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-move/index.ts` in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-move.test.ts`
- [ ] T010 [P] [US1] Add action-first timeout integration coverage for `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-search/index.ts` in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-search.test.ts`
- [ ] T011 [P] [US1] Add action-first timeout and character-response ordering coverage for `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-ask/index.ts` in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-ask.test.ts`
- [ ] T012 [P] [US1] Add non-time-consuming talk transition coverage for `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-talk/index.ts` and `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-end-talk/index.ts` in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-talk.test.ts` and `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-end-talk.test.ts`
- [ ] T013 [P] [US1] Add API E2E coverage for final-turn move/search/ask transcript ordering in `/Users/dinohughes/Projects/my2/w1/tests/api/e2e/game-flow.test.ts`

### Implementation for User Story 1

- [ ] T014 [US1] Refactor timeout sequencing and separated event persistence in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-move/index.ts`
- [ ] T015 [US1] Refactor timeout sequencing and separated event persistence in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-search/index.ts`
- [ ] T016 [US1] Refactor timeout sequencing and separated event persistence in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-ask/index.ts`
- [ ] T017 [US1] Make `talk` start non-time-consuming while still returning narration parts in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-talk/index.ts`
- [ ] T018 [US1] Make `end_talk` non-time-consuming while still returning narration parts in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-end-talk/index.ts`
- [ ] T019 [US1] Update combined action-plus-timeout response handling and time-neutral talk state updates in `/Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts`

**Checkpoint**: User Story 1 should now be fully functional and independently testable as the MVP

---

## Phase 4: User Story 2 - Resume Exact Narration History (Priority: P2)

**Goal**: Make session start/resume and completed-session replay rebuild the narration box exactly from persisted narration events, including part-attached images, without top-level narration fallbacks.

**Independent Test**: Capture narration-area text for mid-game, forced-accusation, and completed sessions, reload each session, and confirm exact text parity before and after resume.

### Tests for User Story 2

- [ ] T020 [P] [US2] Add transcript/state split coverage for `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-start/index.ts` in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-start.test.ts`
- [ ] T021 [P] [US2] Add `narration_events`-only replay coverage for `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-get/index.ts` in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-get.test.ts`
- [ ] T022 [P] [US2] Add accusation transcript persistence coverage for `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-accuse/index.ts` in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-accuse.test.ts`
- [ ] T023 [P] [US2] Add API E2E coverage for `narration_events`-driven resume and completed replay in `/Users/dinohughes/Projects/my2/w1/tests/api/e2e/game-flow.test.ts` and `/Users/dinohughes/Projects/my2/w1/tests/api/e2e/sessions-flow.test.ts`
- [ ] T024 [P] [US2] Add browser coverage for rendered narration-area resume parity and part-attached images in `/Users/dinohughes/Projects/my2/w1/web/e2e/narration.test.ts`

### Implementation for User Story 2

- [ ] T025 [US2] Refactor `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-start/index.ts` to return `state` plus persisted `narration_events`
- [ ] T026 [US2] Refactor `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-get/index.ts` to read only persisted narration parts and drop top-level narration fallback inference
- [ ] T027 [US2] Refactor `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-accuse/index.ts` to emit and persist narration parts for accusation start, rounds, and completed outcomes
- [ ] T028 [US2] Update transcript hydration and local-only message handling in `/Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts`
- [ ] T029 [US2] Update rendering of flattened narration parts and part-level images in `/Users/dinohughes/Projects/my2/w1/web/src/lib/components/NarrationBox.svelte`, `/Users/dinohughes/Projects/my2/w1/web/src/lib/components/StoryImagePanel.svelte`, and `/Users/dinohughes/Projects/my2/w1/web/src/lib/api/images.ts`
- [ ] T030 [US2] Update browser-store unit coverage for parts-only transcript replay in `/Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.speaker.test.ts` and `/Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.sessions.test.ts`

**Checkpoint**: User Stories 1 and 2 should now both work independently, with exact transcript replay on resume

---

## Phase 5: User Story 3 - Diagnose Ordering And Resume Failures (Priority: P3)

**Goal**: Make timeout ordering, narration-event persistence, and transcript-load failures diagnosable for operators and clearly surfaced to players.

**Independent Test**: Trigger timeout and transcript-load failure paths and verify logs capture event order and timing context while the player sees a clear recovery message.

### Tests for User Story 3

- [ ] T031 [P] [US3] Add unit coverage for narration-event ordering and diagnostics helpers in `/Users/dinohughes/Projects/my2/w1/tests/api/unit/narration-events.test.ts`
- [ ] T032 [P] [US3] Add integration coverage for timeout diagnostics and transcript-load failures in `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-ask.test.ts` and `/Users/dinohughes/Projects/my2/w1/tests/api/integration/game-get.test.ts`
- [ ] T033 [P] [US3] Add browser coverage for player-facing transcript recovery messaging in `/Users/dinohughes/Projects/my2/w1/web/e2e/narration.test.ts`

### Implementation for User Story 3

- [ ] T034 [US3] Extend request and event diagnostics for narration ordering in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/logging.ts` and `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/narration.ts`
- [ ] T035 [US3] Add explicit transcript-load failure handling in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-get/index.ts` and `/Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts`
- [ ] T036 [US3] Add forced-endgame ordering diagnostics in `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-move/index.ts`, `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-search/index.ts`, and `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-ask/index.ts`

**Checkpoint**: All three user stories should now be independently functional and diagnosable

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finish the shared documentation, validation, and release-readiness work that spans multiple user stories.

- [ ] T037 [P] Update gameplay timing and accusation-flow documentation in `/Users/dinohughes/Projects/my2/w1/docs/game.md` and `/Users/dinohughes/Projects/my2/w1/docs/accusation-flow.md`
- [ ] T038 [P] Update transcript-persistence and coverage docs in `/Users/dinohughes/Projects/my2/w1/docs/architecture.md`, `/Users/dinohughes/Projects/my2/w1/docs/testing.md`, and `/Users/dinohughes/Projects/my2/w1/docs/project-structure.md`
- [ ] T039 [P] Reconcile feature quickstart and contract notes with the implemented behavior in `/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/quickstart.md` and `/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/contracts/action-first-narration.openapi.yaml`
- [ ] T040 Run the full quality gate from `/Users/dinohughes/Projects/my2/w1/package.json` and record validation outcomes in `/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1: Setup**: No dependencies; start immediately.
- **Phase 2: Foundational**: Depends on Phase 1; blocks all user story work.
- **Phase 3: User Story 1**: Depends on Phase 2; defines the MVP.
- **Phase 4: User Story 2**: Depends on Phase 2 and reuses the shared narration-event foundation; can begin after Phase 2 but is safest after the US1 persistence helpers are stable.
- **Phase 5: User Story 3**: Depends on Phase 2 and should layer on top of the implemented persistence/resume paths from US1 and US2.
- **Phase 6: Polish**: Depends on completion of the stories you plan to ship.

### User Story Dependencies

- **User Story 1 (P1)**: No dependency on other stories after Phase 2.
- **User Story 2 (P2)**: Depends on the shared narration-part foundation but remains independently testable once implemented.
- **User Story 3 (P3)**: Depends on the implemented narration-event flows from US1 and US2 to validate diagnostics and failure handling.

### Within Each User Story

- Execute the story’s tests before or alongside implementation and confirm they fail against the pre-change behavior.
- Complete persistence/helpers before endpoint refactors that rely on them.
- Complete backend contract work before browser rendering changes that consume the new payloads.
- Do not start Polish tasks until the targeted story set is passing its story-level tests.

### Parallel Opportunities

- T002 and T003 can run in parallel after T001 starts.
- T007 and T008 can run in parallel once T004-T006 are underway.
- In **US1**, T009-T013 are parallel test tasks; T014-T019 can be split by endpoint and client state handling once T006 is done.
- In **US2**, T020-T024 are parallel test tasks; T025-T027 can be split between backend endpoints while T028-T030 proceed on the browser side after the backend contract is stable.
- In **US3**, T031-T033 are parallel tests; T034-T036 can be split between shared logging, load-failure handling, and endpoint diagnostics.
- T037-T039 can run in parallel in the Polish phase.

---

## Parallel Example: User Story 1

```bash
# Launch the US1 integration/API E2E coverage together
Task: "T009 [US1] Update /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-move.test.ts"
Task: "T010 [US1] Update /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-search.test.ts"
Task: "T011 [US1] Update /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-ask.test.ts"
Task: "T013 [US1] Update /Users/dinohughes/Projects/my2/w1/tests/api/e2e/game-flow.test.ts"

# Split endpoint implementations after shared helpers land
Task: "T014 [US1] Refactor /Users/dinohughes/Projects/my2/w1/supabase/functions/game-move/index.ts"
Task: "T015 [US1] Refactor /Users/dinohughes/Projects/my2/w1/supabase/functions/game-search/index.ts"
Task: "T016 [US1] Refactor /Users/dinohughes/Projects/my2/w1/supabase/functions/game-ask/index.ts"
Task: "T019 [US1] Update /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts"
```

---

## Parallel Example: User Story 2

```bash
# Run resume-focused tests in parallel
Task: "T020 [US2] Update /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-start.test.ts"
Task: "T021 [US2] Update /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-get.test.ts"
Task: "T023 [US2] Update /Users/dinohughes/Projects/my2/w1/tests/api/e2e/game-flow.test.ts and /Users/dinohughes/Projects/my2/w1/tests/api/e2e/sessions-flow.test.ts"
Task: "T024 [US2] Update /Users/dinohughes/Projects/my2/w1/web/e2e/narration.test.ts"

# Split backend and frontend implementation
Task: "T025 [US2] Refactor /Users/dinohughes/Projects/my2/w1/supabase/functions/game-start/index.ts"
Task: "T026 [US2] Refactor /Users/dinohughes/Projects/my2/w1/supabase/functions/game-get/index.ts"
Task: "T027 [US2] Refactor /Users/dinohughes/Projects/my2/w1/supabase/functions/game-accuse/index.ts"
Task: "T028 [US2] Update /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts"
```

---

## Parallel Example: User Story 3

```bash
# Drive diagnostics and recovery coverage in parallel
Task: "T031 [US3] Create /Users/dinohughes/Projects/my2/w1/tests/api/unit/narration-events.test.ts"
Task: "T032 [US3] Update /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-ask.test.ts and /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-get.test.ts"
Task: "T033 [US3] Update /Users/dinohughes/Projects/my2/w1/web/e2e/narration.test.ts"

# Split logging and error-handling implementation
Task: "T034 [US3] Update /Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/logging.ts and /Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/narration.ts"
Task: "T035 [US3] Update /Users/dinohughes/Projects/my2/w1/supabase/functions/game-get/index.ts and /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts"
Task: "T036 [US3] Update /Users/dinohughes/Projects/my2/w1/supabase/functions/game-move/index.ts, /Users/dinohughes/Projects/my2/w1/supabase/functions/game-search/index.ts, and /Users/dinohughes/Projects/my2/w1/supabase/functions/game-ask/index.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. Validate the final-turn ordering and non-time-consuming talk flows using T009-T013 and T019.
4. Stop and demo the MVP once US1 passes independently.

### Incremental Delivery

1. Finish Setup + Foundational to establish the narration-part contract and persistence base.
2. Deliver **US1** for fair last-action handling.
3. Deliver **US2** for exact transcript replay and completed-session parity.
4. Deliver **US3** for diagnostics and failure recovery.
5. Finish with Polish and full quality gates.

### Parallel Team Strategy

1. One developer completes T001-T008.
2. After Phase 2:
   - Developer A owns US1 endpoint work.
   - Developer B owns US2 resume/start/get/browser replay work.
   - Developer C owns US3 diagnostics and failure handling.
3. Rejoin for Phase 6 documentation and release validation.

---

## Notes

- [P] tasks touch different files and can be delegated safely once their dependencies are satisfied.
- `[US1]`, `[US2]`, and `[US3]` map directly to the user stories in `/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/spec.md`.
- Each story phase includes the tests needed to prove that story independently.
- Browser tests are reserved for UI-only confidence such as rendered transcript parity, image rendering, and player-facing recovery messaging; ordering and contract checks prefer integration or API E2E coverage.
- The suggested MVP scope is **User Story 1** after completion of the blocking foundational phase.
