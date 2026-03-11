# Screen & Navigation

This document outlines the SvelteKit routes, screen architecture, and navigation flows. **AI Agents: You must update this document whenever you add or modify a route or major view.**

## Architecture

We use SvelteKit with `adapter-static`. All routing is client-side after the initial load.

- **NO Server Routes**: Do not use `+page.server.ts` or `+layout.server.ts`.
- **Client Loading**: Initialize data fetching in `+page.ts` (with `export const ssr = false;`).
- **Auth Gate**: Root layout (`src/routes/+layout.svelte`) enforces authentication for all app routes except `/login`.

## Current Routes

### `/` (Start Page)

- **Directory**: `src/routes/+page.svelte`
- **Purpose**: Session-aware landing page with a three-option numeric menu:
  - `1. Start a new game`
  - `2. View in-progress games`
  - `3. View completed games`
- **State Dependencies**:
  - Fetches `sessionCatalog` (`game-sessions-list`) to enable/disable options 2/3.
  - Loads `Blueprints` only after entering the new-game sub-flow.
- **Special behavior**:
  - While selected-game startup is in progress, the screen clears and shows a centered terminal loading spinner.
  - Includes a small theme switcher (`matrix` / `amber`) that updates the global `data-theme` attribute before entering a session.
  - Includes a logout action that clears browser auth session.
  - Forces a fresh session catalog load on route mount to avoid stale in-progress/completed counts after returning from `/session`.
  - Option 2 (`/sessions/in-progress`) and option 3 (`/sessions/completed`) are disabled when counts are zero.
  - In the new-game sub-flow, `b` returns to the root three-option menu.

### `/sessions/in-progress` (In-Progress List)

- **Directory**: `src/routes/sessions/in-progress/+page.svelte`
- **Purpose**: Shows resumable, non-ended sessions for the authenticated user.
- **State Dependencies**:
  - Reads `sessionCatalog.in_progress` from `gameSessionStore`.
  - Uses `resumeSession(game_id)` to hydrate session state from `game-get`.
- **Special behavior**:
  - Numeric row selection resumes the chosen session and navigates to `/session`.
  - Rows display mystery title, turns left, and last played timestamp.
  - Forces a fresh catalog read on route mount to avoid stale list data.
  - If a row is not openable (`can_open=false`), selection is blocked with a warning.
  - Pressing `b` returns to `/`.

### `/sessions/completed` (Completed List)

- **Directory**: `src/routes/sessions/completed/+page.svelte`
- **Purpose**: Shows ended sessions for read-only review.
- **State Dependencies**:
  - Reads `sessionCatalog.completed` from `gameSessionStore`.
  - Uses `resumeSession(game_id)` to load session history in completed-view mode.
- **Special behavior**:
  - Numeric row selection opens a completed session in `/session`.
  - Rows display mystery title, outcome, and last played timestamp.
  - Forces a fresh catalog read on route mount to avoid stale list data.
  - If a row is not openable (`can_open=false`), selection is blocked with a warning.
  - Pressing `b` returns to `/`.

### `/login` (Login Page)

- **Directory**: `src/routes/login/+page.svelte`
- **Purpose**: Email/password authentication entry point.
- **State Dependencies**:
  - Uses `authStore` (`src/lib/domain/auth-store.svelte.ts`) via `LoginForm.svelte`.
- **Special behavior**:
  - Validates required fields inline.
  - Displays auth errors (invalid credentials, expired session).
  - Redirects to intended target path after successful sign-in.

### `/session` (Game Page)

- **Directory**: `src/routes/session/+page.svelte`
- **Purpose**: The main text-adventure interface.
- **State Dependencies**:
  - Reads the active in-memory session from the game store.
  - Maintains narration/event history, mode, and remaining time.
- **Sub-views**: Contains the Narration Window, Status Bar, and Input Area.
- **Special behavior**:
  - During backend waits, narration shows a terminal spinner.
  - On session end (accusation resolution `win`/`lose` or local `quit`/`exit`), input is replaced by a terminal end-state prompt and any key returns to `/`.
  - Completed sessions opened from `/sessions/completed` are read-only: command input is blocked and the return prompt is shown immediately.
  - Includes a logout action that clears browser auth session.

## Navigation Patterns

- Use standard HTML `<a>` tags for standard links to leverage SvelteKit's built-in client-side router.
- Use `goto('/path')` from `$app/navigation` for programmatic navigation (e.g., redirecting to a game session after clicking "Start").
- Auth redirect rules:
  - Unauthenticated access to protected routes redirects to `/login`.
  - Authenticated navigation to `/login` redirects back to the stored intended path (or `/`).
