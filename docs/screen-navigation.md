# Screen & Navigation

This document outlines the SvelteKit routes, screen architecture, and navigation flows. **AI Agents: You must update this document whenever you add or modify a route or major view.**

## Architecture
We use SvelteKit with `adapter-static`. All routing is client-side after the initial load. 
- **NO Server Routes**: Do not use `+page.server.ts` or `+layout.server.ts`.
- **Client Loading**: Initialize data fetching in `+page.ts` (with `export const ssr = false;`).

## Current Routes

*(Add routes here as they are built. Example format below)*

### `/` (Start Page)
- **Directory**: `src/routes/+page.svelte`
- **Purpose**: The landing page where the user selects a mystery blueprint to play or views their historical games.
- **State Dependencies**: Needs to fetch available `Blueprints` from the backend API.

### `/play/[id]` (Game Page)
- **Directory**: `src/routes/play/[id]/+page.svelte`
- **Purpose**: The main text-adventure interface.
- **State Dependencies**: 
  - Loads the specific game session by `id`.
  - Maintains the event log string and the remaining time.
- **Sub-views**: Contains the Narration Window, Status Bar, and Input Area.

## Navigation Patterns
- Use standard HTML `<a>` tags for standard links to leverage SvelteKit's built-in client-side router.
- Use `goto('/path')` from `$app/navigation` for programmatic navigation (e.g., redirecting to a game session after clicking "Start").
