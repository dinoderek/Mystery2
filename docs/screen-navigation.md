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
  - Blueprint cards optionally render cover images fetched via authenticated `blueprint-image-link` signed URLs.
  - Cover-image fetch failures render a placeholder panel without blocking case selection.
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
  - Optional side image panel renders location/character imagery from move/talk payload image IDs.
  - Side panel falls back to placeholder text if image link issuance fails or asset is missing.
  - On session end (accusation resolution `win`/`lose` or local `quit`/`exit`), input is replaced by a terminal end-state prompt and any key returns to `/`.
  - Completed sessions opened from `/sessions/completed` are read-only: command input is blocked and the return prompt is shown immediately.
  - Includes a logout action that clears browser auth session.

## Mobile UI Layer

When `mobileDetect.isMobile` is true, route pages render a separate mobile
component tree. Desktop markup is preserved unchanged inside `{#if}` guards.
All shared stores (game, auth, theme) are reused; only layout and interaction
patterns differ.

See `plan/mobileview/plan.md` for detailed wireframes and user journey
descriptions (J1-J11).

### Mobile Detection

`MobileDetectStore` (`src/lib/domain/mobile-detect.svelte.ts`) exposes
`isMobile: boolean` via `matchMedia('(hover: none) and (pointer: coarse)')`.
Initialised in root layout `onMount`. Routes branch on this value to render
mobile or desktop component trees.

### Mobile Routes

#### `/` — Mobile Home (`MobileHome.svelte`)

Two internal views (no route change):
- **Menu view**: Three buttons — "Start New Case", "Resume Case (N)",
  "Case History (N)". Logout button top-right.
- **New-game view**: `MobileTopBar` + `MobileCarousel` of blueprints.
  Tap card to start game → `/session`.

Journeys: J1 (select blueprint), J2/J3 (navigation to session lists).

#### `/sessions/in-progress` — Mobile Resume (`MobileCarousel`)

`MobileTopBar` ("Resume Case") + carousel of in-progress sessions.
Cards show title, turns remaining, last played. Tap to resume → `/session`.
Unavailable sessions are dimmed. Back arrow returns to `/`.

Journey: J2 (resume game).

#### `/sessions/completed` — Mobile History (`MobileCarousel`)

Same layout as in-progress. Cards show title, outcome, last played.
Tap to view in read-only mode → `/session`. Back arrow returns to `/`.

Journey: J3 (view history).

#### `/session` — Mobile Session (`MobileSession.svelte`)

Orchestrates the full gameplay experience with two internal modes:

- **Reading mode**: `MobileTopBar` (title, turns, menu) + `NarrationBox`
  (reused) + `MobileActionBar` (quick actions) + floating reply button.
  Text size controlled by `mobilePrefs.textSize`.
- **Input mode**: Last interaction context + `MobileInputBar` with
  auto-focused text input. Draft preserved between mode switches.

Overlays: `MobileDrawer` (status, help, zoom, themes, text size, quit),
`MobileImageViewer` (fullscreen image on tap), `HelpModal`.

Journeys: J4 (read), J5 (write), J6 (quick actions), J7 (image viewer),
J8 (help), J9 (status), J10 (exit), J11 (text size).

#### `/briefs/*` — Gated on Mobile

All briefs routes (`/briefs`, `/briefs/new`, `/briefs/[id]`) redirect to
`/` on mobile via an `onMount` guard. The brief creator is desktop-only.

### Mobile Navigation Patterns

- **Back arrow** in `MobileTopBar` uses `goto('/')` or parent-provided callback.
- **Hamburger menu** toggles the `MobileDrawer`.
- **Quick actions** in `MobileActionBar` open `MobileListPicker` bottom-sheets
  for location/character selection, or submit commands directly.
- **Reply button** switches from reading to input mode (within `/session`).
- **Safe area insets**: `viewport-fit=cover` in `app.html`;
  `MobileTopBar` uses `pt-[env(safe-area-inset-top)]`,
  `MobileInputBar`/`MobileActionBar` use `pb-[env(safe-area-inset-bottom)]`.

## Navigation Patterns

- Use standard HTML `<a>` tags for standard links to leverage SvelteKit's built-in client-side router.
- Use `goto('/path')` from `$app/navigation` for programmatic navigation (e.g., redirecting to a game session after clicking "Start").
- Auth redirect rules:
  - Unauthenticated access to protected routes redirects to `/login`.
  - Authenticated navigation to `/login` redirects back to the stored intended path (or `/`).
