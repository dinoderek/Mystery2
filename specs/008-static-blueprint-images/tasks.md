# Tasks: Static Blueprint Images

**Input**: Design documents from `/Users/dinohughes/Projects/my2/w1/specs/008-static-blueprint-images/`
**Prerequisites**: `/Users/dinohughes/Projects/my2/w1/specs/008-static-blueprint-images/plan.md`, `/Users/dinohughes/Projects/my2/w1/specs/008-static-blueprint-images/spec.md`, `/Users/dinohughes/Projects/my2/w1/specs/008-static-blueprint-images/research.md`, `/Users/dinohughes/Projects/my2/w1/specs/008-static-blueprint-images/data-model.md`, `/Users/dinohughes/Projects/my2/w1/specs/008-static-blueprint-images/contracts/static-blueprint-images.openapi.yaml`, `/Users/dinohughes/Projects/my2/w1/specs/008-static-blueprint-images/quickstart.md`

**Tests**: Unit, Integration, API E2E, and browser E2E tasks are included because E2E is mandatory and the feature docs require secure behavior validation.

**Organization**: Tasks are grouped by user story so each story is independently implementable and independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable task (different files, no blocking dependency)
- **[Story]**: User story label (`[US1]`, `[US2]`, `[US3]`) for story-phase tasks only
- All tasks include explicit absolute file paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add feature scaffolding and shared utility entry points.

- [ ] T001 Create image storage helper scaffold in /Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/image-storage.ts
- [ ] T002 [P] Create generation utility scaffold in /Users/dinohughes/Projects/my2/w1/scripts/generate-blueprint-images.mjs
- [ ] T003 [P] Create deployment utility scaffold in /Users/dinohughes/Projects/my2/w1/scripts/deploy-blueprint-images.mjs
- [ ] T004 [P] Add image-focused blueprint fixture for tests in /Users/dinohughes/Projects/my2/w1/supabase/seed/blueprints/mock-blueprint-images.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contract, schema, and policy updates required before any story work.

**⚠️ CRITICAL**: No user story implementation starts before this phase is complete.

- [ ] T005 Extend blueprint schema with optional visual profile and image references in /Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/blueprints/blueprint-schema.ts
- [ ] T006 [P] Extend shared API contracts for image-aware blueprint summaries, game state image fields, resolver payloads, and operator request/response shapes in /Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts
- [ ] T007 [P] Extend frontend game types for optional cover, portrait, and location image IDs in /Users/dinohughes/Projects/my2/w1/web/src/lib/types/game.ts
- [ ] T008 Add image ID validation utilities shared by functions and scripts in /Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/image-storage.ts and /Users/dinohughes/Projects/my2/w1/scripts/lib/image-storage.mjs
- [ ] T009 Create storage migration for private image bucket access policies and signed URL support in /Users/dinohughes/Projects/my2/w1/supabase/migrations/0007_blueprint_images_storage.sql
- [ ] T010 [P] Add foundational contract/schema tests for optional image fields and image ID validation in /Users/dinohughes/Projects/my2/w1/tests/api/unit/mystery-api-contracts.image.test.ts

**Checkpoint**: Foundation is ready; user stories can proceed.

---

## Phase 3: User Story 1 - View Illustrated Mystery Content (Priority: P1) 🎯 MVP

**Goal**: Signed-in players can see blueprint, character, and location images when present, with graceful fallback when missing.

**Independent Test**: Start from `/`, open a mystery, and verify cover/portrait/location images render when mapped; verify image-free or missing-image cases show no broken placeholders and gameplay remains usable.

### Tests for User Story 1

- [ ] T011 [P] [US1] Add integration coverage for optional `image_id` in blueprint list responses in /Users/dinohughes/Projects/my2/w1/tests/api/integration/blueprints-list-images.test.ts
- [ ] T012 [P] [US1] Add integration coverage for image-aware game state payloads in /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-start-images.test.ts and /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-get-images.test.ts
- [ ] T013 [P] [US1] Add browser E2E coverage for image rendering and no-image fallback in /Users/dinohughes/Projects/my2/w1/web/e2e/blueprint-images.spec.ts

### Implementation for User Story 1

- [ ] T014 [US1] Return optional blueprint cover image references from list endpoint in /Users/dinohughes/Projects/my2/w1/supabase/functions/blueprints-list/index.ts
- [ ] T015 [US1] Return optional character/location image references from game state endpoints in /Users/dinohughes/Projects/my2/w1/supabase/functions/game-start/index.ts and /Users/dinohughes/Projects/my2/w1/supabase/functions/game-get/index.ts
- [ ] T016 [US1] Implement authenticated image resolver endpoint with signed URL responses in /Users/dinohughes/Projects/my2/w1/supabase/functions/image-resolve/index.ts
- [ ] T017 [US1] Add in-session image resolve cache and URL expiry refresh logic in /Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts
- [ ] T018 [US1] Render optional blueprint cover images with graceful fallback in /Users/dinohughes/Projects/my2/w1/web/src/routes/+page.svelte
- [ ] T019 [US1] Render optional portrait/location visuals with graceful fallback in /Users/dinohughes/Projects/my2/w1/web/src/routes/session/+page.svelte

**Checkpoint**: User Story 1 is independently functional and testable.

---

## Phase 4: User Story 2 - Generate Blueprint Image Set (Priority: P2)

**Goal**: Operators can generate one target or all targets, patch image mappings, regenerate existing targets, and recover from patch failures via known filenames.

**Independent Test**: Run generation utility in `single` and `all` modes on a blueprint, verify patch behavior and overwrite behavior, and verify failure output includes filename-based recovery hints.

### Tests for User Story 2

- [ ] T020 [P] [US2] Add unit coverage for generation target selection and overwrite behavior in /Users/dinohughes/Projects/my2/w1/tests/api/unit/generate-blueprint-images.test.ts
- [ ] T021 [P] [US2] Add integration coverage for single/all generation outputs and recovery hints in /Users/dinohughes/Projects/my2/w1/tests/api/integration/blueprint-images-generate.test.ts
- [ ] T022 [P] [US2] Add API E2E operator flow coverage for generation modes in /Users/dinohughes/Projects/my2/w1/tests/api/e2e/blueprint-image-generation-flow.test.ts

### Implementation for User Story 2

- [ ] T023 [US2] Build blueprint-to-image prompt context utilities from visual profile and target metadata in /Users/dinohughes/Projects/my2/w1/scripts/lib/blueprint-image-prompts.mjs
- [ ] T024 [US2] Implement single/all generation workflow with patching and overwrite support in /Users/dinohughes/Projects/my2/w1/scripts/generate-blueprint-images.mjs
- [ ] T025 [US2] Add filename-based patch recovery output for failed updates in /Users/dinohughes/Projects/my2/w1/scripts/generate-blueprint-images.mjs
- [ ] T026 [US2] Add support for out-of-repo generation output directories in /Users/dinohughes/Projects/my2/w1/scripts/generate-blueprint-images.mjs
- [ ] T027 [US2] Implement authenticated generation endpoint matching contract in /Users/dinohughes/Projects/my2/w1/supabase/functions/blueprint-images-generate/index.ts

**Checkpoint**: User Story 2 is independently functional and testable.

---

## Phase 5: User Story 3 - Securely Publish and Serve Images (Priority: P3)

**Goal**: Operators can deploy blueprint+image bundles safely, authenticated image access is enforced, and image-free blueprints remain valid.

**Independent Test**: Deploy a blueprint with and without images, resolve images while authenticated, verify unauthenticated resolve requests are rejected, and verify out-of-repo image source directory works.

### Tests for User Story 3

- [ ] T028 [P] [US3] Add integration tests for resolver auth rejection and missing-image responses in /Users/dinohughes/Projects/my2/w1/tests/api/integration/image-resolve-auth.test.ts
- [ ] T029 [P] [US3] Add integration tests for deployment validation with image-free and missing-reference blueprints in /Users/dinohughes/Projects/my2/w1/tests/api/integration/blueprint-images-deploy.test.ts
- [ ] T030 [P] [US3] Add API E2E coverage for out-of-repo image source deployment flow in /Users/dinohughes/Projects/my2/w1/tests/api/e2e/blueprint-image-deploy-flow.test.ts

### Implementation for User Story 3

- [ ] T031 [US3] Implement deployment utility for blueprint+image publish with `--image-source-dir` absolute path support in /Users/dinohughes/Projects/my2/w1/scripts/deploy-blueprint-images.mjs
- [ ] T032 [US3] Implement deployment validation rules that allow blueprints with no image refs and fail only on invalid referenced IDs in /Users/dinohughes/Projects/my2/w1/scripts/deploy-blueprint-images.mjs
- [ ] T033 [US3] Implement authenticated deployment endpoint matching contract in /Users/dinohughes/Projects/my2/w1/supabase/functions/blueprint-images-deploy/index.ts
- [ ] T034 [US3] Integrate blueprint image deployment utility into deploy orchestration paths in /Users/dinohughes/Projects/my2/w1/scripts/deploy.mjs and /Users/dinohughes/Projects/my2/w1/scripts/deploy-helpers.mjs
- [ ] T035 [US3] Harden authenticated resolver behavior for missing session and expired session cases in /Users/dinohughes/Projects/my2/w1/supabase/functions/image-resolve/index.ts

**Checkpoint**: User Story 3 is independently functional and testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final documentation updates, validation, and quality gates.

- [ ] T036 [P] Update architecture documentation for static image serving and operator pipelines in /Users/dinohughes/Projects/my2/w1/docs/architecture.md
- [ ] T037 [P] Update gameplay documentation for optional visual fields and graceful missing-image behavior in /Users/dinohughes/Projects/my2/w1/docs/game.md
- [ ] T038 [P] Update project structure documentation for new scripts/functions in /Users/dinohughes/Projects/my2/w1/docs/project-structure.md
- [ ] T039 [P] Update testing strategy documentation for image resolver, generation, and deployment coverage in /Users/dinohughes/Projects/my2/w1/docs/testing.md
- [ ] T040 [P] Update component inventory for any new reusable image rendering components in /Users/dinohughes/Projects/my2/w1/docs/component-inventory.md
- [ ] T041 Validate and refresh implementation steps in /Users/dinohughes/Projects/my2/w1/specs/008-static-blueprint-images/quickstart.md
- [ ] T042 Run full quality gates via /Users/dinohughes/Projects/my2/w1/package.json using `npm run test:all`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies.
- **Phase 2 (Foundational)**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 (US1)**: Depends on Phase 2.
- **Phase 4 (US2)**: Depends on Phase 2 (can run after Phase 3 by priority, or in parallel if staffed).
- **Phase 5 (US3)**: Depends on Phase 2 and on T016 resolver baseline from US1.
- **Phase 6 (Polish)**: Depends on completion of all targeted stories.

### User Story Dependency Graph

```text
Setup -> Foundational -> US1 -> US2 -> US3 -> Polish
```

### Within Each User Story

- Write tests first and confirm they fail before implementation.
- Implement data/contracts before endpoint/store/UI wiring.
- Complete each story checkpoint before marking the story done.

### Parallel Opportunities

- Setup: T002, T003, T004 can run in parallel.
- Foundational: T006, T007, T010 can run in parallel.
- US1: T011, T012, T013 can run in parallel; T018 and T019 can run in parallel after T017.
- US2: T020, T021, T022 can run in parallel.
- US3: T028, T029, T030 can run in parallel.
- Polish: T036, T037, T038, T039, T040 can run in parallel.

---

## Parallel Example: User Story 1

```bash
Task: "T011 [US1] /Users/dinohughes/Projects/my2/w1/tests/api/integration/blueprints-list-images.test.ts"
Task: "T012 [US1] /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-start-images.test.ts and /Users/dinohughes/Projects/my2/w1/tests/api/integration/game-get-images.test.ts"
Task: "T013 [US1] /Users/dinohughes/Projects/my2/w1/web/e2e/blueprint-images.spec.ts"
```

## Parallel Example: User Story 2

```bash
Task: "T020 [US2] /Users/dinohughes/Projects/my2/w1/tests/api/unit/generate-blueprint-images.test.ts"
Task: "T021 [US2] /Users/dinohughes/Projects/my2/w1/tests/api/integration/blueprint-images-generate.test.ts"
Task: "T022 [US2] /Users/dinohughes/Projects/my2/w1/tests/api/e2e/blueprint-image-generation-flow.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "T028 [US3] /Users/dinohughes/Projects/my2/w1/tests/api/integration/image-resolve-auth.test.ts"
Task: "T029 [US3] /Users/dinohughes/Projects/my2/w1/tests/api/integration/blueprint-images-deploy.test.ts"
Task: "T030 [US3] /Users/dinohughes/Projects/my2/w1/tests/api/e2e/blueprint-image-deploy-flow.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. Validate US1 independently with T011-T013.
4. Demo/release MVP with optional static image rendering.

### Incremental Delivery

1. Foundation complete (Phase 1 + 2).
2. Deliver US1 (player-facing visuals).
3. Deliver US2 (operator generation utility).
4. Deliver US3 (secure deployment + auth hardening).
5. Finish with Phase 6 polish and full quality gates.

### Parallel Team Strategy

1. Team completes Phase 1 and Phase 2 together.
2. After foundation:
   - Developer A: US1 endpoint/store/UI rendering
   - Developer B: US2 generation utility + endpoint
   - Developer C: US3 deployment utility + auth hardening
3. Rejoin for documentation and full-gate validation.

---

## Notes

- Every task follows the checklist format: checkbox, Task ID, optional `[P]`, required `[US#]` label in story phases, and absolute file path.
- Story phases are independently testable at their checkpoints.
- Out-of-repo image source support is explicitly included (T026, T031).
- Missing-image graceful behavior is explicitly included (T019, T032, T035).
