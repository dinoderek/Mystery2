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
- **Purpose**: The landing page where the player selects a mystery blueprint to begin.
- **State Dependencies**: Fetches available `Blueprints` from the backend API.
- **Special behavior**:
  - While selected-game startup is in progress, the screen clears and shows a centered terminal loading spinner.
  - Includes a small theme switcher (`matrix` / `amber`) that updates the global `data-theme` attribute before entering a session.
  - Includes a logout action that clears browser auth session.

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
  - On accusation resolution (`win`/`lose`), input is replaced by a terminal end-state prompt and any key returns to `/`.
  - Includes a logout action that clears browser auth session.

## Navigation Patterns

- Use standard HTML `<a>` tags for standard links to leverage SvelteKit's built-in client-side router.
- Use `goto('/path')` from `$app/navigation` for programmatic navigation (e.g., redirecting to a game session after clicking "Start").
- Auth redirect rules:
  - Unauthenticated access to protected routes redirects to `/login`.
  - Authenticated navigation to `/login` redirects back to the stored intended path (or `/`).
