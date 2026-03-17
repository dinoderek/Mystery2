# Feature Specification: Action-First Multi-Part Narration

**Feature Branch**: `010-action-first-narration`  
**Created**: 2026-03-16  
**Status**: Draft  
**Input**: User description: "plan/B9-multi-narration.md - replace single-message narration with ordered narration parts and make timeout handling action-first"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve The Last Action (Priority: P1)

As a player, when I spend my final available time on a move, search, or question, I still see the outcome of that action before the game forces me into the accusation phase.

**Why this priority**: This is the core fairness and clarity change. If the last action is swallowed by timeout handling, the player loses trust in the game rules and story continuity.

**Independent Test**: Validate with Unit coverage for narration ordering and time-depletion rules, Integration coverage for persisted event order and resulting game state, and E2E/browser coverage for the last-turn gameplay flow across move, search, and questioning.

**Acceptance Scenarios**:

1. **Given** a player has one remaining turn and performs a move, search, or question, **When** that action uses the final turn, **Then** the player first sees the normal result of the requested action and only afterward sees the forced accusation framing.
2. **Given** a player is questioning a character with one remaining turn, **When** the final question is answered, **Then** the answer is shown before the forced accusation framing and the session is left ready for accusation with no remaining time.
3. **Given** a player starts or ends a conversation, **When** that narration is shown, **Then** the action itself does not reduce remaining time or trigger a forced accusation on its own.

---

### User Story 2 - Resume Exact Narration History (Priority: P2)

As a returning player, I can reopen an in-progress, forced-accusation, or completed session and see the same narration text in the same order that I saw before leaving.

**Why this priority**: Resume accuracy is essential for story coherence. If reopened sessions reconstruct or summarize text differently, players lose continuity and may misunderstand clues or accusation context.

**Independent Test**: Validate with Unit coverage for rendering from stored narration history only, Integration coverage for session start/load outputs and persisted narration history, and E2E/browser coverage for exact text parity before and after resume in mid-game, forced-accusation, and completed sessions.

**Acceptance Scenarios**:

1. **Given** a player leaves a session during the investigation, **When** they reopen it, **Then** the narration area matches the exact pre-exit narration text and speaker order.
2. **Given** a player leaves immediately after a timeout-driven accusation transition, **When** they reopen the session, **Then** the combined action result and forced accusation narration appear exactly as they did before leaving.
3. **Given** a player reopens a completed session, **When** the session is shown in read-only form, **Then** the full narration history remains unchanged and in the same order as when the session ended.

---

### User Story 3 - Diagnose Ordering And Resume Failures (Priority: P3)

As an operator or developer, I need narration ordering and timeout transitions to be recorded clearly enough that I can explain resume defects and action-order bugs without reconstructing hidden state.

**Why this priority**: This feature changes a central gameplay contract. Clear diagnostics are required to debug regressions quickly and to support future story or UI work that depends on stored narration history.

**Independent Test**: Validate with Unit coverage for event classification rules, Integration coverage for persisted event metadata and timeout transition records, and E2E/browser coverage proving that client-only messages remain separate from stored story history.

**Acceptance Scenarios**:

1. **Given** a narration-bearing gameplay action completes, **When** its history is inspected, **Then** the stored event includes its order, category, and all narration parts in the displayed order.
2. **Given** a timeout forces the game into accusation mode, **When** diagnostics are reviewed, **Then** they show which action exhausted time, the order of the stored events, and the resulting session mode.
3. **Given** the player sees local help, validation, or retry guidance, **When** the session is later reopened, **Then** those local-only messages are not mixed into persisted story narration.

## Relevant Documentation & Constraints *(mandatory)*

- `docs/architecture.md`
  Preserve the append-only event log plus session snapshot model, keep authenticated server-side gameplay boundaries intact, and avoid any client-side reconstruction that invents missing story state.
- `docs/game.md`
  Preserve the typed investigation loop, coherent narrator and character voices, and the rule that accusation mode resolves the mystery when time runs out.
- `docs/accusation-flow.md`
  Preserve the reasoning-first accusation lifecycle and the distinct timeout-driven entry into accusation mode, while updating the documented time-cost behavior to match this feature.
- `docs/testing.md`
  This feature requires Unit, Integration, and E2E/browser coverage, plus the full quality-gate run expected for runtime behavior changes.
- `docs/project-structure.md`
  Preserve the separation between shared gameplay contracts, backend session/event handling, and browser rendering/resume flows.
- `docs/backend-conventions.md`
  Public gameplay data shapes remain centrally governed, and cross-boundary error handling must stay explicit and test-covered.

### Edge Cases

- A narration-bearing action produces only one narration part; it still must remain an ordered, speaker-attributed list rather than collapsing back to a single summary message.
- The final time-consuming question in a conversation produces character-spoken narration and then narrator-spoken forced accusation framing in one visible sequence.
- A player resumes a session after timeout has forced accusation mode but before they submit any accusation reasoning.
- A player reopens a completed session whose final narration contains multiple speaker changes and expects read-only text parity.
- Local help, validation, retry, or error messages appear in the browser before or after persisted narration and must not be mistaken for story history on resume.
- Stored narration history cannot be loaded completely; the player must receive a clear recovery message rather than silent omission or invented fallback narration.

## Observability & Diagnostics *(mandatory)*

- The system MUST record, at minimum, the affected session identifier, event order, event category, part count, active gameplay mode, and whether the triggering action consumed time for every persisted narration event.
- Timeout transitions MUST record the action that exhausted time, the remaining time before and after the action, the resulting accusation-ready state, and the stored order of the action result versus forced accusation framing.
- Resume and load failures MUST surface a clear player-facing error with retry guidance and enough server-side context to tie the failure back to the affected session history.
- Documentation updates for this feature MUST include `docs/game.md`, `docs/accusation-flow.md`, and `docs/testing.md`; update any other docs that would otherwise describe outdated narration or timeout behavior.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every gameplay result that includes story text MUST return that text as an ordered list of one or more narration parts, each with explicit speaker attribution.
- **FR-002**: The system MUST not collapse new story text into a single replacement summary for new gameplay responses or newly stored session history.
- **FR-003**: Session start and session resume results MUST separate current gameplay state from persisted narration history.
- **FR-004**: Persisted narration history MUST store event order, event category, and the ordered narration parts shown to the player for each narration-bearing event.
- **FR-005**: Move, search, and in-conversation questions MUST complete their normal narrated outcome before remaining time is reduced.
- **FR-006**: If a time-consuming action reduces remaining time to zero, the system MUST persist and return the action result before appending forced accusation framing.
- **FR-007**: A timeout-driven accusation transition MUST leave the session ready for accusation with zero remaining time and no active conversation context.
- **FR-008**: Conversation start and conversation end MUST remain narration-bearing actions but MUST NOT consume time on their own.
- **FR-009**: Entering accusation mode directly MUST remain free whether it is initiated by the player or triggered by time depletion.
- **FR-010**: Session resume MUST rebuild displayed narration solely from persisted narration history and stored speaker order, without inventing fallback story text.
- **FR-011**: Mid-game, forced-accusation, and completed sessions MUST preserve exact narration text and order when reopened.
- **FR-012**: Client-only help, validation, retry, and local error messages MUST remain excluded from persisted narration history.
- **FR-013**: When persisted narration history cannot be loaded or rendered completely, the system MUST show the player a clear recovery message instead of silently degrading the story transcript.
- **FR-014**: The system MUST capture diagnostic records for narration ordering and timeout transitions with enough context to trace the affected session and action.
- **FR-015**: Documentation and automated test coverage MUST be updated in the same change to reflect the new narration structure, timeout behavior, and resume expectations.

### Key Entities *(include if feature involves data)*

- **Narration Part**: One ordered piece of player-visible story text paired with its speaker identity.
- **Narration Event**: A persisted story event that groups one or more narration parts together with its event order and event category.
- **Gameplay State Snapshot**: The current playable state of a session, such as mode, remaining time, and conversation state, without duplicating story transcript text.
- **Forced Accusation Transition**: The state change that occurs when a time-consuming action exhausts the final remaining time and immediately appends accusation framing after the action result.

### Assumptions

- Existing sessions and clients can be reset before release; backward compatibility for older narration shapes is not required.
- Only move, search, and in-conversation questions are time-consuming for this feature; conversation entry, conversation exit, and accusation entry remain free.
- Resume correctness is judged by exact rendered narration text parity, not by approximate equivalence.
- Local browser-only guidance remains transient and separate from the persisted story transcript.

### Dependencies

- Coordinated updates across story response rules, persisted session history, and browser resume rendering.
- Agreement that pre-release data reset is the migration strategy for older session history.
- Updated documentation and quality-gate execution for all affected gameplay surfaces before release.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In automated coverage, 100% of narration-bearing gameplay results return one or more ordered narration parts with explicit speaker attribution.
- **SC-002**: In automated timeout coverage for final-turn move, search, and in-conversation question flows, 100% of cases persist and return the action result before forced accusation framing and end with zero remaining time in accusation mode.
- **SC-003**: In browser acceptance coverage, 100% of tested mid-game, forced-accusation, and completed resume scenarios reproduce identical narration-area text before and after resume.
- **SC-004**: In automated coverage, 100% of conversation-start and conversation-end scenarios leave remaining time unchanged.
- **SC-005**: In simulated narration-history failure scenarios, 100% of affected sessions show a player-facing recovery message with retry guidance.
- **SC-006**: In release verification, 100% of tested timeout incidents can be explained from recorded session diagnostics without reconstructing missing narration or hidden state by hand.
