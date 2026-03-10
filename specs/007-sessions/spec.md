# Feature Specification: Sessions Navigation, Resume, and Completed Logs

**Feature Branch**: `[007-sessions]`  
**Created**: 2026-03-10  
**Status**: Draft  
**Input**: User description: "Landing page should support starting a new game, resuming in-progress games, and viewing completed games/logs."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Session-Aware Landing Navigation (Priority: P1)

As a player, I want the landing screen to offer New Game, In-Progress Games, and Completed Games so I can choose the correct flow before entering a session.

**Why this priority**: This is the entrypoint for every journey and unlocks access to both resume and completed-log views.

**Independent Test**: Can be fully tested by an end-to-end browser flow that lands on `/`, verifies option availability/disabled state based on seeded data, and confirms numeric key navigation behavior for enabled options.

**Acceptance Scenarios**:

1. **Given** the player is on landing, **When** the screen renders, **Then** exactly three numbered options are shown: `1) Start a new game`, `2) View in-progress games`, `3) View completed games`.
2. **Given** there are zero in-progress sessions, **When** landing renders, **Then** option 2 is visibly disabled and cannot be selected by numeric input.
3. **Given** there are zero completed sessions, **When** landing renders, **Then** option 3 is visibly disabled and cannot be selected by numeric input.
4. **Given** option 2 or 3 is enabled, **When** the player presses that option number, **Then** the app navigates to the corresponding sessions list view.
5. **Given** option 1 is selected, **When** the player presses `1`, **Then** the app enters the existing new-game blueprint selection flow.

---

### User Story 2 - Resume In-Progress Sessions (Priority: P1)

As a returning player, I want to see my in-progress sessions with key details and resume one by number so I can continue an investigation where I left off.

**Why this priority**: Session resume is the highest-value functional addition and depends on reliable state recovery.

**Independent Test**: Can be fully tested by an end-to-end flow that seeds multiple in-progress sessions, verifies sorted list rendering, resumes a selected session, and validates normal interactive gameplay continues from persisted state.

**Acceptance Scenarios**:

1. **Given** the player opens the in-progress list, **When** sessions exist, **Then** each row shows mystery title, turns left, and last time played.
2. **Given** multiple in-progress sessions exist, **When** the list renders, **Then** sessions are ordered by most recent last-played timestamp first.
3. **Given** an in-progress session is selected by number, **When** resume runs, **Then** the session loads into `/session` with full persisted narration/history/state from backend.
4. **Given** a resumed session is not ended, **When** `/session` loads, **Then** command input remains enabled and normal gameplay actions are accepted.
5. **Given** the player is on in-progress list, **When** they press `b` or use browser back, **Then** navigation returns to landing.

---

### User Story 3 - Browse Completed Sessions and Logs (Priority: P2)

As a player, I want to browse completed sessions and open one to inspect what happened, without being able to continue gameplay actions.

**Why this priority**: Completed-log browsing is valuable for review/replay but is secondary to resuming active games.

**Independent Test**: Can be fully tested by an end-to-end flow that seeds completed sessions, verifies metadata and ordering, opens a completed session, confirms read-only end-state UI, and validates return-to-landing behavior.

**Acceptance Scenarios**:

1. **Given** the player opens completed sessions, **When** sessions exist, **Then** each row shows mystery title, outcome, and last time played.
2. **Given** multiple completed sessions exist, **When** the list renders, **Then** sessions are ordered by most recent last-played timestamp first.
3. **Given** a completed session is selected by number, **When** `/session` loads, **Then** the full session log/history is displayed as persisted.
4. **Given** a completed session is being viewed, **When** the screen is shown, **Then** interaction is read-only and the only progression control is `press any key to go back`.
5. **Given** the player is on completed list, **When** they press `b` or use browser back, **Then** navigation returns to landing.

---

### Edge Cases

- Player has no sessions at all: options 2 and 3 are disabled and list routes show an empty-state message.
- Two sessions share the same `last_played` timestamp: ordering remains deterministic using a documented secondary sort key.
- A session references a blueprint that is no longer available in storage: the session remains visible in lists but opening it is disabled.
- A completed session has missing/legacy outcome data: list displays a fallback outcome label instead of crashing.
- User presses non-numeric keys or out-of-range numbers in any list view: input is ignored and current view remains unchanged.
- User attempts to open another user’s session id directly: backend returns not found/unauthorized behavior under existing auth+RLS rules.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `/` landing experience MUST render a numbered menu with exactly three options: start new game, view in-progress games, and view completed games.
- **FR-002**: Landing option 2 MUST be disabled when the authenticated user has zero in-progress sessions.
- **FR-003**: Landing option 3 MUST be disabled when the authenticated user has zero completed sessions.
- **FR-004**: Disabled landing options MUST NOT trigger navigation when their numeric keys are entered.
- **FR-005**: The system MUST provide a sessions-summary retrieval contract for the authenticated user that supports categorizing sessions into in-progress and completed groups.
- **FR-006**: A session summary MUST include at least: session id, mystery title, last played timestamp, mode, remaining turns, and outcome (nullable where not applicable).
- **FR-007**: In-progress sessions MUST be defined as modes that are not `ended` and completed sessions MUST be defined as mode `ended`.
- **FR-008**: In-progress and completed lists MUST be sorted by last played descending (most recent first).
- **FR-009**: The in-progress list UI MUST display for each session: mystery title, turns left, and last time played.
- **FR-010**: The completed list UI MUST display for each session: mystery title, investigation outcome, and last time played.
- **FR-011**: Selecting an in-progress session by number MUST load persisted state/history via backend and navigate into interactive `/session` gameplay.
- **FR-012**: Selecting a completed session by number MUST load persisted state/history via backend and navigate into `/session` in read-only completed mode.
- **FR-013**: When a loaded session is completed (`mode='ended'`), the `/session` UI MUST block gameplay command input and show the return prompt (`press any key to go back`) as the only forward interaction.
- **FR-014**: In-progress and completed list views MUST support returning to landing via browser back and via keyboard `b`.
- **FR-015**: Session summary and resume/view APIs MUST remain protected by existing authenticated access rules and user-level RLS isolation.
- **FR-016**: Automated tests for this feature MUST include unit, integration, and end-to-end coverage, including explicit resume validation for both in-progress and completed sessions.
- **FR-017**: Documentation MUST be updated during implementation to reflect any new routes, components, and test coverage additions across `docs/screen-navigation.md`, `docs/component-inventory.md`, and `docs/testing.md` as applicable.

### Key Entities *(include if feature involves data)*

- **Session Summary**: Lightweight record for list rendering with category (`in_progress`/`completed`), mystery title, turns left, outcome, and last played timestamp.
- **Session Category View**: UI state for one list mode (in-progress or completed) including summaries, empty state, disabled-state handling, and numeric selection mapping.
- **Session Viewer Mode**: Session page rendering mode determined from persisted session state (`interactive` for non-ended, `read_only_completed` for ended).

### Assumptions

- `game_sessions.updated_at` is the canonical source for "last time played."
- Completed investigations are represented by `game_sessions.mode='ended'`.
- Outcome values are currently `win` or `lose`; legacy null outcomes may exist and require fallback display text.
- Existing `game-get` state payload is the source of truth for rendering replay logs.
- This feature does not add session deletion, renaming, or filtering beyond in-progress/completed categories.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In browser E2E coverage, landing menu options correctly enable/disable based on seeded session counts with 100% pass rate.
- **SC-002**: In integration coverage, session-summary retrieval returns only the authenticated user’s sessions with correct category assignment and descending last-played order.
- **SC-003**: In E2E coverage, selecting an in-progress session restores persisted session state and allows at least one additional successful gameplay command.
- **SC-004**: In E2E coverage, selecting a completed session renders persisted history and enforces read-only return-to-list behavior with no accepted gameplay commands.
- **SC-005**: In release acceptance checks, users can return from both session-list views and completed-session viewer to landing via keyboard/back navigation without dead ends.
