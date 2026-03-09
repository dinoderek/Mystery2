# Feature Specification: Actor-Aware Message Rendering

**Feature Branch**: `[006-actor-aware-messaging]`  
**Created**: 2026-03-09  
**Status**: Draft  
**Input**: User description: "Actor-aware message rendering across UI and API with explicit speaker metadata, theme-aware style hooks, narrator overrides for conversation start/end, and narrator-only accusation narration for now."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Identify Every Speaker (Priority: P1)

As a player, I want every message in the terminal stream to show who is speaking so I can follow the story and trust what each line represents.

**Why this priority**: Message attribution is core gameplay clarity; without it, players cannot reliably distinguish their own input, narration, dialogue, and system feedback.

**Independent Test**: Can be fully tested by an end-to-end session that includes player input, movement, conversation, search, accusation, help/error handling, and verifies each rendered message has the correct actor label.

**Acceptance Scenarios**:

1. **Given** an active game, **When** the player submits a command, **Then** the new player input line is labeled `You`.
2. **Given** a standard gameplay action (start game, move, search, accuse), **When** narration is returned, **Then** the line is labeled `Narrator`.
3. **Given** a talk-mode question, **When** the game returns the answer, **Then** the line is labeled with the active character name.
4. **Given** a conversation start or conversation end action, **When** narration is returned, **Then** the line is labeled `Narrator`.
5. **Given** accusation rounds are in progress, **When** follow-up or verdict narration is returned, **Then** the line is labeled `Narrator` for this release.

---

### User Story 2 - Preserve Speaker Semantics in Session State (Priority: P2)

As a returning player, I want loaded game state and history to include explicit speaker metadata so previously shown text is still attributed correctly after refresh or resume.

**Why this priority**: Correct attribution must persist beyond a single response; history without speaker metadata breaks continuity and trust.

**Independent Test**: Can be fully tested by creating a game session, generating multiple message types, reloading the session state, and verifying all history entries and current narration retain correct speaker metadata in API and UI.

**Acceptance Scenarios**:

1. **Given** a game with existing history, **When** session state is retrieved, **Then** every history entry includes explicit speaker metadata.
2. **Given** a game with current top-level narration, **When** session state is retrieved, **Then** the current narration includes explicit speaker metadata.
3. **Given** local help/error/retry feedback is shown to the player, **When** session state is later retrieved, **Then** those local system lines are not present in persisted backend history.

---

### User Story 3 - Theme-Aware Speaker Styling (Priority: P3)

As a player, I want actor labels and message text to follow the active theme so readability and visual meaning remain consistent across themes.

**Why this priority**: The project now supports theming; speaker differentiation must integrate with theme behavior rather than hard-coded one-off colors.

**Independent Test**: Can be fully tested by an end-to-end run that switches themes and verifies speaker-specific label/body styling remains distinct, readable, and stable for all speaker kinds.

**Acceptance Scenarios**:

1. **Given** an active theme, **When** messages are rendered, **Then** label and body styling for each speaker kind uses that theme’s style mapping.
2. **Given** any character speaker, **When** the message renders, **Then** it uses the shared generic character style for the active theme.
3. **Given** the active theme changes, **When** existing messages remain on screen and new messages arrive, **Then** speaker-kind styling remains consistent and readable.

---

### Edge Cases

- A local help/error/retry line is generated while the player is in talk mode.
- A character display name includes spaces, punctuation, or mixed case.
- Multiple different character speakers appear in sequence and must still use the same generic character style.
- Accusation flow eventually introduces a judge-character voice in future work, but current release still emits narrator-labeled accusation narration.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every player-visible message block MUST include structured speaker metadata with: speaker kind, stable speaker key, and display label.
- **FR-002**: Every gameplay response that returns narration MUST include speaker metadata for that narration.
- **FR-003**: Game session state MUST include speaker metadata for the current narration and each history entry.
- **FR-004**: Player-entered input lines rendered in the UI MUST always use investigator speaker metadata with display label `You`.
- **FR-005**: Locally generated help, error, and retry lines MUST always use system speaker metadata with display label `System`.
- **FR-006**: Narration for start game, move, search, and accuse actions MUST use narrator speaker metadata with display label `Narrator`.
- **FR-007**: Talk-mode question responses MUST use character speaker metadata with the active character’s display label.
- **FR-008**: Conversation start and conversation end narration MUST use narrator speaker metadata.
- **FR-009**: Accusation start, follow-up rounds, and verdict narration MUST use narrator speaker metadata for this release.
- **FR-010**: The terminal renderer MUST display the actor label before message body text for every message block.
- **FR-011**: Speaker presentation MUST support theme-aware styling for both label and body text using speaker-kind mappings, including one shared generic style for all character speakers.
- **FR-012**: Client-generated system messages (help, validation feedback, retry notices, and local errors) MUST use system styling in the UI and MUST NOT be persisted into backend history.
- **FR-013**: This feature MUST not require backward compatibility with older message response formats or previously saved session formats.
- **FR-014**: Documentation MUST be updated to reflect actor-aware messaging behavior in gameplay semantics, architecture contracts, testing expectations, project structure notes, and component inventory behavior.
- **FR-015**: Quality-gate test coverage MUST include unit, integration, and end-to-end assertions for speaker attribution, narrator overrides for conversation start/end, narrator attribution in accusation rounds, and theme-aware style mapping behavior.
- **FR-016**: Blueprint-driven actor color assignment and judge-character accusation speaker behavior are explicitly out of scope for this release.

### Key Entities *(include if feature involves data)*

- **Speaker**: Describes who a message comes from using speaker kind, stable key, and user-facing label.
- **Message Block**: A single rendered line/block in the terminal stream containing text plus speaker metadata.
- **Session Narration State**: Current narration plus historical message entries, each with speaker attribution.
- **Theme Speaker Style Map**: Theme-level style definitions for speaker kinds, including one generic style shared by all character speakers.

### Assumptions

- Existing sessions and older response payloads do not need compatibility support after this feature is released.
- Theme infrastructure already exists and can provide the active theme at render time.
- All character messages share a single character style per theme for this release.
- Accusation messaging remains narrator-labeled for now even though future design may introduce a distinct judge-character voice.
- Per-blueprint actor color definitions are deferred to a later feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In end-to-end gameplay coverage, 100% of rendered message blocks display a non-empty actor label.
- **SC-002**: In integration coverage for all gameplay actions, 100% of narration payloads and returned history entries include valid speaker metadata.
- **SC-003**: In automated attribution checks, 100% of tested actions map to the expected speaker label (`You`, `Narrator`, active character, `System`) including narrator overrides for conversation start/end and accusation rounds.
- **SC-004**: Across at least two supported themes, actor labels and body text remain visually distinguishable for every speaker kind with zero critical readability defects in release acceptance testing.
- **SC-005**: In structured playtest feedback, at least 90% of participants correctly identify who is speaking in sampled message sequences without extra explanation.
