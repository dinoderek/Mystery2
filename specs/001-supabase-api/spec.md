# Feature Specification: Supabase API Implementation

**Feature Branch**: `001-supabase-api`  
**Created**: 2026-03-05  
**Status**: Draft  
**Input**: User description: "Setup Supabase as per existing architectural documents. Define API contract following detailed spec at plan/B1-api-contract.md. Implement API contract on top of Supabase using Supabase Edge Functions and Supabase SQL. Create tests for all the API methods. Create an E2E test using a mock blueprint and mock AI that goes through a full investigation."
**API Contract Reference**: [`plan/B1-api-contract.md`](file:///Users/dinohughes/Projects/my2/w1/plan/B1-api-contract.md) — the plan MUST follow this contract when designing the API endpoints, request/response shapes, and game flows.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Browse and Start a Game (Priority: P1)

A player wants to select a mystery adventure and begin playing. They browse a list of available mystery blueprints, pick one that appeals to them, and the system sets up a new game session for them. Upon starting, the player receives an opening narration, their starting location, a list of visible characters, and an initial set of investigative clues — everything they need to begin exploring.

**Why this priority**: This is the foundation of all gameplay. Without the ability to list blueprints and start a game, nothing else in the system can be tested or used.

**Independent Test**: Can be tested end-to-end by calling the "list blueprints" operation followed by "start game" and verifying that a valid game session with opening state is returned. Delivers a complete "new game" flow.

**Acceptance Scenarios**:

1. **Given** the system has at least one blueprint available, **When** the player requests a list of blueprints, **Then** they receive a list with at least one entry containing a title, age suitability, and a short description.
2. **Given** a valid blueprint ID, **When** the player starts a new game with that blueprint, **Then** a new game session is created and returns a unique game ID, initial game state including the current location, visible characters, the player's starting clues, and an opening narration.
3. **Given** an invalid or non-existent blueprint ID, **When** the player attempts to start a game, **Then** the system returns an error and no game session is created.

---

### User Story 2 - Explore the Mystery World (Priority: P2)

An active investigator navigates between locations and searches for physical clues. They can move to any location on the map and search rooms, spending their limited time budget on each action. The game narrates what they find, and discovered clues are permanently added to their knowledge.

**Why this priority**: Exploration is the primary gameplay loop. Players must be able to navigate and discover clues before they can interrogate suspects or make an accusation.

**Independent Test**: Can be tested end-to-end with an active game session by performing move and search operations and verifying narration, updated location, updated time, and optional clue discovery. Delivers a functioning exploration phase.

**Acceptance Scenarios**:

1. **Given** an active game and a valid destination, **When** the player moves to a new location, **Then** the system returns arrival narration, the updated current location, characters visible at the new location, and a decremented time remaining.
2. **Given** an active game with time remaining, **When** the player searches the current location, **Then** the system returns search narration, decrements time, and optionally returns a discovered clue.
3. **Given** an active game but an invalid destination, **When** the player attempts to move there, **Then** the system returns an error and the game state is unchanged.
4. **Given** an active game with zero time remaining, **When** any time-consuming action is attempted, **Then** the system rejects the action or forces the endgame sequence.

---

### User Story 3 - Interrogate Suspects (Priority: P3)

An investigator wants to interview a character present at their current location. They enter talk mode with a specific character, ask free-form questions, and receive AI-generated responses consistent with the blueprint's story. Conversations may reveal new clues. The investigator can end the conversation at any time to return to exploration.

**Why this priority**: Interrogation is the primary mechanism for gathering evidence through dialogue. It depends on exploration (P2) to position the player near a character.

**Independent Test**: Can be tested end-to-end by initiating a game, moving to a character's location, starting a conversation, asking a question, and verifying a coherent, blueprint-consistent response. Delivers the interrogation loop in isolation.

**Acceptance Scenarios**:

1. **Given** a character is present at the player's current location, **When** the player initiates a conversation with that character, **Then** the game enters talk mode and the character's greeting narration is returned.
2. **Given** the game is in talk mode, **When** the player asks a free-form question, **Then** the system returns a context-aware response, updated time remaining, and any newly revealed clues.
3. **Given** the game is in talk mode, **When** the player ends the conversation, **Then** the game returns to explore mode and a brief sign-off narration is provided.
4. **Given** a character is NOT at the player's current location, **When** the player tries to initiate a conversation, **Then** the system returns an error and mode remains unchanged.

---

### User Story 4 - Accuse a Suspect and Resolve the Mystery (Priority: P4)

When an investigator is ready to make their accusation, they name a suspect and provide their reasoning through a structured dialogue with the narrator. The narrator evaluates their evidence across one or more exchanges and ultimately delivers a win or loss resolution, explaining the outcome.

**Why this priority**: The endgame is the final phase of play. It requires a working game session and at minimum one piece of evidence before it becomes meaningful.

**Independent Test**: Can be tested end-to-end from an active game session by accusing a character, providing reasoning, and verifying the outcome is `win` or `loss` with a closing narration. Can use a mock AI for deterministic testing.

**Acceptance Scenarios**:

1. **Given** an active game in explore mode, **When** the player accuses a character, **Then** the game enters accuse mode and the narrator prompts for the player's reasoning.
2. **Given** the game is in accuse mode, **When** the player provides their reasoning, **Then** the system evaluates it and either asks a follow-up question (outcome: null) or concludes with a win or loss (mode: ended).
3. **Given** the game is NOT in accuse mode, **When** the player attempts to provide accusation reasoning, **Then** the system returns an error and game state is unchanged.
4. **Given** a concluded game (mode: ended), **When** the player reviews the outcome, **Then** the final narration and win/loss result are accessible.

---

### User Story 5 - Resume a Running Investigation (Priority: P5)

A player who started an investigation earlier — on a different device, after closing the app, or after a session timeout — wants to pick up exactly where they left off. They provide their game session identifier and the system restores their full in-progress state: current location, mode, clues discovered so far, remaining time, and any active conversation context.

**Why this priority**: Session persistence is a prerequisite for any real-world use. Without the ability to resume, a player who closes the app or loses connectivity permanently loses their progress.

**Independent Test**: Can be tested end-to-end by starting a game, performing several actions, simulating a disconnection (fetching state with the same game ID in a fresh client), and verifying the returned state matches the last known state exactly.

**Acceptance Scenarios**:

1. **Given** an in-progress game session with actions taken, **When** a client fetches the game state using the session ID, **Then** the system returns the complete current state including location, mode, remaining time, all discovered clues, and any active conversation context.
2. **Given** a session where the player was mid-conversation (talk mode), **When** they resume via the session ID, **Then** the state reflects `talk` mode and the current conversation partner.
3. **Given** a non-existent or expired session ID, **When** a client attempts to resume it, **Then** the system returns a clear error indicating the session cannot be found.
4. **Given** a concluded game session (mode: ended), **When** a client fetches the state, **Then** the final outcome and narration remain accessible and no further actions can be taken.

---

### User Story 6 - Full E2E Investigation (Priority: P6)

A developer or QA engineer can run a fully automated investigation from start to finish — browsing blueprints, starting a game with a known test blueprint, exploring, interrogating, accumulating clues, and making a final accusation — all without a real AI model. The entire flow completes successfully and deterministically against a mock AI responder.

**Why this priority**: This e2e test is the safety net for the entire system. It validates integration between all API contracts, database persistence, and edge function orchestration in one shot.

**Independent Test**: Runs as an automated test suite using a mock blueprint fixture and a mock AI that returns predictable responses. The test asserts correct state transitions across every API method.

**Acceptance Scenarios**:

1. **Given** a mock blueprint and a mock AI provider configured in the test environment, **When** the automated test executes a complete investigation flow, **Then** every step returns valid state, and the game concludes with a deterministic win or loss outcome.
2. **Given** the automated test has run, **When** results are reviewed, **Then** all API methods (list blueprints, start, get state, move, search, talk, ask, end_talk, accuse, accuse reasoning, resume) are exercised and pass.

---

### Edge Cases

- What happens when a player tries to move to the location they are already at?
- What happens when a player's time reaches zero mid-conversation?
- What happens when the AI model is unavailable during an `ask` or `accuse/reasoning` call?
- What happens when a player submits an empty question or reasoning?
- What happens when a game session ID does not exist?
- How does the system handle concurrent requests to the same game session?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST provide an operation to list all available mystery blueprints, each with a unique ID, title, age-appropriateness indicator, and one-line description.
- **FR-002**: The system MUST allow a player to start a new game session by selecting a blueprint, receiving a unique session identifier, opening narration, starting location, visible characters, initial clues, and remaining time budget.
- **FR-003**: The system MUST allow retrieval of the full current state of an active game session at any time, including locations, characters, player position, mode, talk partner, clues, and time remaining.
- **FR-004**: The system MUST allow a player to move between locations, deduct time from the budget, narrate arrival, and report characters visible at the new location.
- **FR-005**: The system MUST allow a player to search their current location, deduct time, narrate the outcome, and optionally award a discovered clue.
- **FR-006**: The system MUST allow a player to initiate a conversation with a character present at their current location, switch game mode to `talk`, and return the character's opening response.
- **FR-007**: The system MUST allow a player in `talk` mode to ask free-form questions and receive AI-generated responses consistent with the blueprint's story, with optional clue revelation and time deduction.
- **FR-008**: The system MUST allow a player to end a conversation, returning the game to `explore` mode with a brief sign-off narration.
- **FR-009**: The system MUST allow a player to formally accuse a character, switching the game to `accuse` mode and prompting for reasoning.
- **FR-010**: The system MUST allow a player in `accuse` mode to submit reasoning, which the system evaluates across one or more exchanges, ultimately returning a `win` or `loss` outcome and switching mode to `ended`.
- **FR-011**: The system MUST persist game sessions and all state transitions in durable storage, so that state is recoverable across requests.
- **FR-012**: The system MUST protect all secret credentials (AI model keys) from exposure to clients; all AI calls MUST occur server-side.
- **FR-013**: The system MUST return meaningful error responses for invalid operations (e.g., moving to a non-existent location, talking to a character not present, submitting reasoning when not in accuse mode).
- **FR-014**: The system MUST include automated unit/integration tests covering each API operation individually.
- **FR-015**: The system MUST include an automated E2E test using a mock blueprint fixture and a mock AI provider that exercises all API operations in sequence through a complete investigation.

### Key Entities

- **Blueprint**: A pre-authored mystery scenario containing locations, characters, secrets, ground truths, and narrative templates. Identified by a unique ID.
- **Game Session**: A live play instance tied to a blueprint. Holds current player position, mode, remaining time, discovered clues, conversation context, and full event history. Identified by a unique session ID.
- **Location**: A named place in the mystery world where a player can travel and search.
- **Character**: A named individual residing at a location, who can be questioned by the player.
- **Clue**: A piece of evidence discovered through search or interrogation. Once found, a clue is permanently associated with the player's session.
- **Turn Event**: An immutable record of a game action (move, search, talk, ask, accuse, etc.) appended to the session log, used to derive state and support auditability.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: All 10 API operations (list blueprints, start game, get state, move, search, talk, ask, end talk, accuse, accuse reasoning) respond successfully in the happy path within acceptable time for an interactive game experience.
- **SC-002**: The automated E2E test using a mock blueprint and mock AI completes a full investigation — from browsing blueprints to receiving a definitive outcome — without manual intervention or failures.
- **SC-003**: All automated unit and integration tests for individual API methods pass with zero failures.
- **SC-004**: The system correctly enforces game-mode state machine transitions; invalid operations in wrong modes are rejected 100% of the time.
- **SC-005**: Game session state is fully recoverable after a simulated server restart; a player can reconnect and retrieve their exact current state.
- **SC-006**: No AI model credentials or server-side secrets are present in any client-observable response, header, or payload.
- **SC-007**: The local development environment starts the full stack (database, edge functions, UI) with a single command and is ready to play within 60 seconds.

## Assumptions

- Game sessions are currently unauthenticated (anonymous). Authentication may be added in a future feature.
- The AI model provider is accessed exclusively server-side; clients never call the AI provider directly.
- Blueprints are pre-authored JSON files stored on the server; there is no blueprint creation flow in this feature.
- Time budget is measured in discrete turns rather than real-world time.
- The mock AI for E2E testing will be implemented as a test double with deterministic, hardcoded responses.
- The system follows an append-only event log pattern internally, with a session snapshot maintained for fast reads, as described in the architectural documentation.
- RLS (Row Level Security) policies will be set up to allow anonymous access for the duration of this feature, with a migration path to user-scoped access when auth is added.
