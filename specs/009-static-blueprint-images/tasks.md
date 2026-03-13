# Tasks: Static Blueprint Images

**Input**: Design documents from `/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/`  
**Prerequisites**: `/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/plan.md`, `/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/spec.md`, `/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/research.md`, `/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/data-model.md`, `/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/contracts/static-blueprint-images.openapi.yaml`

**Tests**: Unit + Integration + API E2E + browser E2E are required by the feature spec and repository testing strategy.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: User story label (`[US1]`, `[US2]`, `[US3]`) for story-phase tasks only
- Every task includes exact file path(s)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold shared image modules and operator tooling entrypoints used across stories.

- [X] T001 Create shared image utility module scaffold in /Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/images.ts
- [X] T002 [P] Create frontend image API client scaffold in /Users/dinohughes/Projects/my2/w1/web/src/lib/api/images.ts
- [X] T003 [P] Create operator prompt builder module scaffold in /Users/dinohughes/Projects/my2/w1/scripts/lib/image-prompt-builder.mjs
- [X] T004 [P] Create generation CLI entrypoint scaffold in /Users/dinohughes/Projects/my2/w1/scripts/generate-blueprint-images.mjs

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Complete contract/schema/storage foundations required before any user story implementation.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [X] T005 Extend blueprint schema with optional visual fields (`art_style`, blueprint/character/location image IDs) in /Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/blueprints/blueprint-schema.ts
- [X] T006 [P] Extend shared API contracts with image ID fields and image-link request/response schemas in /Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts
- [X] T007 [P] Implement canonical image ID validation and signed-link TTL helpers in /Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/images.ts
- [X] T008 Create storage/RLS migration for private image bucket policies in /Users/dinohughes/Projects/my2/w1/supabase/migrations/0005_blueprint_images_storage.sql
- [X] T009 [P] Add/extend unit coverage for shared image contracts in /Users/dinohughes/Projects/my2/w1/tests/api/unit/mystery-api-contracts.test.ts
- [X] T010 [P] Add unit coverage for image helper rules (ID format, expiry window, error mapping) in /Users/dinohughes/Projects/my2/w1/tests/api/unit/image-assets.test.ts
- [X] T011 Align feature contract doc with finalized boundary fields in /Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/contracts/static-blueprint-images.openapi.yaml

**Checkpoint**: Shared schemas, storage policy baseline, and helper/test foundations are complete.

---

## Phase 3: User Story 1 - View Story Images In Gameplay (Priority: P1) 🎯 MVP

**Goal**: Authenticated players see blueprint/location/character imagery in the UI with secure access and placeholder fallback on fetch failure.

**Independent Test**: In one authenticated flow, verify blueprint list image, `move to` location image, `talk to` portrait image, link-expiry recovery, and placeholder fallback without blocking narration.

### Tests for User Story 1

- [X] T012 [P] [US1] Add integration assertions for blueprint list image metadata in /Users/dinohughes/Projects/my2/w1/tests/api/integration/blueprints.test.ts
- [X] T013 [P] [US1] Add integration assertions for `location_image_id` and `character_portrait_image_id` in /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-move.test.ts and /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-talk.test.ts
- [X] T014 [P] [US1] Add integration auth/expiry/error-path coverage for image-link issuance in /Users/dinohughes/Projects/my2/w1/tests/api/integration/auth-rejection.test.ts and /Users/dinohughes/Projects/my2/w1/tests/api/integration/cors-preflight.test.ts
- [X] T015 [P] [US1] Add browser E2E coverage for blueprint, move, talk image rendering + placeholder fallback in /Users/dinohughes/Projects/my2/w1/web/e2e/start.test.ts and /Users/dinohughes/Projects/my2/w1/web/e2e/input.test.ts and /Users/dinohughes/Projects/my2/w1/web/e2e/narration.test.ts

### Implementation for User Story 1

- [X] T016 [US1] Implement authenticated image-link endpoint handler in /Users/dinohughes/Projects/my2/w1/supabase/functions/blueprint-image-link/index.ts
- [X] T017 [P] [US1] Expose optional blueprint image IDs from blueprint listing endpoint in /Users/dinohughes/Projects/my2/w1/supabase/functions/blueprints-list/index.ts
- [X] T018 [P] [US1] Expose optional location image IDs in move response payloads in /Users/dinohughes/Projects/my2/w1/supabase/functions/game-move/index.ts
- [X] T019 [P] [US1] Expose optional character portrait IDs in talk response payloads in /Users/dinohughes/Projects/my2/w1/supabase/functions/game-talk/index.ts
- [X] T020 [US1] Implement frontend image-link fetch + refresh-on-expiry logic in /Users/dinohughes/Projects/my2/w1/web/src/lib/api/images.ts and /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.retry.ts
- [X] T021 [US1] Extend frontend game state types with optional image reference fields in /Users/dinohughes/Projects/my2/w1/web/src/lib/types/game.ts
- [X] T022 [US1] Integrate image reference handling into session store flow in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts
- [X] T023 [US1] Add reusable narration-side image component with placeholder mode in /Users/dinohughes/Projects/my2/w1/web/src/lib/components/StoryImagePanel.svelte
- [X] T024 [US1] Render blueprint selection images on start page using authenticated links in /Users/dinohughes/Projects/my2/w1/web/src/routes/+page.svelte
- [X] T025 [US1] Render move/talk side imagery in session screen using StoryImagePanel in /Users/dinohughes/Projects/my2/w1/web/src/routes/session/+page.svelte and /Users/dinohughes/Projects/my2/w1/web/src/lib/components/NarrationBox.svelte
- [X] T026 [US1] Apply tokenized (`t-*`) styling updates for image/placeholder blocks in /Users/dinohughes/Projects/my2/w1/web/src/routes/layout.css and /Users/dinohughes/Projects/my2/w1/web/src/lib/components/TerminalMessage.svelte

**Checkpoint**: US1 is independently functional and testable as MVP.

---

## Phase 4: User Story 2 - Generate Blueprint Image Set Locally (Priority: P2)

**Goal**: Operators can generate selected image targets locally, using blueprint style/direction and deterministic prompt generation, with selective blueprint patching.

**Independent Test**: Run generation for `all` and selective targets; verify output files are created, successful targets are patched, failed targets retain prior references, and model/output options are respected.

### Tests for User Story 2

- [X] T027 [P] [US2] Add unit tests for prompt-template generation by target type in /Users/dinohughes/Projects/my2/w1/tests/api/unit/image-prompt-builder.test.ts
- [X] T028 [P] [US2] Add unit tests for generation CLI argument parsing and target selection in /Users/dinohughes/Projects/my2/w1/tests/api/unit/generate-blueprint-images.test.ts
- [X] T029 [P] [US2] Add API E2E-style script validation for selective patch + partial failure behavior in /Users/dinohughes/Projects/my2/w1/tests/api/e2e/image-generation-flow.test.ts

### Implementation for User Story 2

- [X] T030 [US2] Implement deterministic prompt builder (style block, target block, guardrails, output block) in /Users/dinohughes/Projects/my2/w1/scripts/lib/image-prompt-builder.mjs
- [X] T031 [US2] Implement OpenRouter-backed generation runner and output writing in /Users/dinohughes/Projects/my2/w1/scripts/generate-blueprint-images.mjs
- [X] T032 [US2] Implement blueprint patching for successful targets only in /Users/dinohughes/Projects/my2/w1/scripts/lib/patch-blueprint-images.mjs
- [X] T033 [US2] Add generation target resolution helpers (all/blueprint/characters/locations) in /Users/dinohughes/Projects/my2/w1/scripts/lib/image-targets.mjs
- [X] T034 [US2] Add default ignore rules for generated asset directories in /Users/dinohughes/Projects/my2/w1/.gitignore
- [X] T035 [US2] Add generation command entry in /Users/dinohughes/Projects/my2/w1/package.json

**Checkpoint**: US2 is independently functional and testable.

---

## Phase 5: User Story 3 - Deploy Blueprints And Images Together (Priority: P3)

**Goal**: Operators deploy blueprint JSON plus referenced images in one workflow with warning manifests for missing/failed image uploads and successful blueprint deploy fallback.

**Independent Test**: Run deployment with complete image set, no image set, and partially missing image set; verify manifest counts and successful blueprint availability in all cases.

### Tests for User Story 3

- [X] T036 [P] [US3] Extend deploy helper unit tests for image upload planning and missing-asset warnings in /Users/dinohughes/Projects/my2/w1/tests/api/unit/deploy-helpers.test.ts
- [X] T037 [P] [US3] Add integration deployment smoke test for optional/missing image behavior in /Users/dinohughes/Projects/my2/w1/tests/api/integration/blueprints-image-deploy.test.ts

### Implementation for User Story 3

- [X] T038 [US3] Extend deploy plan assembly with image upload steps and warning manifest plumbing in /Users/dinohughes/Projects/my2/w1/scripts/deploy-helpers.mjs
- [X] T039 [US3] Implement blueprint+image deploy execution and reporting in /Users/dinohughes/Projects/my2/w1/scripts/deploy.mjs
- [X] T040 [US3] Extend storage seeding logic to support image asset sync modes for deploy/test harnesses in /Users/dinohughes/Projects/my2/w1/scripts/seed-storage.mjs and /Users/dinohughes/Projects/my2/w1/scripts/seed-storage.ts
- [X] T041 [US3] Add reusable image manifest builder/parser utilities in /Users/dinohughes/Projects/my2/w1/scripts/lib/blueprint-image-manifest.mjs
- [X] T042 [US3] Add deployment CLI flags for image directory + missing-image policy in /Users/dinohughes/Projects/my2/w1/scripts/deploy.mjs and /Users/dinohughes/Projects/my2/w1/scripts/supabase-utils.mjs

**Checkpoint**: US3 is independently functional and testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Complete doc sync, component inventory updates, and full quality-gate validation.

- [X] T043 [P] Update architecture and structure docs for static image serving/generation/deploy flows in /Users/dinohughes/Projects/my2/w1/docs/architecture.md and /Users/dinohughes/Projects/my2/w1/docs/project-structure.md
- [X] T044 [P] Update gameplay/testing docs for image rendering fallback and coverage expectations in /Users/dinohughes/Projects/my2/w1/docs/game.md and /Users/dinohughes/Projects/my2/w1/docs/testing.md
- [X] T045 [P] Update reusable UI component inventory for StoryImagePanel and related props in /Users/dinohughes/Projects/my2/w1/docs/component-inventory.md
- [X] T046 [P] Sync finalized contract decisions in /Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/contracts/static-blueprint-images.openapi.yaml and /Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts
- [X] T047 Run full quality gates (`lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `web e2e`) via /Users/dinohughes/Projects/my2/w1/package.json scripts
- [X] T048 Validate end-to-end runbook commands and checkpoints in /Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies.
- **Phase 2 (Foundational)**: Depends on Phase 1 completion and blocks all user story work.
- **Phase 3 (US1)**: Depends on Phase 2 completion.
- **Phase 4 (US2)**: Depends on Phase 2 completion; independent from US1 implementation details.
- **Phase 5 (US3)**: Depends on Phase 2 completion; can run independently of US1/US2 but scheduled after them by product priority.
- **Phase 6 (Polish)**: Depends on all selected user stories being complete.

### User Story Dependency Graph

```text
Setup -> Foundational -> US1 -> US2 -> US3 -> Polish
```

### User Story Dependencies

- **US1 (P1)**: Starts after Foundational; no dependency on US2/US3.
- **US2 (P2)**: Starts after Foundational; no dependency on US1/US3.
- **US3 (P3)**: Starts after Foundational; no dependency on US1/US2.

### Parallel Opportunities

- Foundational: T006, T007, T009, T010 can run in parallel.
- US1 tests: T012, T013, T014, T015 can run in parallel.
- US1 backend implementation: T017, T018, T019 can run in parallel.
- US2 tests: T027, T028, T029 can run in parallel.
- US3 tests: T036, T037 can run in parallel.
- Polish docs: T043, T044, T045, T046 can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Parallel tests for US1
Task: T012 tests/api/integration/blueprints.test.ts
Task: T013 tests/api/integration/game-move.test.ts + tests/api/integration/game-talk.test.ts
Task: T014 tests/api/integration/auth-rejection.test.ts + tests/api/integration/cors-preflight.test.ts
Task: T015 web/e2e/start.test.ts + web/e2e/input.test.ts + web/e2e/narration.test.ts

# Parallel backend implementation for US1
Task: T017 supabase/functions/blueprints-list/index.ts
Task: T018 supabase/functions/game-move/index.ts
Task: T019 supabase/functions/game-talk/index.ts
```

## Parallel Example: User Story 2

```bash
# Parallel tests for US2
Task: T027 tests/api/unit/image-prompt-builder.test.ts
Task: T028 tests/api/unit/generate-blueprint-images.test.ts
Task: T029 tests/api/e2e/image-generation-flow.test.ts

# Parallel implementation work for US2
Task: T032 scripts/lib/patch-blueprint-images.mjs
Task: T033 scripts/lib/image-targets.mjs
Task: T034 .gitignore
```

## Parallel Example: User Story 3

```bash
# Parallel tests for US3
Task: T036 tests/api/unit/deploy-helpers.test.ts
Task: T037 tests/api/integration/blueprints-image-deploy.test.ts

# Parallel implementation work for US3
Task: T040 scripts/seed-storage.mjs + scripts/seed-storage.ts
Task: T041 scripts/lib/blueprint-image-manifest.mjs
Task: T042 scripts/deploy.mjs + scripts/supabase-utils.mjs
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. Validate US1 independently with integration + browser E2E checks.
4. Demo/release MVP with secure authenticated image viewing.

### Incremental Delivery

1. Deliver US1 (player-facing secure rendering).
2. Deliver US2 (operator generation + patching).
3. Deliver US3 (operator deployment extension).
4. Complete Phase 6 polish and full quality-gate validation.

### Parallel Team Strategy

1. Team completes Setup and Foundational phases together.
2. After Foundational completion:
   - Developer A: US1 (UI + image-link endpoint)
   - Developer B: US2 (generation tooling)
   - Developer C: US3 (deployment extension)
3. Rejoin for cross-cutting polish and full-gate run.

---

## Notes

- All tasks follow strict checklist format with task ID, optional `[P]`, optional `[US#]`, and exact file paths.
- Story labels are used only in user story phases.
- Each story has independent test criteria and dedicated test tasks.
- Keep implementation aligned with signed URL auth model and optional-image backward compatibility requirements.
