# Project structure

This document outlines the current primary project structure of our Monorepo.

Rule: keep this document directory-level only. Do not add file-level indexes here.

## Root Directories

- `web/`: Front-end SvelteKit application for the player UI.
- `blueprints/`: Stores local mystery blueprint JSON files that are seeded into Supabase Storage for local dev/runtime selection.
- `docs/`: Contains core project architecture, testing strategy, UI design, and development documentation.
- `packages/`: Workspace packages shared across the monorepo (e.g. bundled for UI/backend).
  - `shared/`: Shared TypeScript types, utility functions, and Zod schemas that bridge frontend and backend.
- `plan/`: Legacy planning documents used by Speckit workflow prior to full specification.
- `scripts/`: Assorted scripts needed for development (e.g., storage seeding and local AI-mode startup launchers).
- `specs/`: Active, implementation-ready feature specifications separated by logical milestones (e.g. `001-supabase-api`).
- `supabase/`: Contains the complete Supabase backend environment configuration and deployment artifacts.
  - `functions/`: Deno Edge Functions forming our custom API Layer, orchestrating gameplay transitions.
  - `migrations/`: Declarative SQL updates that manage Postgres DB schema and Row-Level Security rules.
  - `seed/`: Deterministic fixture files used by local seed scripts (for example `seed/blueprints/mock-blueprint.json`).
- `tests/`: Development and Test-only TS code (Node.js/Vitest environment) that is never bundled into production.
  - `api/`: Contains all backend-focused testing tiers (Unit, Integration, and E2E) run via Vitest.
  - `testkit/`: Highly reusable test helpers (e.g., seeding users, auth handling, test assertions).

## Configuration Files
- `package.json`: Main workspace root defining all top-level scripts like test coordination.
- `eslint.config.mjs`: Centralized ESLint configuration using flat config layout.
- `tsconfig.json`: Base configuration inherited by all local packages.
