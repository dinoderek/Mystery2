# Feature Specification: Web UI

**Feature Branch**: `002-web-ui`  
**Created**: 2026-03-05  
**Status**: Draft  
**Input**: User description: "the web ui, see plan/B2-webui.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Web UI Initialization & Blueprint Selection (Priority: P1)

Users access the Web UI and select a game blueprint to start playing.

**Why this priority**: Essential for entering the game. Without selecting a blueprint, no game session can exist.

**Independent Test**: End-to-End (E2E) testing is MANDATORY. Can be fully tested by verifying that the list of blueprints loads on the Start Screen, the user can select one using numeric keyboard keys, and the application transitions to the Game Session screen.

**Acceptance Scenarios**:

1. **Given** the Web UI is loaded, **When** the Start Screen appears, **Then** a list of available blueprints is displayed.
2. **Given** the blueprint list is visible, **When** the user types the number corresponding to a blueprint, **Then** the game session initializes with that blueprint.

---

### User Story 2 - Game Session Narration & Status (Priority: P1)

Users view the ongoing game state, reading what is happening in the world through a scrolling narration box and monitoring their current status.

**Why this priority**: Core game loop visibility. Users must be able to read what's happening to play.

**Independent Test**: End-to-End (E2E) testing is MANDATORY. Can be fully tested by simulating game state updates and verifying that new narration fragments render in styled boxes, the narration area auto-scrolls, and the status bar correctly displays the location, characters, turns, and hints.

**Acceptance Scenarios**:

1. **Given** a new narration fragment is received, **When** it is rendered, **Then** it appears below previous fragments in a styled box.
2. **Given** multiple fragments exceed the box height, **When** a new fragment arrives, **Then** the box auto-scrolls to the bottom.
3. **Given** the backend is processing an action, **When** waiting for a response, **Then** a text-based loading indicator is displayed.
4. **Given** the narration box is focused, **When** the user presses the up or down arrow keys, **Then** the narration box scrolls manually.

---

### User Story 3 - Keyboard Command Input (Priority: P1)

Users interact with the game by typing commands in the contextual input box.

**Why this priority**: Core interaction mechanism. Users must be able to send actions to the game loop.

**Independent Test**: End-to-End (E2E) testing is MANDATORY. Can be fully tested by verifying that the input box displays the correct hints per mode (Normal, Talking, Accusation) and that typed commands are submitted upon pressing Enter.

**Acceptance Scenarios**:

1. **Given** the game is in Normal mode, **When** the input box is focused, **Then** it displays the hint "what do you want to do next? Move, Search, Talk...".
2. **Given** the game mode changes to Talking or Accusation, **When** the input box is updated, **Then** it displays context-sensitive hints ("what do you want to say to X?" or "who do you want to accuse?").
3. **Given** the user types a relevant command, **When** the user presses Enter, **Then** the command is submitted and the UI visualizes a pending state.

---

### User Story 4 - Help Modal (Priority: P2)

Users request help to understand available commands during the game session.

**Why this priority**: Important for user experience and discoverability, but secondary to the core game loop.

**Independent Test**: End-to-End (E2E) testing is MANDATORY. Can be fully tested by triggering the `Help` command and verifying the modal appears and contains command examples.

**Acceptance Scenarios**:

1. **Given** the user is on the game session screen, **When** they type the help command, **Then** a terminal-style modal appears showing available commands and examples.

### Edge Cases

- **What happens when a narration fragment is excessively long?** The box will expand vertically to accommodate the text.
- **How does system handle rapid, consecutive command inputs while the backend is still loading?** While a command is processing, the input box is disabled to prevent multiple submissions.
- **What happens when the browser window is resized during an active game session?** The UI resizes and reflows its elements to fit the new dimensions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a web-based UI with a terminal-like aesthetic using simple boxes, text, colors, and accents.
- **FR-002**: System MUST be entirely controllable via keyboard input.
- **FR-003**: System MUST support responsive design for various screen sizes including mobile devices.
- **FR-004**: System MUST present a Start Screen for blueprint selection via numeric keyboard input.
- **FR-005**: System MUST present a Game Session Screen divided horizontally into Header, Narration Box, Status Bar, and Input Box.
- **FR-006**: System MUST render narration fragments individually in their respective boxes.
- **FR-007**: System MUST auto-scroll the Narration Box to the bottom when new fragments are added.
- **FR-008**: System MUST allow manual vertical scrolling of the Narration Box via arrow keys.
- **FR-009**: System MUST display text-based loading indicators (e.g., ascii spinner) while waiting for backend responses.
- **FR-010**: System MUST update the Status Bar with current location, characters present, turns remaining, and relevant hints.
- **FR-011**: System MUST provide mode-specific contextual hints in the Input Box for Normal, Talking, and Accusation modes.
- **FR-012**: System MUST display a terminal-styled Help modal with commands and examples when requested.
- **FR-013**: System MUST NOT include functionality for listing historical/running sessions or user accounts.

### Key Entities

- **Blueprint**: Represents an available game scenario that can be selected from the Start Screen.
- **Narration Fragment**: A single piece of dialogue or description containing the text content. Actor/character attribution is out of scope.
- **Game State**: The current status of the game session including mode, location, characters, turns left, and history.

## Out of Scope

- Displaying character or actor names on narration fragments (the current API does not provide granular actor names).
- Listing running or historical game sessions.
- User accounts and authentication.

## Assumptions

- Users have a keyboard available for input, even on mobile devices.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can successfully start a game by selecting a blueprint entirely via keyboard navigation.
- **SC-002**: 100% of core game loop actions (move, search, talk, accuse) can be initiated and executed exclusively via keyboard commands.
- **SC-003**: The UI layout remains functional and elements do not overlap on screen widths down to 320px.
- **SC-004**: Loading indicators appear within 200ms of any action submission that results in a network request.
- **SC-005**: The Narration box automatically scrolls such that the newest message is fully visible 100% of the time upon receiving a new fragment.
