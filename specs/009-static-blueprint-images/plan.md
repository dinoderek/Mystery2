# Implementation Plan: Static Blueprint Images

**Branch**: `009-static-blueprint-images` | **Date**: 2026-03-10 | **Spec**: [/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/spec.md](/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/spec.md)
**Input**: Feature specification from `/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/spec.md`

## Summary

Add optional static image references to blueprint metadata, characters, and locations; provide authenticated image delivery via short-lived signed URLs; add a local operator image generation workflow (OpenRouter-backed) that patches blueprint image IDs; and extend deployment so blueprints and images publish together while remaining backward compatible with image-less or partially missing assets.

## Technical Context

**Language/Version**: TypeScript 5.x (Node scripts + SvelteKit + shared package), TypeScript on Deno runtime for Supabase Edge Functions  
**Primary Dependencies**: SvelteKit, Tailwind CSS (`t-*` tokens), Supabase JS client v2, Supabase Storage, Zod, Vitest, Playwright, OpenRouter HTTP API  
**Storage**: Supabase Storage bucket `blueprints` (JSON), planned image bucket for static blueprint assets, local operator image output directory  
**Testing**: Vitest unit/integration/API-E2E (`tests/api/*`), Playwright browser E2E (`web/e2e`), contract/schema tests in `packages/shared/tests`  
**Target Platform**: Static SvelteKit web client + Supabase Edge Functions/Postgres/Storage (local + cloud) + local operator CLI scripts  
**Project Type**: Monorepo web application with backend edge API and operator tooling scripts  
**Performance Goals**: Meet spec SC-002/SC-003 targets (>=95% valid authenticated image renders within 2 seconds; complete full image set generation/patch under 10 minutes active run time)  
**Constraints**: Auth required for image access link issuance; signed URLs are short-lived and refreshable; blueprint images remain optional; deployment must succeed without images; generated images must stay out of default git commits  
**Scale/Scope**: Blueprint schema + list/move/talk response extensions, one image-link endpoint, one local generation utility, deployment utility extension, docs + unit/integration/E2E coverage

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Documentation reviewed and lean? (`/Users/dinohughes/Projects/my2/w1/docs/architecture.md`, `/Users/dinohughes/Projects/my2/w1/docs/game.md`, `/Users/dinohughes/Projects/my2/w1/docs/project-structure.md`, `/Users/dinohughes/Projects/my2/w1/docs/testing.md`)
- [x] Testing strategy includes E2E (mandatory) and Unit/Integration? (plan covers unit + integration + API E2E + Playwright E2E)
- [x] Quality gates runnable? (`npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, `npm -w web run test:e2e`; combined via `npm run test:all`)
- [x] Static UI + Supabase backend constraints respected? (no browser secrets, auth-gated storage access, edge-function mediation for privileged operations)
- [x] Context-specific conventions applied? (`/Users/dinohughes/Projects/my2/w1/docs/backend-conventions.md`, `/Users/dinohughes/Projects/my2/w1/docs/styling-conventions.md`, `/Users/dinohughes/Projects/my2/w1/docs/component-inventory.md`, `/Users/dinohughes/Projects/my2/w1/docs/screen-navigation.md`, `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/blueprints/blueprint-schema.ts`)

**Post-design re-check**: PASS. Phase 1 artifacts preserve contract-first shared schemas, Supabase auth + RLS expectations, optional image backward compatibility, and mandatory cross-tier testing.

## Project Structure

### Documentation (this feature)

```text
/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── static-blueprint-images.openapi.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
/Users/dinohughes/Projects/my2/w1/
├── packages/
│   └── shared/
│       └── src/
│           └── mystery-api-contracts.ts
├── supabase/
│   ├── functions/
│   │   ├── _shared/
│   │   │   ├── blueprints/blueprint-schema.ts
│   │   │   └── (new) images.ts                   # image access-link helpers/policies
│   │   ├── blueprints-list/index.ts
│   │   ├── game-move/index.ts
│   │   ├── game-talk/index.ts
│   │   └── (new) blueprint-image-link/index.ts   # auth-gated signed URL issuance
│   └── migrations/
├── scripts/
│   ├── deploy.mjs
│   ├── deploy-helpers.mjs
│   ├── seed-storage.mjs
│   └── (new) generate-blueprint-images.mjs
├── web/
│   └── src/
│       ├── lib/
│       │   ├── api/
│       │   ├── domain/
│       │   ├── types/
│       │   └── ui/
│       └── routes/
├── tests/
│   └── api/
│       ├── unit/
│       ├── integration/
│       └── e2e/
├── web/e2e/
└── docs/
    ├── architecture.md
    ├── game.md
    ├── project-structure.md
    ├── testing.md
    └── component-inventory.md
```

**Structure Decision**: Keep existing monorepo boundaries and extend current API/script pathways. Introduce a focused image-link endpoint for authenticated signed URL issuance, keep generation/deployment as operator-run scripts, and update shared contracts first before backend/UI implementation.

## Phase Plan

### Phase 0 - Research

- Resolve image delivery approach details under auth and signed URL expiry handling.
- Resolve fallback behavior for missing/broken images to avoid UX ambiguity.
- Resolve image ID uniqueness and storage path strategy to prevent collisions.
- Resolve operator generation workflow inputs/outputs, model selection, and partial failure handling.
- Resolve deployment extension behavior when image assets are missing or upload partially fails.
- Resolve testing strategy additions (unit/integration/E2E) and observability expectations.

### Phase 1 - Design & Contracts

- Define entities, validations, relationships, and lifecycle/state transitions in `data-model.md`.
- Define API boundary updates in `contracts/static-blueprint-images.openapi.yaml`.
- Define implementation + verification workflow in `quickstart.md`.
- Update agent context via `.specify/scripts/bash/update-agent-context.sh codex`.

### Phase 2 - Task Planning (next command)

- Break implementation into ordered, testable tasks mapped to contracts and data model.
- Ensure each task includes required tests and doc updates.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
