# Feature Specification: Web UI Command Parser

**Feature Branch**: `003-webui-command-parser`  
**Created**: 2026-03-06  
**Status**: Draft  
**Input**: User description: "We want to improve the command parser in the Web UI."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Intelligent Command Recognition with Aliases (Priority: P1)

A player types any game command using natural language variations, and the game correctly interprets all recognized aliases as the corresponding command. This applies across all command types: movement, conversation, searching, ending conversations, and system commands.

**Why this priority**: Without reliable command recognition, no other interaction is possible. Aliases reduce friction and allow players to express commands naturally, which is the most fundamental interaction in the game.

**Independent Test**: Can be fully tested by entering various alias forms of each command type and verifying they all resolve to the correct action. Each command category can be tested independently.

**Acceptance Scenarios**:

1. **Given** the player is in explore mode, **When** they type "travel to the kitchen", **Then** the command is recognized as a movement command to "the kitchen"
2. **Given** the player is in explore mode, **When** they type "head towards the barn", **Then** the command is recognized as a movement command to "barn"
3. **Given** the player is in explore mode, **When** they type "speak with Mayor Fox", **Then** the command is recognized as a talk command targeting "Mayor Fox"
4. **Given** the player is in explore mode, **When** they type "inspect the room" or "look around", **Then** the command is recognized as a search command
5. **Given** the player is in talk mode, **When** they type "goodbye" or "see you", **Then** the command is recognized as end-conversation
6. **Given** the player is in any mode, **When** they type "quit" or "exit", **Then** the command is recognized as the quit system command
7. **Given** the player types an unrecognized phrase like "wander to market", **Then** the command is treated as unrecognized and the player sees the mode-specific list of valid commands
8. **Given** the player is in talk mode, **When** they type a movement alias, **Then** the parser recognizes they are in talk mode and the input is treated as a conversational question, not a movement command

---

### User Story 2 - Target Validation with Helpful Feedback (Priority: P1)

A player types a command that requires a target (e.g., "talk to Mayor Fox"), and the UI validates whether the named target is a known character or location. If the target is missing or invalid, the player immediately sees a helpful list of valid targets without the request ever reaching the game server. Additionally, players can type shorthand commands like "locations" or "characters" to browse available targets at any time.

**Why this priority**: Sending invalid or incomplete commands to the backend wastes a round-trip and degrades the experience. Inline validation and browsability replace unhelpful server errors with clear, actionable guidance.

**Independent Test**: Can be fully tested with a fixed set of characters and locations by entering valid, invalid, and missing targets for each command type, and by using the list commands, verifying all cases respond correctly without backend calls.

**Acceptance Scenarios**:

1. **Given** the player types "talk to Rosie" and "Rosie" is a known character name (first or last), **When** the command is submitted, **Then** it is sent to the backend without error
2. **Given** the player types "talk to Zyx" and no character matches "Zyx", **When** the command is submitted, **Then** no backend call is made and the player sees a list of talkable characters
3. **Given** the player types "talk to" with no name following, **When** the command is submitted, **Then** no backend call is made and the player sees the list of talkable characters
4. **Given** the player types "go" with no destination, **When** the command is submitted, **Then** no backend call is made and the player sees the list of valid movement targets
5. **Given** the player types "go to garden" and "garden" matches a known location, **When** the command is submitted, **Then** it is sent to the backend
6. **Given** the player types "go to zyx" and no location matches "zyx", **When** the command is submitted, **Then** no backend call is made and the player sees a list of valid movement targets including both locations and characters currently at the player's location
7. **Given** the player types "accuse Rosie" and "Rosie" is a known character, **When** the command is submitted in accuse mode, **Then** it is sent to the backend
8. **Given** the player enters a command with an invalid target and is shown valid targets, **When** they select or type one of the suggestions, **Then** the corrected command is submitted successfully
9. **Given** the player types "locations" or "where can I go" in explore mode, **When** submitted, **Then** the UI displays the list of available locations along with the characters present at each
10. **Given** the player types "characters" or "who is here" in explore mode, **When** submitted, **Then** the UI displays the list of characters currently present in the scene

---

### User Story 3 - Unrecognized Command Guidance (Priority: P2)

When a player types something that doesn't match any known command pattern, the UI displays a brief, inline list of valid commands for the current mode and reminds the player they can type "help" for more detail. Typing "help" shows the full, extended help content.

**Why this priority**: Players need to know what commands are available. An unrecognized input that silently fails or shows a cryptic error creates confusion. Keeping inline feedback brief avoids overwhelming the player while still pointing them toward extended help.

**Independent Test**: Can be fully tested by entering arbitrary unrecognized text in each game mode and verifying the correct brief command list appears, and then verifying that typing "help" shows the extended help content.

**Acceptance Scenarios**:

1. **Given** the player is in explore mode, **When** they type "jump over fence", **Then** they see a short inline list of valid explore-mode commands (e.g., "go, talk, search, help, quit") and a note to type "help" for details
2. **Given** the player is in talk mode, **When** they type an unrecognized input, **Then** they see a brief list of valid talk-mode commands inline
3. **Given** the player types "help" in any mode, **When** submitted, **Then** an extended, detailed help message is displayed covering all commands and their aliases
4. **Given** the player is in accuse mode, **When** they type an unrecognized command, **Then** they see the brief list of valid accuse-mode commands
5. **Given** the inline command list is shown, **Then** it is concise enough to display in one or two lines without scrolling

---

### User Story 4 - Graceful Backend Error Handling with Retries (Priority: P2)

When the game server returns an error for a submitted command, the UI distinguishes between transient errors (e.g., network timeout, server unavailable) and permanent errors (e.g., invalid game state). Transient errors trigger automatic retries with user-visible status, while permanent errors are shown clearly without retrying.

**Why this priority**: Network reliability varies. Without graceful error handling, players may experience silent failures or confusing error states. This story ensures a resilient and trustworthy experience.

**Independent Test**: Can be fully tested by simulating transient failures (e.g., temporary network drop) and permanent errors and verifying that retry logic fires for transient cases and that permanent errors are shown clearly.

**Acceptance Scenarios**:

1. **Given** the player submits a valid command, **When** the server returns a transient error (e.g., timeout or 5xx), **Then** the UI automatically retries up to 3 times with a visible retry indicator
2. **Given** retries are in progress, **When** a retry succeeds, **Then** the game continues normally without additional errors shown
3. **Given** all retries are exhausted, **When** the server still fails, **Then** the player sees a clear, human-readable error message explaining that the request failed, with an option to try again manually
4. **Given** the server returns a permanent error (e.g., invalid state, 4xx), **When** the command is submitted, **Then** no retry is attempted and the player sees a clear error message specific to what went wrong
5. **Given** an error is displayed, **When** the player dismisses or retries manually, **Then** the input field is re-enabled and the player can proceed

---

### Edge Cases

- **Bare command with no target** (e.g., "go" or "talk to" with nothing following): the command type is recognized but treated as a missing-target case — the player sees the list of valid targets for that command, same as an invalid target.
- **Whitespace, casing, and punctuation**: input is normalized before parsing — leading/trailing whitespace is stripped, casing is ignored, and common punctuation is removed — so "Go To  The Kitchen!" parses identically to "go to the kitchen".
- **Target ambiguity (character vs. location with same name)**: not a practical concern because the command type narrows the valid target set — a movement command only matches locations, a talk command only matches characters.
- **Empty characters or locations list**: cannot occur — game state includes character and location data before the player can interact; input is not available until game state is loaded.
- **Submitting before game state is loaded**: cannot occur — the command input is blocked/disabled until the game state is confirmed to be ready.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The parser MUST scan the first few words of typed input to identify the command type, supporting both primary command spellings and defined aliases
- **FR-002**: The parser MUST support at least the following command types: move, talk, search, ask (in talk mode), accuse, end conversation, help, quit, and list (locations/characters)
- **FR-003**: The parser MUST recognize aliases for movement commands, including at minimum: "go to", "move to", "travel to", "head towards", "go", and "move"
- **FR-004**: The parser MUST recognize aliases for talk commands, including at minimum: "talk to", "speak to", "speak with"
- **FR-005**: The parser MUST recognize aliases for search commands, including at minimum: "search", "look around", "inspect"
- **FR-006**: The parser MUST recognize aliases for ending a conversation, including at minimum: "bye", "leave", "end", "goodbye", "see you"
- **FR-007**: The parser MUST recognize aliases for quit, including at minimum: "quit" and "exit"
- **FR-008**: The parser MUST be mode-aware — the set of valid commands must depend on the current game mode (explore, talk, accuse, ended)
- **FR-009**: All player input MUST be normalized before parsing — leading/trailing whitespace stripped, casing folded to lowercase, and common punctuation removed — so that variations like "Go To  The Kitchen!" are treated identically to "go to the kitchen"
- **FR-010**: For move and talk commands, the parser MUST validate that a target was provided and that it matches the current known list of locations or characters respectively before submitting to the backend
- **FR-011**: A move or talk command recognized as requiring a target but typed with no target (e.g., bare "go" or "talk to") MUST be treated identically to an invalid target — the player sees the list of valid targets for that command
- **FR-012**: Target matching MUST support matching against a location's full name, a character's first name, and a character's surname (case-insensitive)
- **FR-013**: When a movement target is not found or missing, the UI MUST display valid movement targets, comprising both locations and characters currently at the player's current location
- **FR-014**: When a talk target is not found or missing, the UI MUST display the valid characters available in the current scene
- **FR-015**: The parser MUST recognize "locations" (and natural aliases like "where can I go") as a command that displays all locations and the characters present at each
- **FR-016**: The parser MUST recognize "characters" (and natural aliases like "who is here") as a command that displays all characters currently present in the scene
- **FR-017**: When a command is unrecognized, the UI MUST display a brief, inline list of commands valid for the current mode (fitting in one or two lines) and a short prompt to type "help" for full details
- **FR-018**: Typing "help" MUST display an extended help message covering all commands, their aliases, and usage, appropriate to the current mode
- **FR-019**: In talk mode and accuse mode, the parser MUST use **exact match** on the normalized input for system commands (end_talk aliases, quit, help); anything not matching exactly is passed through as an `ask` (question) without further parsing or validation
- **FR-020**: Accuse mode MUST behave like talk mode: the only exit commands are "quit" and "exit" (which terminate the game); all other input is treated as an `ask` sent to the accusation conversation; there is no target to validate in accuse mode (the accused was committed when the mode was entered)
- **FR-021**: The UI MUST NOT send commands with invalid or missing targets to the backend
- **FR-022**: For transient backend errors (network failure, server unavailable), the UI MUST automatically retry the command up to 3 times before displaying a failure message
- **FR-023**: For permanent backend errors (e.g., invalid game state responses), the UI MUST display a clear, human-readable error message without retrying
- **FR-024**: While a retry is in progress, the UI MUST show a visible status indicator to the player
- **FR-025**: After all retries are exhausted, the player MUST be offered a manual retry option and the input field must remain usable

### Key Entities

- **Command**: A player's typed input interpreted by the parser, including its type, optional target, and raw text
- **Alias Map**: The configured set of phrase patterns associated with each command type
- **Game Mode**: The current interaction context (explore, talk, accuse, ended) that determines which commands are valid
- **Target**: The resolved character or location a command is directed at
- **Character**: A non-player character in the game world, with a first and last name
- **Location**: A named place in the game world where characters may be present

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Players can successfully submit any command type using any of its recognized aliases without errors
- **SC-002**: 100% of commands with invalid or missing targets are caught client-side and never reach the backend
- **SC-003**: When a command is unrecognized, the player sees a brief command list inline; typing "help" produces extended help covering all commands and aliases
- **SC-004**: Transient backend failures are automatically retried up to 3 times, and the player sees a progress indicator during retries
- **SC-005**: After retries are exhausted, the player sees a human-readable error within 10 seconds of the first failure and can retry manually

## Assumptions

- The list of available characters and locations is provided to the Web UI as part of the active game state and is always current at the time of command submission
- "Quit" is treated as an alias for ending a session or exiting the game, not a mid-game command requiring server validation
- Target ambiguity between characters and locations is not possible in practice because the command type determines which entity set to match against
- Characters and locations are always available before the player can input commands — the input is blocked until game state is confirmed ready
- Retry logic applies only to network-level and server-side transient errors; validation errors (wrong target, wrong mode) are never retried
- The parser operates entirely client-side; no server round-trip is needed for parsing or validation
