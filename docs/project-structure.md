# Project structure

This document outlines the current primary project structure of our Monorepo.

Rule: keep this document directory-level only. Do not add file-level indexes here.

## Root Directories

- `web/`: Front-end SvelteKit application for the player UI.
- `blueprints/`: Committed blueprint JSON, including the deterministic `mock-blueprint.json` the test suites play. Generated blueprints are written to `$MYSTERY_CONFIG_ROOT/blueprints/` when the external config root is set, and the server searches that directory first.
- `lib/`: Runtime-agnostic helpers shared by scripts and config (currently the worktree port allocator).
- `docs/`: Contains core project architecture, testing strategy, UI design, and development documentation.
- `packages/`: Workspace packages shared across the monorepo (e.g. bundled for UI/backend).
  - `shared/`: Shared TypeScript types, utility functions, and Zod schemas that bridge frontend and backend, including speaker-aware gameplay contracts and the canonical `narration_parts`/`narration_events` schemas.
  - `blueprint-generator/`: Reusable blueprint generation logic shared by local operator scripts and future backend adapters.
  - `game-engine/`: The game engine — endpoint handlers, state machine, clue graph, prompt assembly, AI provider, and the SQLite + filesystem implementation of `EngineContext` they run against.
- `scripts/`: Development and operator scripts (starting the game, running the test suites against a built server, blueprint and image generation).
  - `lib/`: Shared helpers (the test server, env-file reading, process spawning, image prompt builder, blueprint image manifest and patch helpers).
- `tests/`: Development and Test-only TS code (Node.js/Vitest environment) that is never bundled into production.
  - `api/`: Contains all backend-focused testing tiers (Unit, Integration, and E2E) run via Vitest.
  - `testkit/`: Highly reusable test helpers (e.g., seeding users, auth handling, test assertions).
- `web/src/lib/`: Browser-domain state, transcript hydration, and authenticated image-link handling for session start/resume flows.

## Configuration Files
- `package.json`: Main workspace root defining all top-level scripts like test coordination.
- `eslint.config.mjs`: Centralized ESLint configuration using flat config layout.
- `tsconfig.json`: Base configuration inherited by all local packages.

## Local-only Naming Convention

- Use the `.local` suffix for machine-specific files that must stay gitignored.
- An example in this repo is operator config such as `.env.images.local`.
- When a committed template is needed, pair it with a non-local example file (for example `*.example.json` or `.env.images.example`) and keep the real local file out of version control.
- Set `MYSTERY_CONFIG_ROOT` to an absolute directory if you want those local-only files to live outside the repo and be shared across clones or worktrees. When unset, the repo root remains the local-config root.
- When `MYSTERY_CONFIG_ROOT` is set, generated blueprints, story briefs, and blueprint images also default to subdirectories under that root (`blueprints/`, `briefs/`, `blueprint-images/`), keeping generated artifacts independent of any single checkout or worktree.

## Feature Additions (Static Blueprint Images)

- `web/src/routes/api/images/[blueprint]/[image]/+server.ts`: Serves blueprint artwork off disk, gated on a signed-in profile and on the blueprint referencing the image.
- `packages/game-engine/src/images.ts`: Canonical image ID validation and storage-key helpers.
- `scripts/generate-blueprint-images.mjs`: Local operator image generation + selective blueprint patching CLI.

## Feature Additions (Local Execution)

- `packages/game-engine/src/db/schema.ts`: The whole local database — `players`, `game_sessions`, `game_events` — with no migration chain.
- `packages/game-engine/src/db/client.ts`: The only file that imports a SQLite driver, plus the connection pragmas and the `PRAGMA user_version` schema runner.
- `web/src/routes/api/`: The server tier — the endpoint dispatcher, image serving, and profile routes.
- `data/`: Gitignored home of the local `game.db` when `MYSTERY_CONFIG_ROOT` is unset; otherwise the database lives at `$MYSTERY_CONFIG_ROOT/game.db` so worktrees share one history.

## Feature Additions (Blueprint Generation)

- `packages/shared/src/blueprint-schema-v2.ts`: Canonical Blueprint V2 Zod schema shared by Node tooling and the game server.
- `packages/blueprint-generator/`: Shared prompt-loading, OpenRouter structured-output, and schema-validation flow for blueprint generation.
- `scripts/generate-blueprint.mjs`: Local operator CLI that turns structured story briefs into canonical blueprint JSON.
