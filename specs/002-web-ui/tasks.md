---
description: "Task list for Web UI feature implementation"
---

# Tasks: Web UI

**Input**: Design documents from `/specs/002-web-ui/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, quickstart.md

**Tests**: End-to-End (E2E) testing with Playwright is MANDATORY for all features.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create SvelteKit project at `web/` using `sv create web` (minimal TS template)
- [ ] T002 Install Tailwind CSS and configure Vite + Tailwind in `web/`
- [ ] T003 Initialize Playwright for E2E testing in `web/` (`npm init playwright@latest`)
- [ ] T004 Install `@supabase/supabase-js` in `web/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Create Supabase client utility in `web/src/lib/api/supabase.ts`
- [ ] T006 Define shared `GameState` interface in `web/src/lib/types/game.ts` (matching API contract)
- [ ] T007 Implement the `GameSessionStore` using Svelte runes in `web/src/lib/domain/store.svelte.ts`
- [ ] T008 Update `package.json` in `web/` to hook into monorepo root test scripts if needed.

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Web UI Initialization & Blueprint Selection (Priority: P1) 🎯 MVP

**Goal**: Users access the Web UI and select a game blueprint to start playing using numeric keyboard keys.

**Independent Test**: Can be fully tested by verifying that the list of blueprints loads on the Start Screen, the user can select one using numeric keyboard keys, and the application transitions to the Game Session screen.

### Tests for User Story 1 (MANDATORY) ⚠️

- [ ] T009 [P] [US1] E2E test for blueprint selection in `web/e2e/start.test.ts`

### Implementation for User Story 1

- [ ] T010 [P] [US1] Implement `loadBlueprints` action in `web/src/lib/domain/store.svelte.ts`
- [ ] T011 [P] [US1] Implement `startGame` action in `web/src/lib/domain/store.svelte.ts`
- [ ] T012 [US1] Create Start Screen component in `web/src/routes/+page.svelte` (fetches prints, handles numeric keydown)
- [ ] T013 [US1] Create Game Session layout skeleton in `web/src/routes/session/+page.svelte` that Start Screen redirects to on success.

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Game Session Narration & Status (Priority: P1)

**Goal**: Users view the ongoing game state, reading what is happening in the world through a scrolling narration box and monitoring their current status.

**Independent Test**: Can be fully tested by simulating game state updates and verifying that new narration fragments render in styled boxes, the narration area auto-scrolls, and the status bar correctly displays the location, characters, turns, and hints.

### Tests for User Story 2 (MANDATORY) ⚠️

- [ ] T014 [P] [US2] E2E test for narration rendering and auto-scrolling in `web/e2e/narration.test.ts`
- [ ] T015 [P] [US2] E2E test for status bar updates in `web/e2e/status.test.ts`

### Implementation for User Story 2

- [ ] T016 [P] [US2] Create Header component in `web/src/lib/components/Header.svelte`
- [ ] T017 [P] [US2] Create Status Bar component in `web/src/lib/components/StatusBar.svelte`
- [ ] T018 [P] [US2] Create Narration Box component in `web/src/lib/components/NarrationBox.svelte` (must auto-scroll and handle arrow keys)
- [ ] T019 [P] [US2] Create Narration Fragment (TerminalMessage) component in `web/src/lib/components/TerminalMessage.svelte`
- [ ] T020 [US2] Integrate components into `web/src/routes/session/+page.svelte`, connecting them to `GameSessionStore`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Keyboard Command Input (Priority: P1)

**Goal**: Users interact with the game by typing commands in the contextual input box.

**Independent Test**: Can be fully tested by verifying that the input box displays the correct hints per mode (Normal, Talking, Accusation) and that typed commands are submitted upon pressing Enter.

### Tests for User Story 3 (MANDATORY) ⚠️

- [ ] T021 [P] [US3] E2E test for command input submission and hints in `web/e2e/input.test.ts`

### Implementation for User Story 3

- [ ] T022 [P] [US3] Add command actions (`move`, `search`, `talk`, `ask`, `accuse`) to `GameSessionStore` in `web/src/lib/domain/store.svelte.ts`
- [ ] T023 [P] [US3] Create Input Box component in `web/src/lib/components/InputBox.svelte` (handles mode-specific placeholders, Enter to submit, disabled state)
- [ ] T024 [P] [US3] Create action parser utility in `web/src/lib/domain/parser.ts` to map text strings like "move to garden" to store actions.
- [ ] T025 [US3] Integrate Input Box into `web/src/routes/session/+page.svelte`

**Checkpoint**: Core game loop is fully functional

---

## Phase 6: User Story 4 - Help Modal (Priority: P2)

**Goal**: Users request help to understand available commands during the game session.

**Independent Test**: Can be fully tested by triggering the `Help` command and verifying the modal appears and contains command examples.

### Tests for User Story 4 (MANDATORY) ⚠️

- [ ] T026 [P] [US4] E2E test for help modal toggling in `web/e2e/help.test.ts`

### Implementation for User Story 4

- [ ] T027 [P] [US4] Create Help Modal component in `web/src/lib/components/HelpModal.svelte`
- [ ] T028 [US4] Update action parser in `web/src/lib/domain/parser.ts` to recognize 'help' command.
- [ ] T029 [US4] Integrate Help Modal into `web/src/routes/session/+page.svelte`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T030 Update `docs/architecture.md` to reflect `web/` instead of `apps/web/`
- [ ] T031 Update `docs/project-structure.md` to reflect the new `web/` root directory
- [ ] T032 Update `docs/testing.md` to include UI testing strategies and paths
- [ ] T033 Update UX and design docs (`docs/component-inventory.md`, `docs/screen-navigation.md`, `docs/styling-conventions.md`, `docs/game.md`) to reflect accurate structure and UI components
- [ ] T034 Update `AGENTS.md` to include rules and context for the new `web/` directory
- [ ] T035 Update `QUICKSTART.md` with instructions for starting and testing the SvelteKit frontend
- [ ] T036 Verify if any other documentation files contain outdated `apps/web` or frontend references and update them
- [ ] T037 Clean up global styles in `web/src/app.css` to refine the terminal aesthetic across all components.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Depends on US1 for session state creation, though components can be built in isolation.
- **User Story 3 (P1)**: Can start after Foundational (Phase 2) - Integrates with US2's layout.
- **User Story 4 (P2)**: Depends on Phase 5 (US3) parser and input handling infrastructure.

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- Store logic before components
- Components before layout integration

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, you can build Svelte components in isolation (marked [P]).

---

## Implementation Strategy

### MVP First (User Story 1-3)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3, 4, 5 sequentially to establish the core gameplay loop.
4. **STOP and VALIDATE**: Play the game end-to-end via the UI.
5. Proceed to Phase 6 (Help).
