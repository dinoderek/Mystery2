# Research: Web UI

## Initialization of SvelteKit in Monorepo

**Decision**: Use `npx sv create web` with minimal template and TypeScript, configured for Static Site Generation (SSG).

**Rationale**: The `apps/web` (or just `web/` at root) directory does not exist yet. To comply with the architecture requiring a static site deployed to Cloudflare Pages, we must scaffold a new SvelteKit application using the official `sv` CLI and the `@sveltejs/adapter-static` adapter.

**Alternatives considered**: 
- Manually creating all SvelteKit files: Rejected because the CLI sets up Vite, TypeScript, and Svelte 5 correctly out of the box, reducing boilerplate errors.

## Styling Setup

**Decision**: Install Tailwind CSS v3 via Vite plugin.

**Rationale**: The project explicitly mandates Tailwind CSS for all styling to maintain a text-adventure "terminal" aesthetic.

**Alternatives considered**:
- Custom CSS: Rejected per `styling-conventions.md` which prohibits custom CSS unless Tailwind cannot solve the issue cleanly.

## State Management

**Decision**: Use Svelte 5 runes (`$state`, `$derived`, `$effect`) for client-side game state.

**Rationale**: Svelte 5 provides a robust and reactivity model built-in, avoiding the need for external state management libraries like Redux or minimal stores context. We will encapsulate the game state in a reactive class or runes-based store.
