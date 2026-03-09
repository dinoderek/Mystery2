# Feature Specification: Basic Authentication

**Feature Branch**: `005-supabase-auth`
**Created**: 2026-03-09
**Status**: Draft
**Input**: User description: "Implement basic authentication leveraging Supabase. Email/password authentication with pre-provisioned accounts. Browser token persistence. WebApp login gate. Auth-required Supabase endpoints."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Player Logs In to Access Game (Priority: P1)

A player navigates to the Mystery Game web application. Before accessing any game content, they are presented with a login screen. The player enters their pre-provisioned email and password. Upon successful authentication, they are redirected to the main game screen (mystery list / start page).

**Why this priority**: Without login, no other authenticated feature works. This is the foundational gate that enables all downstream functionality.

**Independent Test**: Can be fully tested by navigating to the app, verifying the login screen appears, entering valid credentials, and confirming the player lands on the game start page. E2E test covers the full browser flow.

**Acceptance Scenarios**:

1. **Given** a player with a pre-provisioned account, **When** they navigate to the app for the first time, **Then** they see a login screen requesting email and password.
2. **Given** a player on the login screen, **When** they enter valid email and password and submit, **Then** they are authenticated and redirected to the game start page.
3. **Given** a player on the login screen, **When** they enter invalid credentials and submit, **Then** they see a clear, friendly error message and remain on the login screen.
4. **Given** a player on the login screen, **When** they submit without filling in required fields, **Then** they see inline validation messages indicating which fields are missing.

---

### User Story 2 - Session Persists Across Browser Sessions (Priority: P1)

After a player logs in, their authentication state is remembered in the browser. If the player closes the tab or browser and returns later, they are automatically signed in and taken directly to the game start page without needing to re-enter credentials.

**Why this priority**: Avoiding repeated sign-in is a core requirement and critical for a smooth player experience, especially for a game aimed at kids.

**Independent Test**: Can be tested by logging in, closing the browser tab, reopening the app, and verifying the player is still authenticated and sees the game start page. E2E test covers this flow.

**Acceptance Scenarios**:

1. **Given** a player who has previously logged in and closed the browser, **When** they navigate to the app again, **Then** they are automatically authenticated and see the game start page (not the login screen).
2. **Given** a player whose session token has expired, **When** they navigate to the app, **Then** the system silently refreshes the token and the player remains authenticated.
3. **Given** a player whose token cannot be refreshed (e.g., account disabled or refresh token expired), **When** they navigate to the app, **Then** they are redirected to the login screen with a message asking them to sign in again.

---

### User Story 3 - Unauthenticated Requests Are Rejected by Backend (Priority: P1)

All game-related backend endpoints (Edge Functions and direct database operations) require a valid authenticated user. Any request without valid authentication is rejected with an appropriate error, and no game data is exposed.

**Why this priority**: This is a security requirement. Without backend enforcement, authentication on the frontend alone is insufficient and game data could be accessed without authorization.

**Independent Test**: Can be tested by making backend API calls without an authentication token and verifying they are rejected. Integration tests cover this at the API level.

**Acceptance Scenarios**:

1. **Given** a request to any game-related backend endpoint, **When** no authentication token is provided, **Then** the endpoint responds with an authentication error and no data is returned.
2. **Given** a request with an expired or invalid token, **When** sent to any game-related backend endpoint, **Then** the endpoint responds with an authentication error.
3. **Given** a request with a valid authentication token, **When** sent to a game-related backend endpoint, **Then** the request is processed normally.

---

### User Story 4 - Player Logs Out (Priority: P2)

A player who is currently signed in can choose to log out. Logging out clears their session from the browser and returns them to the login screen.

**Why this priority**: While important for multi-user scenarios and security, logout is a secondary flow since the primary requirement focuses on persistent sessions.

**Independent Test**: Can be tested by logging in, triggering the logout action, and verifying the player is returned to the login screen and cannot access game pages without logging in again. E2E test covers this flow.

**Acceptance Scenarios**:

1. **Given** a logged-in player, **When** they trigger the logout action, **Then** their session is cleared from the browser and they see the login screen.
2. **Given** a player who has just logged out, **When** they navigate directly to a game page URL, **Then** they are redirected to the login screen.

---

### Edge Cases

- What happens when a player tries to access a deep-link game URL (e.g., a specific game session) while unauthenticated? They should be redirected to login and, after successful login, taken to their intended destination.
- How does the system handle concurrent sessions in multiple browser tabs? All tabs should share the same authentication state; logging out in one tab should reflect across all open tabs.
- What happens if a player's account is deactivated while they have an active session? On the next token refresh attempt, they should be logged out and shown the login screen.
- What happens if the network is unavailable when the app tries to refresh the session? The player should see a friendly offline/error message rather than being silently logged out.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST present a login screen to unauthenticated users before any game content is accessible.
- **FR-002**: System MUST support email and password authentication for pre-provisioned user accounts.
- **FR-003**: System MUST NOT provide self-registration or sign-up capability; accounts are created externally by administrators.
- **FR-004**: System MUST persist the user's authentication session in the browser so that closing and reopening the browser does not require re-authentication.
- **FR-005**: System MUST automatically refresh expired authentication tokens when possible, without requiring user interaction.
- **FR-006**: System MUST redirect unauthenticated users attempting to access any game page to the login screen.
- **FR-007**: System MUST provide a logout mechanism that clears the browser session and returns the user to the login screen.
- **FR-008**: All game-related backend endpoints MUST reject requests that do not include a valid authentication token, returning an appropriate error status.
- **FR-009**: System MUST display clear, user-friendly error messages for failed login attempts (invalid credentials, network errors).
- **FR-010**: The login screen MUST perform client-side validation (required fields) before submitting credentials.
- **FR-011**: System MUST redirect authenticated users who navigate to the login page to the game start page.

### Key Entities

- **User Account**: Represents a pre-provisioned player identity. Key attributes: email address, authentication credentials (managed by the auth provider). Each user account maps to game sessions and player data.
- **Authentication Session**: Represents an active login session. Contains access credentials and refresh capability. Stored locally in the player's browser.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Players can complete the login process in under 30 seconds from page load to game start page.
- **SC-002**: Players returning to the app after closing the browser are automatically signed in without re-entering credentials (within the session validity window).
- **SC-003**: 100% of game-related backend endpoints reject unauthenticated requests with appropriate error responses.
- **SC-004**: Players see clear error feedback within 3 seconds of submitting invalid login credentials.
- **SC-005**: Logout action completes within 2 seconds and fully clears the browser session.

## Assumptions

- User accounts are provisioned externally (e.g., via admin tooling, database seeding, or CLI). Account provisioning is out of scope for this feature.
- Password reset functionality is out of scope for this initial implementation. Pre-provisioned accounts have known passwords.
- The login screen follows the existing terminal/retro aesthetic of the Mystery Game UI.
- The entire app is gated behind login; there are no public-facing pages that require access without authentication.
- Rate limiting for failed login attempts is handled by the authentication provider's built-in protections.
