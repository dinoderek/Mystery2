# Tasks: Actor-Aware Message Rendering

**Input**: Design documents from `/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/`
**Prerequisites**: `/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/plan.md`, `/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/spec.md`, `/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/research.md`, `/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/data-model.md`, `/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/contracts/actor-aware-messaging.openapi.yaml`

**Tests**: Unit, Integration, API E2E, and browser E2E coverage are required by the feature spec and must be included per story.

**Organization**: Tasks are grouped by user story so each story can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (`[US1]`, `[US2]`, `[US3]`) for story-phase tasks only
- Every task includes an exact file path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create feature scaffolding and shared utilities used by all stories.

- [X] T001 Create backend speaker helper module scaffold in /Users/dinohughes/Projects/my2/w3/supabase/functions/_shared/speaker.ts
- [X] T002 Create frontend speaker mapping utility scaffold in /Users/dinohughes/Projects/my2/w3/web/src/lib/domain/speaker.ts
- [X] T003 [P] Add feature test scaffold file for speaker store behavior in /Users/dinohughes/Projects/my2/w3/web/src/lib/domain/store.speaker.test.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Complete contract and model changes that block all user stories.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [X] T004 Extend shared API schemas with `Speaker`, narration speaker fields, and speaker-enriched history in /Users/dinohughes/Projects/my2/w3/packages/shared/src/mystery-api-contracts.ts
- [X] T005 [P] Update shared contract unit coverage for speaker schema requirements in /Users/dinohughes/Projects/my2/w3/tests/api/unit/mystery-api-contracts.test.ts
- [X] T006 [P] Add canonical backend speaker builders/constants in /Users/dinohughes/Projects/my2/w3/supabase/functions/_shared/speaker.ts
- [X] T007 [P] Update frontend game-state types for `speaker`, `narration_speaker`, and history speaker entries in /Users/dinohughes/Projects/my2/w3/web/src/lib/types/game.ts
- [X] T008 Align store message model interfaces with speaker-aware contracts in /Users/dinohughes/Projects/my2/w3/web/src/lib/domain/store.svelte.ts

**Checkpoint**: Shared contracts/types/helpers are complete; user story implementation can proceed.

---

## Phase 3: User Story 1 - Identify Every Speaker (Priority: P1) 🎯 MVP

**Goal**: Ensure every displayed message line shows the correct actor label across gameplay actions.

**Independent Test**: Start a game, run move/search/talk/ask/end-talk/accuse actions, and verify rendered labels are `You`, `Narrator`, active character, or `System` as specified.

### Tests for User Story 1

- [X] T009 [P] [US1] Add integration assertions for narrator speaker mapping on start/move/search responses in /Users/dinohughes/Projects/my2/w3/tests/api/integration/game-start.test.ts and /Users/dinohughes/Projects/my2/w3/tests/api/integration/game-move.test.ts and /Users/dinohughes/Projects/my2/w3/tests/api/integration/game-search.test.ts
- [X] T010 [P] [US1] Add integration assertions for talk/ask/end-talk/accuse speaker mappings in /Users/dinohughes/Projects/my2/w3/tests/api/integration/game-talk.test.ts and /Users/dinohughes/Projects/my2/w3/tests/api/integration/game-ask.test.ts and /Users/dinohughes/Projects/my2/w3/tests/api/integration/game-end-talk.test.ts and /Users/dinohughes/Projects/my2/w3/tests/api/integration/game-accuse.test.ts
- [X] T011 [P] [US1] Add browser actor-label assertions for gameplay stream lines in /Users/dinohughes/Projects/my2/w3/web/e2e/input.test.ts and /Users/dinohughes/Projects/my2/w3/web/e2e/narration.test.ts

### Implementation for User Story 1

- [X] T012 [P] [US1] Apply narrator speaker assignment for start/move/search responses in /Users/dinohughes/Projects/my2/w3/supabase/functions/game-start/index.ts and /Users/dinohughes/Projects/my2/w3/supabase/functions/game-move/index.ts and /Users/dinohughes/Projects/my2/w3/supabase/functions/game-search/index.ts
- [X] T013 [P] [US1] Apply talk and accuse speaker rules (talk start/end as narrator, ask as character, accuse as narrator) in /Users/dinohughes/Projects/my2/w3/supabase/functions/game-talk/index.ts and /Users/dinohughes/Projects/my2/w3/supabase/functions/game-ask/index.ts and /Users/dinohughes/Projects/my2/w3/supabase/functions/game-end-talk/index.ts and /Users/dinohughes/Projects/my2/w3/supabase/functions/game-accuse/index.ts
- [X] T014 [US1] Render prefixed actor labels and speaker-kind body classes in /Users/dinohughes/Projects/my2/w3/web/src/lib/components/TerminalMessage.svelte
- [X] T015 [US1] Pass speaker metadata through narration rendering pipeline in /Users/dinohughes/Projects/my2/w3/web/src/lib/components/NarrationBox.svelte
- [X] T016 [US1] Update command submission flow to append investigator `You` lines and backend speaker lines in /Users/dinohughes/Projects/my2/w3/web/src/lib/domain/store.svelte.ts

**Checkpoint**: User Story 1 is independently functional and testable as MVP.

---

## Phase 4: User Story 2 - Preserve Speaker Semantics in Session State (Priority: P2)

**Goal**: Ensure speaker metadata is preserved in persisted game state/history and local system feedback is not persisted.

**Independent Test**: Generate mixed gameplay + local system feedback, fetch `game-get`, and confirm returned history/current narration include speaker metadata while local system lines are absent.

### Tests for User Story 2

- [X] T017 [P] [US2] Add integration checks for `state.narration_speaker` and `history[].speaker` in /Users/dinohughes/Projects/my2/w3/tests/api/integration/game-get.test.ts
- [X] T018 [P] [US2] Add full-flow API E2E checks for speaker metadata persistence in /Users/dinohughes/Projects/my2/w3/tests/api/e2e/game-flow.test.ts
- [X] T019 [P] [US2] Add store-level tests for local system feedback remaining non-persisted in /Users/dinohughes/Projects/my2/w3/web/src/lib/domain/store.speaker.test.ts

### Implementation for User Story 2

- [X] T020 [US2] Persist speaker metadata in event payloads for new backend events in /Users/dinohughes/Projects/my2/w3/supabase/functions/game-start/index.ts and /Users/dinohughes/Projects/my2/w3/supabase/functions/game-move/index.ts and /Users/dinohughes/Projects/my2/w3/supabase/functions/game-search/index.ts and /Users/dinohughes/Projects/my2/w3/supabase/functions/game-talk/index.ts and /Users/dinohughes/Projects/my2/w3/supabase/functions/game-ask/index.ts and /Users/dinohughes/Projects/my2/w3/supabase/functions/game-end-talk/index.ts and /Users/dinohughes/Projects/my2/w3/supabase/functions/game-accuse/index.ts
- [X] T021 [US2] Return speaker-enriched persisted state (`narration_speaker`, `history[].speaker`) in /Users/dinohughes/Projects/my2/w3/supabase/functions/game-get/index.ts
- [X] T022 [US2] Keep local help/error/retry feedback UI-only with no backend write path in /Users/dinohughes/Projects/my2/w3/web/src/lib/domain/store.svelte.ts
- [X] T023 [US2] Align frontend state hydration with speaker-enriched `game-get` payloads in /Users/dinohughes/Projects/my2/w3/web/src/lib/types/game.ts and /Users/dinohughes/Projects/my2/w3/web/src/lib/domain/store.svelte.ts

**Checkpoint**: User Story 2 is independently functional and testable.

---

## Phase 5: User Story 3 - Theme-Aware Speaker Styling (Priority: P3)

**Goal**: Apply theme-driven speaker-kind styling with one generic character style across all character speakers.

**Independent Test**: Switch between at least two themes and verify label/body styles remain readable and consistent by speaker kind, with all character speakers sharing one style.

### Tests for User Story 3

- [X] T024 [P] [US3] Add browser E2E coverage for speaker-kind style behavior across theme switches in /Users/dinohughes/Projects/my2/w3/web/e2e/narration.test.ts
- [X] T025 [P] [US3] Add browser E2E checks that all character speakers share one generic style class in /Users/dinohughes/Projects/my2/w3/web/e2e/input.test.ts

### Implementation for User Story 3

- [X] T026 [P] [US3] Add centralized speaker-kind theme class map (including generic character style) in /Users/dinohughes/Projects/my2/w3/web/src/lib/components/terminal-message-theme.ts
- [X] T027 [US3] Wire TerminalMessage to consume theme speaker-kind style mapping for labels and bodies in /Users/dinohughes/Projects/my2/w3/web/src/lib/components/TerminalMessage.svelte
- [X] T028 [US3] Define speaker style tokens for at least two themes in /Users/dinohughes/Projects/my2/w3/web/src/routes/layout.css
- [X] T029 [US3] Expose active theme state/attribute consumed by speaker styling in /Users/dinohughes/Projects/my2/w3/web/src/routes/+layout.svelte and /Users/dinohughes/Projects/my2/w3/web/src/routes/+page.svelte

**Checkpoint**: User Story 3 is independently functional and testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalize docs, run full validation, and ensure cross-story consistency.

- [X] T030 [P] Update gameplay actor semantics documentation in /Users/dinohughes/Projects/my2/w3/docs/game.md
- [X] T031 [P] Update architecture and structure docs for speaker metadata contracts in /Users/dinohughes/Projects/my2/w3/docs/architecture.md and /Users/dinohughes/Projects/my2/w3/docs/project-structure.md
- [X] T032 [P] Update testing expectations and component inventory for actor-aware rendering in /Users/dinohughes/Projects/my2/w3/docs/testing.md and /Users/dinohughes/Projects/my2/w3/docs/component-inventory.md
- [X] T033 Run full quality gates via scripts in /Users/dinohughes/Projects/my2/w3/package.json using `npm run test:all`
- [X] T034 Run quickstart validation flow and sync any command/path updates in /Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies.
- **Phase 2 (Foundational)**: Depends on Phase 1 completion.
- **Phase 3 (US1)**: Depends on Phase 2 completion.
- **Phase 4 (US2)**: Depends on Phase 3 completion.
- **Phase 5 (US3)**: Depends on Phase 3 completion; can proceed after US1 if staffed, but scheduled after US2 by priority.
- **Phase 6 (Polish)**: Depends on completion of all user story phases.

### User Story Dependency Graph

```text
Setup -> Foundational -> US1 -> US2 -> US3 -> Polish
```

### Within Each User Story

- Write and run story tests first; verify they fail before implementation.
- Apply backend contract/behavior updates before UI integration updates.
- Complete story checkpoint before moving to next priority story.

### Parallel Opportunities

- Foundational: T005, T006, T007 can run in parallel.
- US1: T009, T010, T011 and T012, T013 can run in parallel pairs.
- US2: T017, T018, T019 can run in parallel.
- US3: T024, T025 and T026 can run in parallel.
- Polish: T030, T031, T032 can run in parallel before T033.

---

## Parallel Example: User Story 1

```bash
# Parallel test creation for US1
Task: T009 tests/api/integration/game-start.test.ts + tests/api/integration/game-move.test.ts + tests/api/integration/game-search.test.ts
Task: T010 tests/api/integration/game-talk.test.ts + tests/api/integration/game-ask.test.ts + tests/api/integration/game-end-talk.test.ts + tests/api/integration/game-accuse.test.ts
Task: T011 web/e2e/input.test.ts + web/e2e/narration.test.ts

# Parallel backend implementation for US1
Task: T012 supabase/functions/game-start/index.ts + supabase/functions/game-move/index.ts + supabase/functions/game-search/index.ts
Task: T013 supabase/functions/game-talk/index.ts + supabase/functions/game-ask/index.ts + supabase/functions/game-end-talk/index.ts + supabase/functions/game-accuse/index.ts
```

## Parallel Example: User Story 2

```bash
# Parallel test creation for US2
Task: T017 tests/api/integration/game-get.test.ts
Task: T018 tests/api/e2e/game-flow.test.ts
Task: T019 web/src/lib/domain/store.speaker.test.ts
```

## Parallel Example: User Story 3

```bash
# Parallel test and style-map work for US3
Task: T024 web/e2e/narration.test.ts
Task: T025 web/e2e/input.test.ts
Task: T026 web/src/lib/components/terminal-message-theme.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. Validate actor labels end-to-end for gameplay actions.
4. Demo/release MVP with clear speaker attribution.

### Incremental Delivery

1. Deliver US1 (core actor labels and mappings).
2. Deliver US2 (persisted state/history speaker semantics and non-persisted local system feedback).
3. Deliver US3 (theme-aware speaker-kind styling with generic character style).
4. Finish with documentation + full quality gates.

### Parallel Team Strategy

1. Team completes Phase 1 and Phase 2 together.
2. Split by story after foundation:
   - Developer A: US1 backend mapping + UI label rendering
   - Developer B: US2 game-get persistence + store non-persistence behavior
   - Developer C: US3 theming/style map
3. Rejoin for Phase 6 polish and full-gate validation.

---

## Notes

- All tasks follow strict checkbox + ID + optional `[P]` + optional `[US#]` format with exact file paths.
- `[US#]` labels are used only in user story phases.
- Story phases remain independently testable at their checkpoints.
