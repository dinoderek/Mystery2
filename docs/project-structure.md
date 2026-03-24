# Project structure

This document outlines the current primary project structure of our Monorepo.

Rule: keep this document directory-level only. Do not add file-level indexes here.

## Root Directories

- `web/`: Front-end SvelteKit application for the player UI.
- `blueprints/`: Stores committed seed blueprint JSON files. Generated blueprints are written to `$MYSTERY_CONFIG_ROOT/blueprints/` when the external config root is set (and also seeded from there).
- `deploy/`: Deployment contracts (environment target mapping plus committed bootstrap-user examples; real non-prod bootstrap manifests use `bootstrap-users.<env>.json`).
- `docs/`: Contains core project architecture, testing strategy, UI design, and development documentation.
- `packages/`: Workspace packages shared across the monorepo (e.g. bundled for UI/backend).
  - `shared/`: Shared TypeScript types, utility functions, and Zod schemas that bridge frontend and backend, including speaker-aware gameplay contracts and the canonical `narration_parts`/`narration_events` schemas.
  - `blueprint-generator/`: Reusable blueprint generation logic shared by local operator scripts and future backend adapters.
- `plan/`: Legacy planning documents used by Speckit workflow prior to full specification.
- `scripts/`: Assorted scripts needed for development and operations (e.g., `setup-local` bootstrap, storage/auth/AI-profile seeding with canonical `default`, edge-runtime log tailing, and cloud deploy orchestration).
  - `lib/`: Shared operator/deploy helpers (image prompt builder, target selection, blueprint image manifest and patch helpers).
- `specs/`: Active, implementation-ready feature specifications separated by logical milestones (e.g. `001-supabase-api`).
- `supabase/`: Contains the complete Supabase backend environment configuration and deployment artifacts.
  - `functions/`: Deno Edge Functions forming our custom API Layer, orchestrating gameplay transitions, canonical narration-event persistence, and server-side speaker attribution.
  - `migrations/`: Declarative SQL updates that manage Postgres DB schema and Row-Level Security rules.
  - `seed/`: Deterministic fixture files used by local seed scripts (for example `seed/blueprints/mock-blueprint.json` and the committed `auth-users.example.json` template that generates a local-only auth manifest on first bootstrap).
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
- Examples in this repo include env files such as `.env.deploy.<env>.local`, operator config such as `.env.images.local`, and copied deployment manifests such as `deploy/bootstrap-users.<env>.local.json`.
- When a committed template is needed, pair it with a non-local example file (for example `*.example.json` or `.env.images.example`) and keep the real local file out of version control.
- Set `MYSTERY_CONFIG_ROOT` to an absolute directory if you want those local-only files to live outside the repo and be shared across clones or worktrees. When unset, the repo root remains the local-config root.
- When `MYSTERY_CONFIG_ROOT` is set, generated blueprints, story briefs, and blueprint images also default to subdirectories under that root (`blueprints/`, `briefs/`, `blueprint-images/`), keeping generated artifacts independent of any single checkout or worktree.

## Feature Additions (Static Blueprint Images)

- `supabase/functions/blueprint-image-link/`: Auth-gated signed URL issuance for private blueprint images.
- `supabase/functions/_shared/images.ts`: Canonical image ID validation + storage key + TTL helpers.
- `supabase/migrations/0007_blueprint_images_storage.sql`: Private `blueprint-images` bucket and authenticated read policy.
- `web/src/lib/api/images.ts`: Frontend signed-link client with expiry-aware cache/refresh behavior.
- `scripts/generate-blueprint-images.mjs`: Local operator image generation + selective blueprint patching CLI.

## Feature Additions (Blueprint Generation)

- `packages/shared/src/blueprint-schema-v2.ts`: Canonical Blueprint V2 Zod schema shared by Node tooling and Supabase Edge Functions.
- `packages/shared/src/evaluation/`: Shared standalone blueprint-evaluation prompt plus Zod output schema.
- `packages/blueprint-generator/`: Shared prompt-loading, OpenRouter structured-output, and schema-validation flow for blueprint generation.
- `scripts/generate-blueprint.mjs`: Local operator CLI that turns structured story briefs into canonical blueprint JSON.
- `scripts/build-blueprint-evaluation-markdown.mjs`: Local operator CLI that assembles the evaluator prompt, schema references, and concrete brief/blueprint JSON into one chat-ready markdown packet.
