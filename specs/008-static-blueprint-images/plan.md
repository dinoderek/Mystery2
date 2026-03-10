# Implementation Plan: Static Blueprint Images

**Branch**: `008-static-blueprint-images` | **Date**: 2026-03-10 | **Spec**: [/Users/dinohughes/Projects/my2/w1/specs/008-static-blueprint-images/spec.md](/Users/dinohughes/Projects/my2/w1/specs/008-static-blueprint-images/spec.md)
**Input**: Feature specification from `/Users/dinohughes/Projects/my2/w1/specs/008-static-blueprint-images/spec.md`

## Summary

Add static, blueprint-authored visuals (mystery cover, character portraits, and location images) with authenticated browser delivery, optional image mappings (including image-free blueprints), operator utilities for single/all image generation, and deployment tooling that publishes blueprints and images together with validation.

## Technical Context

**Language/Version**: TypeScript 5.x (web/shared/scripts), TypeScript on Deno runtime (Supabase Edge Functions)  
**Primary Dependencies**: SvelteKit, Supabase JS client v2, Supabase Edge Functions, Supabase Storage, Zod, Vitest, Playwright, OpenRouter HTTP API profiles  
**Storage**: Supabase Storage `blueprints` bucket (blueprint JSON) + private image bucket for blueprint images; Supabase Postgres session/event tables unchanged for this feature  
**Testing**: Vitest unit/integration/API-E2E (`/Users/dinohughes/Projects/my2/w1/tests/api`), Playwright browser E2E (`/Users/dinohughes/Projects/my2/w1/web/e2e`)  
**Target Platform**: Static SvelteKit frontend on Cloudflare Pages + Supabase backend (Auth, Storage, Edge Functions)  
**Project Type**: Web application monorepo (frontend + serverless backend + shared contracts + CLI utilities)  
**Performance Goals**: >=95% authenticated image renders complete within 2 seconds; no gameplay blocking when images are missing  
**Constraints**: Auth required for image access; image fields remain optional; blueprints without images remain valid; duplicate regeneration is allowed; dynamic on-the-fly per-action generation is explicitly out of scope  
**Scale/Scope**: Blueprint schema updates, shared contract updates, 2-3 new backend endpoints/utilities, deploy/seed tooling updates, and full doc/test-plan coverage

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Documentation reviewed and lean? (`/Users/dinohughes/Projects/my2/w1/docs/architecture.md`, `/Users/dinohughes/Projects/my2/w1/docs/game.md`, `/Users/dinohughes/Projects/my2/w1/docs/project-structure.md`, `/Users/dinohughes/Projects/my2/w1/docs/testing.md`)
- [x] Testing strategy includes E2E (mandatory) and Unit/Integration? (unit + integration + API E2E + browser E2E coverage planned)
- [x] Quality gates runnable? (`npm run test:all` remains the final gate)
- [x] Static UI + Supabase backend constraints respected? (no browser secrets, auth-enforced image access, Edge Functions for secure serving)
- [x] Context-specific conventions applied? (`/Users/dinohughes/Projects/my2/w1/docs/backend-conventions.md`, `/Users/dinohughes/Projects/my2/w1/docs/component-inventory.md`, `/Users/dinohughes/Projects/my2/w1/docs/screen-navigation.md`, `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/blueprints/blueprint-schema.ts`)

**Post-design re-check**: PASS. Phase 0/1 artifacts keep contract-first boundaries, preserve static UI + Supabase architecture, keep auth as mandatory on image fetches, and define E2E/unit/integration verification.

## Project Structure

### Documentation (this feature)

```text
/Users/dinohughes/Projects/my2/w1/specs/008-static-blueprint-images/
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
│           └── mystery-api-contracts.ts                # extend image-aware API boundary schemas
├── supabase/
│   ├── functions/
│   │   ├── _shared/
│   │   │   └── blueprints/blueprint-schema.ts          # add optional style/image fields
│   │   ├── blueprints-list/index.ts                    # include optional blueprint cover image id
│   │   ├── game-start/index.ts                         # expose image-aware world summaries
│   │   ├── game-get/index.ts                           # expose image-aware world summaries
│   │   └── image-resolve/index.ts                      # new authenticated image resolver endpoint
│   └── migrations/                                     # only if bucket/policy SQL changes are needed
├── scripts/
│   ├── generate-blueprint-images.mjs                   # new operator generation utility
│   ├── deploy-blueprint-images.mjs                     # new blueprint+image deployment utility
│   ├── seed-storage.mjs                                # optional extension for image assets
│   └── deploy.mjs                                      # optional integration into deployment flow
├── web/
│   └── src/
│       ├── lib/
│       │   ├── domain/store.svelte.ts                 # image URL resolution + local cache
│       │   └── types/game.ts                          # image-aware blueprint/world types
│       ├── routes/+page.svelte                        # blueprint cover rendering
│       └── routes/session/+page.svelte                # narration-aligned portrait/location rendering
├── tests/
│   └── api/
│       ├── integration/                               # auth + image resolver + utility behavior
│       └── e2e/                                       # API E2E for generation/deploy flows
└── web/e2e/                                           # browser E2E for rendering/fallback/auth denial
```

**Structure Decision**: Keep the current monorepo boundaries and extend existing blueprint/list/session flows rather than introducing a new service. Add one secure image-resolver edge function and two operator scripts, while preserving the contract-first pattern in `/Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts`.

## Phase Plan

### Phase 0 - Research

- Finalize `ImageID` format and optional blueprint field strategy.
- Choose authenticated serving mechanism and cache strategy for browser rendering.
- Choose generation/deployment utility boundaries and failure-recovery behavior (including filename-based remapping).
- Confirm testing strategy that covers unit, integration, API E2E, and browser E2E without live AI dependencies.

### Phase 1 - Design & Contracts

- Produce `data-model.md` covering blueprint style/image fields, image assets, generation jobs, and deployment bundles.
- Produce REST contract in `contracts/static-blueprint-images.openapi.yaml` covering list/render/generate/deploy flows.
- Produce `quickstart.md` with local execution path for generation, deploy, and verification.
- Update agent context via `.specify/scripts/bash/update-agent-context.sh codex`.

### Phase 2 - Task Planning (stop point for this command)

- `/speckit.tasks` will translate these artifacts into ordered implementation tasks.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
