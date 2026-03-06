# Tasks: Web UI Command Parser

**Input**: Design documents from `/specs/003-webui-command-parser/`  
**Branch**: `003-webui-command-parser`  
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/parser-contract.md ✅

**Tests**: E2E (Playwright) is MANDATORY. Unit tests (Vitest) are required for the parser domain logic.

**Organization**: Tasks grouped by user story. US1+US2 are P1; US3+US4 are P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Wire up Vitest unit tests in the web workspace so parser tests can run.

- [ ] T001 Add `vitest` dev dependency to `web/package.json`
- [ ] T002 Update `test:unit` script in `web/package.json` from `echo 'No unit tests yet'` to `vitest run src/lib/domain`

**Checkpoint**: `npm -w web run test:unit` runs (exits 0 with no test files yet).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Introduce the `ParseResult` type and `ParseContext`, and the `normalize()` helper — all downstream tasks depend on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Define the `ParseContext` interface and the `ParseResult` discriminated union type (replacing `ActionCommand` as the return type of `parseCommand`) in `web/src/lib/domain/parser.ts` — see `contracts/parser-contract.md` for the exact type shapes
- [ ] T004 Implement `normalize(input: string): string` helper in `web/src/lib/domain/parser.ts` — trim, lowercase, collapse internal whitespace, strip trailing `! ? . ,`
- [ ] T005 [P] Create `web/src/lib/domain/parser.test.ts` with Vitest scaffolding and a passing smoke test for `normalize()`

**Checkpoint**: `npm -w web run test:unit` runs and the smoke test passes.

---

## Phase 3: User Story 1 — Command Recognition with Aliases (Priority: P1) 🎯 MVP

**Goal**: The parser recognizes all command types via their full alias sets, and is mode-aware. Movement, talk, search, end-talk, quit, help, and list commands all resolve correctly from natural language input.

**Independent Test**: Run `npm -w web run test:unit` → all US1 unit tests pass. Run `npm -w web run test:e2e` → alias recognition E2E test passes.

### Tests for User Story 1 (write first — expect failure)

- [ ] T006 [P] [US1] Add unit tests for alias recognition in `web/src/lib/domain/parser.test.ts`: cover all move aliases (`go to`, `move to`, `travel to`, `head towards`, `go`, `move`), talk aliases (`talk to`, `speak to`, `speak with`), search aliases (`search`, `look around`, `inspect`, `look`), end_talk exact-matches (`bye`, `leave`, `end`, `goodbye`, `see you`), quit exact-matches (`quit`, `exit`), `help`, `locations`, `characters`
- [ ] T007 [P] [US1] Add unit tests for mode-awareness in `web/src/lib/domain/parser.test.ts`: movement alias in talk mode → `ask`; movement alias in accuse mode → `ask`; search in non-explore mode → `unrecognized`
- [ ] T008 [P] [US1] Add Playwright E2E test for alias recognition in `web/e2e/input.test.ts`: type `travel to kitchen` in explore mode, verify the same move backend call fires as `go to kitchen`

### Implementation for User Story 1

- [ ] T009 [US1] Implement the static alias tables (one array per command category, longest-to-shortest prefix order) in `web/src/lib/domain/parser.ts` — see `contracts/parser-contract.md` alias tables for all entries per mode
- [ ] T010 [US1] Implement the explore-mode prefix-scan logic in `parseCommand()` in `web/src/lib/domain/parser.ts`: iterate alias tables in priority order, strip matched prefix, return appropriate `ParseResult`
- [ ] T011 [US1] Implement exact-match logic for talk and accuse modes in `parseCommand()` in `web/src/lib/domain/parser.ts`: match against end_talk/quit/help exact strings; anything else → `{ type: 'valid', command: { type: 'ask', question } }`
- [ ] T012 [US1] Update `store.svelte.ts` to pass `ParseContext` to `parseCommand()`: extract `gameState.locations`, `gameState.characters`, `gameState.location` and pass as context in `web/src/lib/domain/store.svelte.ts`

**Checkpoint**: `npm -w web run test:unit` — US1 unit tests pass. `npm -w web run test:e2e` — alias E2E case passes.

---

## Phase 4: User Story 2 — Target Validation with Helpful Feedback (Priority: P1)

**Goal**: Commands requiring a target (move, talk) validate the target client-side before any backend call. Missing or invalid targets produce inline feedback with a suggestions list. `locations` and `characters` list commands work.

**Independent Test**: Run `npm -w web run test:unit` → all US2 unit tests pass. Manual: type `go` alone or `go to zyx` and verify inline feedback appears in the narration box with no network request fired.

### Tests for User Story 2 (write first — expect failure)

- [ ] T013 [P] [US2] Add unit tests for target validation in `web/src/lib/domain/parser.test.ts`: valid move target match (location.name), valid talk target match (first_name, last_name), `missing-target` on bare `go` and bare `talk to`, `invalid-target` on `go to zyx` with correct suggestions, `list` result for `locations` and `characters` commands
- [ ] T014 [P] [US2] Add Playwright E2E tests in `web/e2e/input.test.ts`: type `go` → inline feedback message appears in narration box; type `go to zyx` → inline feedback appears; type `locations` → location list appears; verify no backend network call is made in the target-invalid case (intercept network)

### Implementation for User Story 2

- [ ] T015 [US2] Implement move target validation inside `parseCommand()` in `web/src/lib/domain/parser.ts`: after extracting destination, match against `context.locations[*].name` (normalized); on match return `ValidCommand`; on no match or missing return `missing-target`/`invalid-target` with suggestions = all location names + characters at current location
- [ ] T016 [US2] Implement talk target validation inside `parseCommand()` in `web/src/lib/domain/parser.ts`: after extracting character token, match against `first_name` OR `last_name` (normalized); on match return `ValidCommand`; on no match or missing return `missing-target`/`invalid-target` with suggestions = all character display names
- [ ] T017 [US2] Implement `locations` and `characters` list commands in `parseCommand()` in `web/src/lib/domain/parser.ts`: return `{ type: 'list', listType, items }` populated from `context`
- [ ] T018 [US2] Update `submitInput()` in `web/src/lib/domain/store.svelte.ts` to handle new `ParseResult` branches: `missing-target` → push formatted feedback message to `state.history` (no backend call); `invalid-target` → same; `list` → push formatted list to `state.history` (no backend call); keep existing `valid` branch backend call; remove the old `default: unknown command` branch
- [ ] T019 [US2] Implement inline feedback formatting helper in `web/src/lib/domain/store.svelte.ts` (or a co-located `feedback.ts`): converts `MissingTarget`, `InvalidTarget`, and `ListResult` into human-readable narration strings per `contracts/parser-contract.md` feedback strings table

**Checkpoint**: `npm -w web run test:unit` — US2 unit tests pass. `npm -w web run test:e2e` — target validation E2E cases pass. No backend call fires for invalid/missing target.

---

## Phase 5: User Story 3 — Unrecognized Command Guidance (Priority: P2)

**Goal**: When a command doesn't match any known pattern, a brief inline command list for the current mode appears. Typing `help` opens the full extended help modal with all aliases.

**Independent Test**: Run `npm -w web run test:e2e` → US3 E2E tests pass. Manual: type `jump over fence` → brief one-liner appears in narration; type `help` → HelpModal opens.

### Tests for User Story 3 (write first — expect failure)

- [ ] T020 [P] [US3] Add unit tests in `web/src/lib/domain/parser.test.ts` for `unrecognized` result: verify mode-correct hint string is returned for explore, talk, and accuse modes
- [ ] T021 [P] [US3] Add/extend Playwright E2E test in `web/e2e/help.test.ts`: type `jump over fence` → brief `Commands: ...` line appears in narration box (not the modal); type `help` → `HelpModal` with `COMMAND REFERENCE` heading appears

### Implementation for User Story 3

- [ ] T022 [US3] Implement `unrecognized` branch in `parseCommand()` in `web/src/lib/domain/parser.ts`: return `{ type: 'unrecognized', raw, hint }` where `hint` is a mode-keyed one-liner of valid command names (e.g., `"go, talk, search, help, quit. Type 'help' for details."`)
- [ ] T023 [US3] Handle `unrecognized` result in `submitInput()` in `web/src/lib/domain/store.svelte.ts`: push the `hint` string as a system narration history entry; do NOT open HelpModal
- [ ] T024 [US3] Update `HelpModal.svelte` in `web/src/lib/components/HelpModal.svelte` to include all new aliases in the COMMAND REFERENCE content: add talk alias variants (`speak to`, `speak with`), search aliases (`look around`, `inspect`), end_talk aliases (`leave`, `end`, `goodbye`, `see you`), `locations`/`characters` list commands, `quit`/`exit` in the General section

**Checkpoint**: `npm -w web run test:e2e` — US3 help and unrecognized command E2E tests pass. HelpModal shows all aliases.

---

## Phase 6: User Story 4 — Graceful Backend Error Handling with Retries (Priority: P2)

**Goal**: Transient backend errors (network/5xx) are retried up to 3 times with a visible indicator. Permanent errors (4xx) surface immediately. Player can manually retry after exhausted retries.

**Independent Test**: Run `npm -w web run test:e2e` → US4 E2E test passes. Manual: route a backend call to return 500 three times → verify retry indicator appears → verify final error message shows with manual retry option.

### Tests for User Story 4 (write first — expect failure)

- [ ] T025 [P] [US4] Add Playwright E2E test in `web/e2e/input.test.ts`: mock `game-search` to return 500 twice then 200 → verify retry indicator (`isRetrying`) is visible during retry, then disappears on success; mock 500 three times → verify error message appears in narration after exhausted retries

### Implementation for User Story 4

- [ ] T026 [US4] Add `isRetrying = $state(false)` and `retryCount = $state(0)` reactive fields to `GameSessionStore` in `web/src/lib/domain/store.svelte.ts`
- [ ] T027 [US4] Implement retry loop in `submitInput()` in `web/src/lib/domain/store.svelte.ts`: wrap Supabase `functions.invoke()` in a loop (max 3 attempts); classify errors — network exception or `status >= 500` → transient (retry with 1s/2s/4s backoff); `status >= 400 && status < 500` → permanent (no retry); set `isRetrying = true` while retrying, `false` when done
- [ ] T028 [US4] On exhausted retries: push a human-readable error narration entry to `state.history` in `web/src/lib/domain/store.svelte.ts`; reset `isRetrying = false`; keep `status = 'active'` so input remains usable
- [ ] T029 [P] [US4] Add retry indicator to `InputBox.svelte` in `web/src/lib/components/InputBox.svelte`: show a small "Retrying… (N/3)" label derived from `gameSessionStore.isRetrying` and `gameSessionStore.retryCount`, styled with Tailwind so it appears only when `isRetrying === true`

**Checkpoint**: `npm -w web run test:e2e` — US4 retry E2E test passes. Input remains enabled after error. Retry label visible during retries.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Type safety cleanup, documentation, and full quality gate sign-off.

- [ ] T030 [P] Run `npm -w web run check` (svelte-check) and fix any TypeScript/Svelte type errors introduced by the new `ParseResult` type in the store and components
- [ ] T031 [P] Run `npm run typecheck` from repo root and resolve any remaining type errors
- [ ] T032 [P] Run `npm run lint` and fix any lint violations across modified files
- [ ] T033 Update `docs/component-inventory.md` to note the retry indicator addition to `InputBox.svelte` and any new props/state
- [ ] T034 Run full quality gate `npm run test:all` and confirm all checks pass — lint, typecheck, svelte-check, unit tests, integration tests, E2E tests

**Checkpoint (Final)**: `npm run test:all` exits 0. Feature is complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **BLOCKS all user stories**
- **Phase 3 (US1)**: Depends on Phase 2
- **Phase 4 (US2)**: Depends on Phase 3 (needs alias parsing to be in place first)
- **Phase 5 (US3)**: Depends on Phase 2; can run in parallel with US2 (different files: `store.svelte.ts` unrecognized branch + `HelpModal.svelte`)
- **Phase 6 (US4)**: Depends on Phase 4 (needs the store's `valid` backend call path to exist)
- **Phase 7 (Polish)**: Depends on all preceding phases

### User Story Dependencies

- **US1 (P1)**: Starts after Foundational — no story dependencies
- **US2 (P1)**: Starts after US1 (requires `ParseContext` wired in store from T012)
- **US3 (P2)**: Starts after Foundational (Phase 2) — `unrecognized` branch and `HelpModal` are independent of US2
- **US4 (P2)**: Starts after US2 (requires the store's backend call path from T018)

### Within Each User Story

- Write tests first (expect them to fail)
- Parser logic (`parser.ts`) before store wiring (`store.svelte.ts`)
- Store wiring before UI additions (components)
- Story complete before moving to next priority

### Parallel Opportunities

- T006, T007, T008 can all start together (US1 tests, different concerns)
- T013, T014 can run in parallel (US2 tests)
- T015, T016, T017 can run in parallel (different parser branches, same file — coordinate on edit)  
- T020, T021 can run in parallel (US3 tests)
- T025 can start independently once Phase 4 store path exists
- T030, T031, T032, T033 can all run in parallel (Polish phase)

---

## Parallel Example: User Story 1

```bash
# Run in parallel — all test scaffolding:
Task T006: Add alias recognition unit tests in web/src/lib/domain/parser.test.ts
Task T007: Add mode-awareness unit tests in web/src/lib/domain/parser.test.ts
Task T008: Add alias E2E test in web/e2e/input.test.ts

# Then sequentially — implementation (all in parser.ts):
Task T009: Implement alias tables
Task T010: Implement explore-mode prefix scan
Task T011: Implement talk/accuse exact-match logic
Task T012: Wire ParseContext in store
```

## Parallel Example: User Story 2

```bash
# Run in parallel — test scaffolding:
Task T013: Target validation unit tests in parser.test.ts
Task T014: Target validation E2E tests in input.test.ts

# Then sequentially — implementation:
Task T015: Move target validation in parser.ts
Task T016: Talk target validation in parser.ts
Task T017: List commands in parser.ts
Task T018: Store ParseResult routing in store.svelte.ts
Task T019: Feedback formatting helper
```

---

## Implementation Strategy

### MVP First (US1 + US2 Only)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: Foundational (T003–T005)
3. Complete Phase 3: US1 — alias recognition (T006–T012)
4. **STOP and VALIDATE**: `npm -w web run test:unit && npm -w web run test:e2e`
5. Complete Phase 4: US2 — target validation (T013–T019)
6. **STOP and VALIDATE**: Inline feedback works, no backend calls for invalid targets
7. Deploy/demo MVP

### Incremental Delivery

1. After US1: All aliases work →  ship alias improvement
2. After US2: Validation + lists → ship inline feedback
3. After US3: Brief help + updated modal → ship help improvements
4. After US4: Retry logic → ship resilience improvements
5. Polish → clean final release

---

## Notes

- [P] tasks = different files or independent concerns, safe to parallelise
- [Story] maps each task to its user story for traceability
- Parser tests (Vitest) are pure and fast — run these first on every change
- E2E tests (Playwright) are the correctness gate — must pass before marking a story done
- `store.svelte.ts` is a shared file — serialise edits within stories to avoid conflicts
- Commit after each checkpoint to keep a clean rollback point
