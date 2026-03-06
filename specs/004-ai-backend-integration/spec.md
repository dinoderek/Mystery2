# Feature Specification: AI Backend Integration for Narrative Turns

**Feature Branch**: `[004-ai-backend-integration]`  
**Created**: 2026-03-06  
**Status**: Draft  
**Input**: User description: "Integrate AI with backend using role-specific prompting, constrained outputs, and dedicated live-AI test coverage based on `plan/B4-AI-integration.md`."

## Clarifications

### Session 2026-03-06

- Q: What solution context can non-accusation AI roles access? → A: Non-accusation roles never receive full ground truth; only accusation-judge gets full solution context after accusation starts.
- Q: How should turns behave on AI timeout/error/invalid output? → A: Client retry should address it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reliable Character Conversations (Priority: P1)

As a player, I want conversations with characters to feel coherent and age-appropriate across starting, ongoing, and ending talk interactions so I can gather clues without breaking immersion.

**Why this priority**: Talk interactions are the core gameplay loop and the strongest driver of engagement, clue discovery, and narrative quality.

**Independent Test**: Can be fully tested by running an end-to-end play session that enters talk mode, asks multiple questions, exits talk mode, and verifies coherent responses, continuity with prior exchanges, and spoiler-safe behavior.

**Acceptance Scenarios**:

1. **Given** an active game and a selected character, **When** the player starts a conversation, **Then** the system returns a short opening exchange aligned with that character and the current location.
2. **Given** an ongoing conversation, **When** the player asks follow-up questions, **Then** replies remain consistent with known character knowledge, prior dialogue, and target age constraints.
3. **Given** an ongoing conversation, **When** the player ends the interaction, **Then** the system returns a short closing exchange that reflects the interaction tone.
4. **Given** a non-accusation phase, **When** the player asks direct spoiler questions, **Then** responses avoid revealing protected solution facts while still staying in-character.

---

### User Story 2 - Search and Accusation Adjudication (Priority: P2)

As a player, I want search and accusation actions to produce clear narrative outcomes so I can progress from clue collection to a fair final judgment.

**Why this priority**: Search and accusation complete the primary mystery-solving journey and determine whether the player can reach a satisfying ending.

**Independent Test**: Can be fully tested by running an end-to-end journey that performs search actions, enters accusation mode, submits reasoning over one or more rounds, and reaches a resolved outcome.

**Acceptance Scenarios**:

1. **Given** an active game and current location, **When** the player performs search, **Then** the system returns narrative feedback plus any discovered findings allowed at that point in the mystery.
2. **Given** a game that transitions to accusation, **When** accusation starts, **Then** the system returns a scene-setting introduction for the final confrontation.
3. **Given** accusation rounds in progress, **When** the player submits reasoning, **Then** the system responds with either a final verdict or targeted follow-up prompts until verdict conditions are met.
4. **Given** a final verdict, **When** outcome is presented, **Then** the explanation is logically consistent with timeline, alibis, motives, and discovered clues.

---

### User Story 3 - Live AI Regression Confidence (Priority: P3)

As a QA owner, I want dedicated live-AI integration and end-to-end tests that run against two execution profiles so I can detect narrative regressions in real provider behavior before release.

**Why this priority**: Mock-based tests cannot fully capture live model behavior; an opt-in live suite provides targeted confidence while controlling cost and brittleness.

**Independent Test**: Can be fully tested by running a dedicated integration and end-to-end live-AI suite on a predefined mystery case and investigator script in both execution profiles, then verifying expected outcomes and pass/fail reporting.

**Acceptance Scenarios**:

1. **Given** the dedicated live-AI test suite, **When** it is executed in the default profile, **Then** the predefined investigator script completes with expected milestones and result checks.
2. **Given** the dedicated live-AI test suite, **When** it is executed in the cost-control profile, **Then** it runs the same script and reports comparable pass/fail signals.
3. **Given** standard quality-gate execution, **When** default tests run, **Then** live-AI tests are excluded unless explicitly requested.

### Edge Cases

- What happens when provider credentials or model selection are missing at runtime?
- How does the system handle malformed or non-conforming AI output for a required response shape?
- What happens if the provider times out or returns an error during talk/search/accusation actions?
- How are player requests handled when they attempt to force solution leakage before accusation resolution?
- What happens if the predefined investigator script reaches the turn limit before accusation is resolved?
- How are unsupported or intentionally wrong player commands represented in live-AI scripted testing?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support secure runtime configuration for AI provider access and model/profile selection without exposing sensitive credentials to players.
- **FR-002**: The system MUST define explicit AI roles for each narrative interaction type, and each role MUST include a fixed role instruction, a bounded input context contract, and a constrained output contract.
- **FR-003**: The system MUST support a three-step talk flow (`talk-start`, `talk-conversation`, `talk-end`) that preserves conversational continuity across turns.
- **FR-004**: The system MUST support search adjudication that returns concise narrative feedback and only permissible findings for the player’s current state.
- **FR-005**: The system MUST support a two-stage accusation flow with (a) accusation setup and (b) iterative judging rounds that can request follow-up reasoning before final resolution.
- **FR-006**: The system MUST enforce context-sharing guardrails so non-accusation roles never receive full solution ground truth, and only the accusation-judge role may receive full solution context after accusation has started.
- **FR-007**: The system MUST validate AI responses against the required output contract before using them in game progression.
- **FR-008**: The system MUST provide user-safe fallback behavior for invalid, empty, or failed AI responses, including clear retriable feedback intended for client-side retry handling and consistent game-state handling.
- **FR-014**: Failed AI attempts MUST not finalize the turn outcome; the turn is only committed after a successful, contract-valid response is applied.
- **FR-009**: The system MUST persist enough structured interaction history to support coherent follow-up responses in later turns of the same game.
- **FR-010**: The product MUST provide dedicated live-AI integration and end-to-end test modes that run a predefined case and investigator script in two execution profiles (default and cost-control).
- **FR-011**: Live-AI tests MUST include intentional off-path player behavior (for example, unsupported commands and discovery/help requests) before completing a plausible case-solving route within allotted turns.
- **FR-012**: Default quality-gate test execution MUST exclude live-AI suites unless explicitly enabled.
- **FR-013**: Project documentation MUST include (a) one in-depth AI runtime document describing role prompts, context boundaries, output contracts, and failure handling, and (b) concise overview updates in existing core docs summarizing what changed and why.

### Key Entities *(include if feature involves data)*

- **AI Role Definition**: Declares one narrative role’s purpose, fixed instruction, allowed input fields, and required output shape.
- **AI Interaction Context**: The structured information passed into one AI role invocation, including game state slice, location/character references, and optional player input.
- **AI Narrative Response**: The validated role output used to render player-visible narration and drive state progression.
- **Accusation Session**: Tracks accusation start state, round-by-round player reasoning inputs, and final verdict outcome.
- **Investigator Script Case**: Defines a deterministic case and scripted player command sequence used in live-AI regression runs.
- **AI Execution Profile**: Identifies a configured runtime profile used by live tests (default profile and cost-control profile).

### Assumptions

- The feature targets one active investigator per game session.
- The existing mystery rules for timeline, alibis, motive, and clue consistency remain authoritative.
- If AI output cannot be safely accepted, the turn is not silently auto-resolved; the player receives explicit feedback.
- Live-AI tests are opt-in and executed separately from default always-on quality gates.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 95% of scripted live-AI turns produce contract-valid narrative output on the first provider response.
- **SC-002**: In scripted non-accusation runs, 100% of protected solution facts remain unrevealed before permitted reveal phases.
- **SC-003**: The predefined investigator script reaches a resolved case outcome within the allotted turn budget in at least 90% of runs for each execution profile.
- **SC-004**: Both live execution profiles complete the full dedicated integration and end-to-end suite with published pass/fail results in under 20 minutes median runtime per profile.
- **SC-005**: In structured playtest evaluation, at least 85% of participants rate conversation coherence and engagement at 4/5 or higher.
