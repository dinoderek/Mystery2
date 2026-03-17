# Task Breakdown: Better Blueprints

<!-- Phase 4A output. Ordered, dependency-aware task list. -->
<!-- Each task should be completable in a single, fresh agent session. -->

## Phase 1: Blueprint V2 Foundations

### Task 1.1: Define Blueprint V2 Schema And Report Contracts

- **Spec sections**: Sections 2, 4 (Decisions 1, 2, 5, 6, 8, 10), 5, 7, 8
- **Description**: Replace the current backend-private blueprint contract with Blueprint V2, including stable authored keys, explicit public/private/visual partitions, structured evidence, and structured ground-truth timeline records. Add typed report schemas for deterministic verification and AI judge artifacts so downstream tooling and tests share one contract.
- **Input**: `sdd/specs/better-blueprints/spec.md`, `docs/architecture.md`, `docs/game.md`, `docs/project-structure.md`, `docs/testing.md`, `docs/backend-conventions.md`, `supabase/functions/_shared/blueprints/blueprint-schema.ts`
- **Output**: Updated V2 blueprint schema, report schema modules, and unit coverage for valid/invalid blueprint and report payloads.
- **Files affected**: `supabase/functions/_shared/blueprints/blueprint-schema.ts`, `supabase/functions/_shared/blueprints/verification-report.ts`, `supabase/functions/_shared/blueprints/ai-judge-report.ts`, `tests/api/unit/blueprint-v2-schema.test.ts`
- **Done when**: Blueprint V2 parsing enforces stable keys, public/private/visual separation, structured evidence/timeline fields, and both report schemas validate the required artifact shapes from the spec.
- **Quality gates**: `npm run lint`, `npm run typecheck`, `vitest run tests/api/unit/blueprint-v2-schema.test.ts`
- **Doc updates**: None
- **Depends on**: none

### Task 1.2: Rewrite Canonical Blueprints And Embedded Fixtures To V2

- **Spec sections**: Sections 3, 4 (Decisions 1, 4, 5, 8), 5, 7.4, 8
- **Description**: Rewrite the shipped local blueprints, seed blueprint, and inline test fixtures so the repository no longer depends on V1-only fields such as free-form clues, duplicated location identifiers, or culprit booleans on characters. Keep fixture stories readable, but ensure every fixture now exercises the V2 evidence, visual, and timeline shapes.
- **Input**: Task 1.1 outputs, current blueprint JSON files, existing unit/API/browser fixture objects
- **Output**: V2 canonical blueprint JSON files plus updated test fixtures that parse under the new schema.
- **Files affected**: `blueprints/birthday-cake-6yo.json`, `blueprints/missing-hamster-7yo.json`, `blueprints/spring-treats-6yo.json`, `blueprints/spring-treats-9yo.json`, `blueprints/stolen-trophy-8yo.json`, `supabase/seed/blueprints/mock-blueprint.json`, `tests/api/unit/ai-context.test.ts`, `tests/api/unit/generate-blueprint-images.test.ts`, `tests/api/e2e/image-generation-flow.test.ts`, `web/e2e/help.test.ts`, `web/e2e/status.test.ts`, `web/e2e/theme.test.ts`
- **Done when**: All repository blueprints and inline fixtures parse as Blueprint V2, and no committed fixture still references deprecated V1-only fields or name-based runtime assumptions.
- **Quality gates**: `npm run lint`, `npm run typecheck`, `vitest run tests/api/unit/ai-context.test.ts tests/api/unit/generate-blueprint-images.test.ts tests/api/e2e/image-generation-flow.test.ts`
- **Doc updates**: None
- **Depends on**: Task 1.1

## Phase 2: Runtime Rollout

### Task 2.1: Add Shared V2 Runtime Mapping Helpers And Upgrade Read/Start Endpoints

- **Spec sections**: Sections 2, 3, 4 (Decisions 1, 2, 3, 4, 8), 5, 7.4, 8
- **Description**: Introduce shared runtime helpers for resolving Blueprint V2 keys to readable names, public summaries, and spoiler-safe image references. Use those helpers to upgrade blueprint listing, image-link lookup, session start, session read, and session catalog flows so sessions persist keys internally while public API responses remain readable.
- **Input**: Tasks 1.1-1.2 outputs, current gameplay/session endpoint implementations
- **Output**: Shared V2 runtime helper module and updated read/start endpoints with matching unit/integration coverage.
- **Files affected**: `supabase/functions/_shared/blueprints/runtime.ts`, `supabase/functions/_shared/ai-context.ts`, `supabase/functions/blueprints-list/index.ts`, `supabase/functions/blueprint-image-link/index.ts`, `supabase/functions/game-start/index.ts`, `supabase/functions/game-get/index.ts`, `supabase/functions/game-sessions-list/index.ts`, `tests/api/integration/blueprints.test.ts`, `tests/api/integration/game-start.test.ts`, `tests/api/integration/game-get.test.ts`, `tests/api/integration/game-sessions-list.test.ts`
- **Done when**: Stored sessions use `location_key`/`character_key` values in the existing `current_*_id` columns, storage-loaded V2 blueprints can be listed and started successfully, and API responses still expose readable mystery titles, location names, character names, and image identifiers.
- **Quality gates**: `npm run lint`, `npm run typecheck`, `vitest run tests/api/unit/ai-context.test.ts tests/api/integration/blueprints.test.ts tests/api/integration/game-start.test.ts tests/api/integration/game-get.test.ts tests/api/integration/game-sessions-list.test.ts`
- **Doc updates**: None
- **Depends on**: Task 1.2

### Task 2.2: Refactor Explore And Talk Flows To Use V2 Keys And Evidence Records

- **Spec sections**: Sections 3, 4 (Decisions 3, 5, 6, 7, 8), 5, 7.2, 8
- **Description**: Update move, search, talk, ask, and end-talk flows to resolve locations, characters, and discoverable evidence through Blueprint V2 helper lookups instead of display-name matching and free-form clue strings. Ensure event payload diagnostics preserve both stable keys and display values where useful for debugging.
- **Input**: Tasks 1.1-1.2 outputs, Task 2.1 runtime helpers
- **Output**: V2-aware explore/talk endpoint implementations plus targeted integration and API E2E coverage.
- **Files affected**: `supabase/functions/game-move/index.ts`, `supabase/functions/game-search/index.ts`, `supabase/functions/game-talk/index.ts`, `supabase/functions/game-ask/index.ts`, `supabase/functions/game-end-talk/index.ts`, `supabase/functions/_shared/ai-context.ts`, `tests/api/integration/game-move.test.ts`, `tests/api/integration/game-search.test.ts`, `tests/api/integration/game-talk.test.ts`, `tests/api/integration/game-ask.test.ts`, `tests/api/integration/game-end-talk.test.ts`, `tests/api/e2e/game-flow.test.ts`
- **Done when**: Explore/talk flows resolve runtime state by V2 keys, evidence acquisition works across `start|move|search|talk` surfaces, readable API responses remain unchanged, and event payloads include enough key/display context to diagnose failures.
- **Quality gates**: `npm run lint`, `npm run typecheck`, `vitest run tests/api/integration/game-move.test.ts tests/api/integration/game-search.test.ts tests/api/integration/game-talk.test.ts tests/api/integration/game-ask.test.ts tests/api/integration/game-end-talk.test.ts tests/api/e2e/game-flow.test.ts`
- **Doc updates**: None
- **Depends on**: Task 2.1

### Task 2.3: Adapt Accusation And Forced-Endgame Logic To V2 Ground Truth

- **Spec sections**: Sections 3, 4 (Decisions 2, 3, 4, 5, 6, 7), 5, 7.4, 8
- **Description**: Refactor accusation and forced-endgame flows to consume Blueprint V2 culprit, evidence, explanation, and structured timeline data without introducing V1 compatibility logic. Preserve the existing public accusation UX while ensuring backend-only truth access stays private and V2-aware.
- **Input**: Tasks 1.1-1.2 outputs, Tasks 2.1-2.2 runtime changes
- **Output**: Updated accusation/state-machine logic with unit, integration, API E2E, and browser full-stack coverage for V2 sessions.
- **Files affected**: `supabase/functions/game-accuse/index.ts`, `supabase/functions/_shared/ai-provider.ts`, `supabase/functions/_shared/forced-endgame.ts`, `supabase/functions/_shared/state-machine.ts`, `tests/api/unit/state-machine.test.ts`, `tests/api/integration/game-accuse.test.ts`, `tests/api/e2e/game-flow.test.ts`, `web/e2e/full-stack.spec.ts`
- **Done when**: Accusation resolution works against V2 truth data, forced timeout transitions still function, stale V1 sessions are treated as unsupported rather than translated, and the V2 full-stack playthrough passes.
- **Quality gates**: `npm run lint`, `npm run typecheck`, `vitest run tests/api/unit/state-machine.test.ts tests/api/integration/game-accuse.test.ts tests/api/e2e/game-flow.test.ts`, `npm -w web run test:e2e -- web/e2e/full-stack.spec.ts`
- **Doc updates**: None
- **Depends on**: Task 2.2

## Phase 3: Authoring Workflow

### Task 3.1: Scaffold Draft-Run Filesystem, Diagnostics, And Npm Command Surface

- **Spec sections**: Sections 2, 4 (Decision 9), 6, 7, 8
- **Description**: Add reusable helpers for timestamped draft run directories, artifact naming, and stage diagnostics so generation, verification, and judging share one filesystem contract. Register the authoring commands in `package.json` and keep draft outputs out of version control.
- **Input**: Tasks 1.1-1.2 outputs, existing `scripts/` layout and package scripts
- **Output**: Shared draft-run helper modules, ignore rules, and npm script entrypoints for generate/verify/judge workflows.
- **Files affected**: `.gitignore`, `package.json`, `blueprints/drafts/.gitkeep`, `scripts/lib/blueprints/draft-runs.mjs`, `scripts/lib/blueprints/diagnostics.mjs`, `tests/api/unit/blueprint-draft-runs.test.ts`
- **Done when**: A shared helper can create a non-overwriting run directory under `blueprints/drafts/<slug>/<run-id>/`, standard artifact filenames are centralized, stage diagnostics include blueprint path/id and run id, and npm script placeholders exist for the workflow commands.
- **Quality gates**: `npm run lint`, `npm run typecheck`, `vitest run tests/api/unit/blueprint-draft-runs.test.ts`
- **Doc updates**: None
- **Depends on**: Task 1.2

### Task 3.2: Implement Candidate Generation CLI For Blueprint V2 Drafts

- **Spec sections**: Sections 2, 4 (Decisions 1, 2, 8, 9), 5, 6, 7.1, 8
- **Description**: Build the generation command that reads a human-authored brief, calls the model provider, validates candidate outputs against Blueprint V2, and writes candidates into the shared draft-run layout. Persist raw model output when JSON parsing fails, and never write generated candidates directly into top-level `blueprints/`.
- **Input**: Task 3.1 draft-run helpers, Task 1.1 schema/report contracts
- **Output**: Working generation CLI, updated generation prompt, and test coverage for run layout and failure handling.
- **Files affected**: `package.json`, `scripts/generate-blueprints.mjs`, `scripts/lib/blueprints/generate-blueprints.mjs`, `supabase/functions/_shared/blueprints/generator-prompt.md`, `tests/api/unit/generate-blueprints.test.ts`, `tests/api/e2e/blueprint-generation-flow.test.ts`
- **Done when**: The command copies `brief.md` into a new run directory, writes one or more `candidate-XX.blueprint.json` files on valid output, writes `candidate-XX.raw-model-output.txt` on parse failure, exits non-zero on fatal failures, and never mutates canonical blueprints.
- **Quality gates**: `npm run lint`, `npm run typecheck`, `vitest run tests/api/unit/generate-blueprints.test.ts tests/api/e2e/blueprint-generation-flow.test.ts`
- **Doc updates**: `docs/ai-runtime.md`
- **Depends on**: Task 3.1

### Task 3.3: Implement Deterministic Verification CLI And Rule Engine

- **Spec sections**: Sections 4 (Decisions 5, 6, 7, 8, 9), 5, 6, 7.2, 7.5, 8
- **Description**: Implement the offline-capable deterministic verifier, including schema checks, cross-reference checks, spoiler checks, essential solve-path validation, and the `floor(0.75 * time_budget)` action-budget rule. Emit the structured deterministic report artifact for both draft candidates and canonical blueprint paths.
- **Input**: Tasks 1.1-1.2 outputs, Task 3.1 draft-run helpers
- **Output**: Verification CLI, reusable rule engine, solve-path calculator, and report-writing test coverage.
- **Files affected**: `package.json`, `scripts/verify-blueprint.mjs`, `scripts/lib/blueprints/verify-blueprint.mjs`, `scripts/lib/blueprints/solve-path.mjs`, `tests/api/unit/verify-blueprint.test.ts`, `tests/api/e2e/blueprint-verify-flow.test.ts`
- **Done when**: Verification can run against any local blueprint path, writes one deterministic report per verified candidate/path, returns `pass|warn|fail` with rule identifiers and metrics, and exits non-zero whenever blocking findings are present.
- **Quality gates**: `npm run lint`, `npm run typecheck`, `vitest run tests/api/unit/verify-blueprint.test.ts tests/api/e2e/blueprint-verify-flow.test.ts`
- **Doc updates**: `docs/testing.md`
- **Depends on**: Task 3.1

### Task 3.4: Implement AI Judge CLI With Strict JSON Validation

- **Spec sections**: Sections 4 (Decisions 9, 10), 6, 7.3, 7.5, 8
- **Description**: Build the first-cut rubric-based AI judge command using the shared strict JSON pattern already used elsewhere in the repo. The command must validate judge output, persist one `.ai-judge-report.json` artifact on success, and fail closed on provider, timeout, or schema-validation errors.
- **Input**: Tasks 1.1-1.2 outputs, Task 3.1 draft-run helpers
- **Output**: AI judge CLI, prompt/context builder, and mocked tests for success and failure paths.
- **Files affected**: `package.json`, `scripts/judge-blueprint.mjs`, `scripts/lib/blueprints/judge-blueprint.mjs`, `scripts/lib/blueprints/judge-prompt.mjs`, `tests/api/unit/judge-blueprint.test.ts`, `tests/api/e2e/blueprint-judge-flow.test.ts`
- **Done when**: The judge command accepts a local blueprint path, validates `judge_version`, scores, findings, citations, and recommendation fields, writes a success artifact on valid output, and exits non-zero without mutating canonical blueprints on invalid JSON or provider failures.
- **Quality gates**: `npm run lint`, `npm run typecheck`, `vitest run tests/api/unit/judge-blueprint.test.ts tests/api/e2e/blueprint-judge-flow.test.ts`
- **Doc updates**: `docs/ai-runtime.md`, `docs/testing.md`
- **Depends on**: Task 3.1

### Task 3.5: Refactor Static Image Tooling To Consume Only Spoiler-Safe Visual Metadata

- **Spec sections**: Sections 3, 4 (Decisions 2, 8), 5, 8
- **Description**: Update the static image prompt builder and its CLI consumers so they derive prompts only from the new visual layer plus non-spoiler public metadata such as title and one-liner. Remove dependencies on clue-bearing descriptions, private roleplay text, motives, alibis, and ground-truth fields.
- **Input**: Tasks 1.1-1.2 outputs, current image prompt builder and image-generation tests
- **Output**: V2-aware image prompt generation with regression tests that guard against spoiler leakage.
- **Files affected**: `scripts/lib/image-prompt-builder.mjs`, `scripts/lib/image-targets.mjs`, `scripts/generate-blueprint-images.mjs`, `tests/api/unit/image-prompt-builder.test.ts`, `tests/api/unit/generate-blueprint-images.test.ts`
- **Done when**: Cover, location, and portrait prompts are generated from structured visual metadata only, and tests explicitly fail if private or clue-bearing blueprint text appears in prompt inputs.
- **Quality gates**: `npm run lint`, `npm run typecheck`, `vitest run tests/api/unit/image-prompt-builder.test.ts tests/api/unit/generate-blueprint-images.test.ts`
- **Doc updates**: `docs/ai-runtime.md`
- **Depends on**: Task 1.2

## Phase 4: Documentation And Release Readiness

### Task 4.1: Update Docs And Rollout Guidance For Blueprint V2

- **Spec sections**: Sections 2, 4 (Decisions 3, 4, 6, 9, 10), 6, 7.4, 7.5, 8
- **Description**: Update the core docs to describe the V2-only runtime, the new operator authoring workflow, the `blueprints/drafts/` layout, and the manual stale-session cleanup required after rollout. Document the expected observability fields for generate/verify/judge failures and the new test expectations for V2 runtime and authoring flows.
- **Input**: Tasks 2.1-2.3 and 3.1-3.5 outputs, current core docs
- **Output**: Synchronized runtime, workflow, testing, and project-structure documentation for Blueprint V2.
- **Files affected**: `docs/architecture.md`, `docs/game.md`, `docs/project-structure.md`, `docs/testing.md`, `docs/backend-conventions.md`, `docs/ai-runtime.md`
- **Done when**: The docs describe Blueprint V2 layering, key-based runtime storage, authoring commands, deterministic-vs-AI review expectations, observability requirements, `blueprints/drafts/` behavior, and manual cleanup of stale V1-backed sessions/events.
- **Quality gates**: Manual validation of commands, paths, and cross-document consistency against `package.json`, `scripts/`, and `supabase/functions/`
- **Doc updates**: The files listed in this task
- **Depends on**: Task 2.3, Task 3.2, Task 3.3, Task 3.4, Task 3.5

### Task 4.2: Run Full Regression Suite And Fix Remaining Rollout Gaps

- **Spec sections**: Sections 2, 7, 8
- **Description**: Run the full repository quality bar after the V2 runtime, tooling, fixtures, and documentation are in place. Fix any remaining issues surfaced by linting, type checking, unit tests, integration tests, API E2E tests, or browser E2E tests before considering the feature ready.
- **Input**: All prior tasks completed
- **Output**: Verified green quality gates, or explicitly documented blockers if a gate cannot yet pass.
- **Files affected**: No planned files; fix-forward touches are limited to files surfaced by the gate run
- **Done when**: `npm run lint`, `npm run typecheck`, `npm -w web run check`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, and `npm -w web run test:e2e` all pass, or any unavoidable failures are documented with concrete follow-up.
- **Quality gates**: `npm run lint`, `npm run typecheck`, `npm -w web run check`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, `npm -w web run test:e2e`
- **Doc updates**: None unless the gate run exposes stale commands or missing operator guidance
- **Depends on**: Task 4.1

---

## Execution Notes

- Run each task in a fresh agent session with `spec.md` + the task description
- After each task: verify the "done when" condition, run the listed quality gates, and commit
- If a task surfaces a blocker not covered by the spec, stop and update the spec before continuing
- The main parallel split after Phase 2 is: Task 3.3 and Task 3.4 can proceed in parallel once Task 3.1 is complete; Task 3.5 can proceed independently after Task 1.2
- Do not add V1/V2 compatibility layers for sessions or events; document manual stale-data cleanup instead
