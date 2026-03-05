# Tasks: Supabase API Implementation (001-supabase-api)

**Input**: Design documents from `/specs/001-supabase-api/`  
**Prerequisites**: [plan.md](./plan.md) · [spec.md](./spec.md) · [data-model.md](./data-model.md) · [contracts/api.md](./contracts/api.md) · [research.md](./research.md)

**Tests**: E2E testing is MANDATORY. Unit and integration tests are required for all API operations per `docs/testing.md`.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1–US6)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bootstrap the Supabase project layout and shared tooling

- [x] T001 Verify `supabase/config.toml` exists and is correctly configured for local dev; create it if missing
- [x] T002 [P] Create `supabase/seed/blueprints/` directory and populate `mock-blueprint.json` — a deterministic fixture with 2 locations, 2 characters (one culprit), 3 searchable clues, and hardcoded `starting_knowledge`
- [x] T003 [P] Create `packages/shared/` workspace package with TypeScript config and export `src/api-types.ts` containing all public types: `GameState`, `HistoryEntry`, `BlueprintSummary` (per `contracts/api.md` `GameState` definition)
- [x] T004 [P] Create `packages/testkit/` workspace package with TypeScript config; add `src/seed.ts` (session creation helpers), `src/auth.ts` (anonymous session helpers), `src/assertions.ts` (common state assertion helpers)
- [x] T004a [P] Create basic TypeScript configuration (`tsconfig.json` at root) and define base scripts (run tests, run).
- [x] T005 [P] Configure ESLint + deno lint + Prettier for the repo; add `npm run lint`, `npm run format`, `npm run typecheck` scripts to root `package.json`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure all Edge Functions and tests depend on. No user story work until this phase is complete.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T006 Write migration `supabase/migrations/0001_game_sessions.sql` — creates `game_sessions` table with columns: `id uuid PK`, `blueprint_id uuid`, `mode text`, `current_location_id text`, `current_talk_character_id text`, `time_remaining int`, `discovered_clues text[]`, `outcome text`, `created_at timestamptz`, `updated_at timestamptz`; adds permissive RLS for anonymous insert + scoped read by `id`
- [x] T007 Write migration `supabase/migrations/0002_game_events.sql` — creates `game_events` table with columns: `id uuid PK`, `session_id uuid FK→game_sessions`, `sequence int`, `event_type text`, `actor text`, `payload jsonb`, `narration text`, `clues_revealed text[]`, `created_at timestamptz`; unique index on `(session_id, sequence)`; permissive RLS
- [x] T008 Write migration `supabase/migrations/0003_blueprints_storage.sql` — creates a `blueprints` Supabase Storage bucket with public read policy; no write from clients
- [x] T009 Implement `supabase/functions/_shared/db.ts` — exports a `createClient()` factory that returns a Supabase JS v2 client configured from env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- [x] T010 [P] Implement `supabase/functions/_shared/errors.ts` — exports helpers: `badRequest(msg)`, `notFound(msg)`, `internalError(msg)` returning typed `Response` objects with correct HTTP status codes and `{ "error": msg }` JSON body
- [x] T011 [P] Implement `supabase/functions/_shared/state-machine.ts` — exports `validateTransition(currentMode: GameMode, action: ActionType): void` that throws a `BadRequestError` for any invalid mode+action combination per the state transition rules in `data-model.md`
- [x] T012 Implement `supabase/functions/_shared/ai-provider.ts` — defines `AIProvider` interface with methods: `generateNarration(prompt: string): Promise<string>` and `evaluateReasoning(context: object): Promise<{ resolved: boolean; outcome?: "win"|"loss"; narration: string }>`. Implements `MockAIProvider` with deterministic hardcoded responses keyed on prompt type. `OpenRouterProvider` is **not implemented** in this feature.
- [x] T013 [P] Implement `supabase/functions/_shared/clue-ids.ts` — exports `generateClueId(text: string): string` that returns a stable `clue_<8-hex>` ID by SHA-256 hashing the clue text (truncated to 8 chars); and `buildClueIndex(blueprint: Blueprint): Map<string, string>` mapping clue ID → clue text for server-side lookups
- [x] T014 Apply all migrations locally: run `supabase db reset` to verify migrations execute cleanly and the schema is as expected

**Checkpoint**: Supabase schema live, shared utilities ready — user story implementation can begin.

---

## Phase 3: User Story 1 — Browse and Start a Game (Priority: P1) 🎯 MVP

**Goal**: Players can list available blueprints and start a new game session, receiving a fully populated initial state with opening narration.

**Independent Test**: Call `blueprints-list`, pick the mock blueprint, call `game-start` — verify `game_id` returned, state shape matches `GameState`, mode is `explore`, `clues` contains starting knowledge IDs, narration is non-empty.

### Tests for US1

- [x] T015 [P] [US1] Write integration test `apps/web/tests/integration/blueprints.test.ts` — asserts: response is 200, array contains mock blueprint entry with `id`, `title`, `one_liner`, `target_age`; no `ground_truth` or `world` fields leaked
- [x] T016 [P] [US1] Write integration test `apps/web/tests/integration/game-start.test.ts` — asserts: 200 response with `game_id` UUID, `state.mode === "explore"`, `state.time_remaining > 0`, `state.clues` is array of clue ID strings, `state.narration` non-empty; verifies `game_sessions` row created in DB

### Implementation for US1

- [x] T017 [US1] Implement `supabase/functions/blueprints-list/index.ts` — reads `blueprints/` bucket, parses each JSON file through `BlueprintSchema`, returns array of `{ id, title, one_liner, target_age }` (no world/ground_truth); handles empty bucket gracefully
- [x] T018 [US1] Implement `supabase/functions/game-start/index.ts` — loads blueprint from Storage, validates with `BlueprintSchema`, generates stable clue IDs via `clue-ids.ts` for all blueprint clues, inserts `game_sessions` row, inserts `start` event in `game_events` with mock AI opening narration, returns `{ game_id, state: GameState }` (starting knowledge clue IDs in `state.clues`)
- [x] T019 [US1] Run integration tests T015–T016; confirm they pass

**Checkpoint**: Blueprint listing and game creation fully functional and tested independently.

---

## Phase 4: User Story 2 — Retrieve Game State / Resume Investigation (P2 + P5)

> US2 (retrieve state) and US5 (resume) share the same endpoint `game-get` and are delivered together.

**Goal**: Players can retrieve the complete current state of an active game at any time, including the full narration history — enabling resumption from any client.

**Independent Test**: Start a game (US1), perform one action (move), then call `game-get` — verify state matches, `history` array contains 2 entries (start + move) in sequence order with correct `event_type`, `actor`, `narration`.

### Tests for US2+US5

- [x] T020 [P] [US2] Write integration test `apps/web/tests/integration/game-get.test.ts` — asserts: 200 with full `GameState` including `history[]` sorted by `sequence`; each history entry has `sequence`, `event_type`, `actor`, `narration`; non-existent `game_id` returns 404

### Implementation for US2+US5

- [x] T021 [US2] Implement `supabase/functions/game-get/index.ts` — reads `game_sessions` snapshot by `game_id` path param, queries `game_events` ordered by `sequence ASC`, returns `{ state: GameState }` including full `history` array; returns 404 for unknown session
- [x] T022 [US2] Run integration test T020; confirm it passes

**Checkpoint**: Session retrieval and resume fully functional and independently tested.

---

## Phase 5: User Story 3 — Explore the Mystery World (Priority: P3)

**Goal**: Players can move between locations and search for clues, with time deducted per action. Time exhaustion auto-transitions to `accuse` mode.

**Independent Test**: Start a game (US1), call `game-move` to a valid location — verify narration, updated location, visible characters, decremented time. Call `game-search` — verify narration, optional `discovered_clue_id`, decremented time. Call `game-get` (US2) — verify history has 3 entries.

### Tests for US3

- [x] T023 [P] [US3] Write integration test `packages/apitests/integration/game-move.test.ts`
- [x] T024 [P] [US3] Write integration test `packages/apitests/integration/game-search.test.ts`

### Implementation for US3

- [x] T025 [US3] Implement `supabase/functions/game-move/index.ts`
- [x] T026 [US3] Implement `supabase/functions/game-search/index.ts`
- [x] T027 [US3] Run integration tests T023–T024; confirm they pass

**Checkpoint**: Full exploration loop (move + search + time expiry) functional and independently tested.

---

## Phase 6: User Story 4 — Interrogate Suspects (Priority: P4)

**Goal**: Players can enter talk mode with a character, ask free-form questions, receive mock AI responses that may reveal clue IDs, and end the conversation returning to explore mode.

**Independent Test**: Start game (US1), move to character location (US3), call `game-talk` — verify mode becomes `talk`. Call `game-ask` with a question — verify response from mock AI, time decrements, optional `clues_revealed` IDs. Call `game-end-talk` — verify mode returns to `explore`.

### Tests for US4

- [x] T028 [P] [US4] Write integration test `packages/apitests/integration/game-talk.test.ts`
- [x] T029 [P] [US4] Write integration test `packages/apitests/integration/game-ask.test.ts`
- [x] T030 [P] [US4] Write integration test `packages/apitests/integration/game-end-talk.test.ts`

### Implementation for US4

- [x] T031 [US4] Implement `supabase/functions/game-talk/index.ts`
- [x] T032 [US4] Implement `supabase/functions/game-ask/index.ts`
- [x] T033 [US4] Implement `supabase/functions/game-end-talk/index.ts`
- [x] T034 [US4] Run integration tests T028–T030; confirm they pass

**Checkpoint**: Full interrogation loop (talk + ask + end_talk) functional and independently tested.

---

## Phase 7: User Story 5 — Accuse & Resolve (Priority: P5)

**Goal**: Players can formally accuse a suspect, provide reasoning across one or more dialogue turns, and receive a deterministic `win` or `loss` outcome with closing narration.

**Independent Test**: Start game (US1), call `game-accuse` — verify mode becomes `accuse`, narrator prompts for reasoning. Call `game-accuse-reasoning` with correct reasoning — mock AI returns `outcome: "win"` and `mode: "ended"`. Call `game-get` — verify session mode is `ended` and history is complete.

### Tests for US5

- [x] T035 [P] [US5] Write integration test `apps/web/tests/integration/game-accuse.test.ts`
- [x] T036 [P] [US5] (Skipped) `game-accuse-reasoning` removed in favor of direct resolution

### Implementation for US5

- [x] T037 [US5] Implement `supabase/functions/game-accuse/index.ts`
- [x] T038 [US5] (Skipped) `game-accuse-reasoning` removed
- [x] T039 [US5] Run integration tests; confirm they pass

**Checkpoint**: Full endgame loop functional and tested.

---

## Phase 8: User Story 6 — Full E2E Investigation (Priority: P6)

**Goal**: A single automated Playwright test exercises the entire investigation from blueprint listing to game resolution using the mock blueprint and mock AI — no human input required.

**Independent Test**: Run `npm run test:e2e` against local Supabase + stub UI endpoint; all steps pass deterministically.

### Tests for US6 (this phase IS the test)

- [X] T040 [US6] Write E2E test `apps/web/tests/e2e/full-investigation.test.ts` using Vitest
- [X] T041 [US6] Configure `AI_PROVIDER=mock` environment variable in test harness so no real AI calls are made during E2E
- [X] T042 [US6] Run `npm run test:e2e`; confirm all 11 steps pass

**Checkpoint**: Full investigation verified end-to-end, deterministically, with mock AI.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T043 [P] Add Deno unit tests `supabase/functions/_shared/state-machine.test.ts`
- [X] T044 [P] Add Deno unit tests `supabase/functions/_shared/clue-ids.test.ts`
- [X] T045 [P] Update `docs/project-structure.md` to document final folder layout
- [X] T046 Add `npm run test:all` scripts to root `package.json`
- [X] T047 Create a single-shot quality gate script (e.g., `npm run test:all`)
- [X] T048 Review ALL documentation for accuracy post integration
- [X] T049 Run the full single-shot quality gate — all must pass.

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup) ──────────────────────────────┐
                                               ▼
Phase 2 (Foundational) ── BLOCKS ─────────────► Phase 3 (US1) → Phase 4 (US2+US5) → Phase 5 (US3)
                                                                                          │
                                                                              Phase 6 (US4) ──► Phase 7 (US5-accuse)
                                                                                                       │
                                                                                              Phase 8 (E2E) → Phase 9 (Polish)
```

### User Story Dependencies

| Story                        | Depends on           | Reason                               |
| ---------------------------- | -------------------- | ------------------------------------ |
| US1 (Browse + Start)         | Phase 2 only         | No story deps                        |
| US2+US5 (Get State + Resume) | US1                  | Needs an active session              |
| US3 (Explore)                | US1                  | Needs an active session              |
| US4 (Talk)                   | US1 + US3            | Must be at a character's location    |
| US5 (Accuse)                 | US1                  | Only needs a session in explore mode |
| US6 (E2E)                    | All stories complete | End-to-end validation                |

### Parallel Opportunities Within Each Phase

**Phase 2 (Foundational)**

```
[T006] DB migrations (sessions)     [T007] DB migrations (events)
[T008] Storage migration             [T009] db.ts
[T010] errors.ts                     [T011] state-machine.ts
[T012] ai-provider.ts               [T013] clue-ids.ts
```

**Phase 3 (US1)**

```
[T015] integration/blueprints.test.ts    [T016] integration/game-start.test.ts
[T017] blueprints-list/index.ts          [T018] game-start/index.ts  ← after T015+T016
```

**Phases 5–7 — Tests within each story can all run in parallel before implementation.**

---

## Parallel Example: Phase 2 (Foundation)

```bash
# All these can run simultaneously:
Task T006: "Write migration supabase/migrations/0001_game_sessions.sql"
Task T007: "Write migration supabase/migrations/0002_game_events.sql"
Task T008: "Write migration supabase/migrations/0003_blueprints_storage.sql"
Task T010: "Implement supabase/functions/_shared/errors.ts"
Task T011: "Implement supabase/functions/_shared/state-machine.ts"
Task T013: "Implement supabase/functions/_shared/clue-ids.ts"

# After all migrations done:
Task T014: "run supabase db reset to verify all migrations"
```

---

## Implementation Strategy

### MVP Scope (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational — **critical blocker**
3. Complete Phase 3: US1 (blueprints-list + game-start)
4. **STOP and VALIDATE**: test `blueprints-list` and `game-start` end-to-end
5. Demo: player can see mystery list and start a game

### Incremental Delivery

1. Setup + Foundational → schema + shared utilities ready
2. US1 → blueprint listing + game start **[DEMO POINT]**
3. US2+US5 → state retrieval + resume **[DEMO POINT]**
4. US3 → explore loop (move + search) **[DEMO POINT]**
5. US4 → interrogation loop (talk + ask + end_talk) **[DEMO POINT]**
6. US5-accuse → endgame (accuse + reasoning → win/loss) **[DEMO POINT]**
7. US6 → full E2E confirmation of everything together

---

## Summary

| Phase                         | Tasks        | Stories  |
| ----------------------------- | ------------ | -------- |
| Phase 1: Setup                | T001–T005    | —        |
| Phase 2: Foundational         | T006–T014    | —        |
| Phase 3: US1 Browse+Start     | T015–T019    | US1      |
| Phase 4: US2+US5 State+Resume | T020–T022    | US2, US5 |
| Phase 5: US3 Explore          | T023–T027    | US3      |
| Phase 6: US4 Interrogate      | T028–T034    | US4      |
| Phase 7: US5 Accuse           | T035–T039    | US5      |
| Phase 8: US6 E2E              | T040–T042    | US6      |
| Phase 9: Polish               | T043–T049    | —        |
| **Total**                     | **50 tasks** |          |
