# w1 Development Guidelines

## Active Technologies

- TypeScript 5.9 on Node 24
- SvelteKit 2 (`adapter-node`) + Svelte 5 + Tailwind CSS 4, served as a SPA by
  the same process that serves its `/api`
- SQLite via `better-sqlite3`, one file, no ORM
- Zod for every shape at the UI/API boundary
- OpenRouter for narration, called server-side
- Vitest (unit, integration, API E2E) and Playwright (browser E2E)

## Project Structure

```text
packages/game-engine/   the game: endpoints, rules, AI, storage adapter
packages/shared/        Zod contracts and the blueprint schema
web/                    the server and the SPA it serves
tests/                  unit, integration, and API E2E
evaluation/             blueprint, trace, and runtime evaluation pipelines
```

## Commands

```bash
npm run dev     # play it
npm test        # the full quality gate
```

## Code Style

Follow the conventions already in the surrounding file. `docs/` holds the
guidance for each surface area; `.specify/memory/constitution.md` governs.

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
