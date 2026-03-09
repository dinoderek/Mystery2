# Tasks: Basic Authentication

**Input**: Design documents from `/specs/005-supabase-auth/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: End-to-End (E2E) testing is MANDATORY for all features. Unit and integration tests are included per the testing strategy.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Frontend**: `web/src/`
- **Backend**: `supabase/functions/`
- **Migrations**: `supabase/migrations/`
- **Tests (API)**: `tests/api/`
- **Tests (E2E browser)**: `web/e2e/`
- **Test helpers**: `tests/testkit/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Switch SvelteKit to static adapter, install dependencies, and prepare the project for auth

- [x] T001 Install `@sveltejs/adapter-static` and switch from `adapter-auto` in `web/svelte.config.js` — set `fallback: '200.html'` per research R1
- [x] T002 [P] Create `web/src/routes/+layout.ts` exporting `export const ssr = false;` and `export const prerender = true;` to enable full SPA mode
- [x] T003 [P] Enhance `web/src/lib/api/supabase.ts` — explicitly set `auth: { persistSession: true, autoRefreshToken: true }` options on `createClient` per research R6

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database migration, backend auth helper, and test helpers that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Create migration `supabase/migrations/0004_add_user_id_and_auth_policies.sql` — drop existing anon policies on `game_sessions` and `game_events`, delete existing rows, add `user_id uuid not null references auth.users(id)` column to `game_sessions`, create index `game_sessions_user_id_idx`, create `authenticated` RLS policies per data-model.md migration plan
- [x] T005 [P] Create `supabase/functions/_shared/auth.ts` — implement `requireAuth(req: Request)` that extracts JWT from `Authorization` header, creates a user-scoped Supabase client (anon key + auth header pass-through), validates via `supabase.auth.getUser()`, returns `{ client, user }` or throws. Use `unauthorized()` from `_shared/errors.ts` for error responses
- [x] T006 [P] Add `createUserClient(req: Request)` factory to `supabase/functions/_shared/db.ts` — create Supabase client using `SUPABASE_URL` + anon key with the request's `Authorization` header forwarded. Keep existing `createClient()` (service role) unchanged
- [x] T007 [P] Enhance `tests/testkit/src/auth.ts` — replace placeholder with real helpers: `createTestUser(email, password)` using `supabase.auth.admin.createUser()`, `signIn(email, password)` returning session/token, `getAuthHeaders(token)` returning `{ Authorization: 'Bearer ...' }`, and `cleanupTestUser(userId)` using admin API

**Checkpoint**: Foundation ready — auth infrastructure exists, migration applied, test helpers functional

---

## Phase 3: User Story 1 — Player Logs In to Access Game (Priority: P1) 🎯 MVP

**Goal**: Unauthenticated users see a login screen; entering valid credentials redirects them to the game start page. Invalid credentials and missing fields show clear errors.

**Independent Test**: Navigate to app → see login screen → enter credentials → land on start page. Also test invalid credentials and missing field validation.

### Tests for User Story 1 (MANDATORY) ⚠️

- [x] T008 [P] [US1] Write unit test for `AuthStore` in `web/src/lib/domain/auth-store.test.ts` — test state transitions: initial `loading=true`, mock `INITIAL_SESSION` sets `loading=false` + session, `SIGNED_IN` updates session, `signIn` calls `supabase.auth.signInWithPassword`, error propagation for invalid credentials
- [x] T009 [P] [US1] Write E2E test for login flow in `web/e2e/auth.spec.ts` — test: unauthenticated user sees login page; valid login redirects to start page; invalid credentials show error message; empty fields show validation messages; authenticated user navigating to `/login` is redirected to `/`

### Implementation for User Story 1

- [x] T010 [US1] Create `web/src/lib/domain/auth-store.svelte.ts` — implement `AuthStore` class using `$state` runes with `session`, `user`, `loading`, `error` fields. Subscribe to `supabase.auth.onAuthStateChange()` handling `INITIAL_SESSION`, `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED` events. Expose `signIn(email, password)` and `signOut()` methods. Export singleton `authStore` instance. Follow existing `GameSessionStore` pattern in `store.svelte.ts`
- [x] T011 [P] [US1] Create `web/src/lib/ui/LoginForm.svelte` — terminal-aesthetic login form with email and password fields, submit button, inline validation for required fields (FR-010), error message display area for auth failures (FR-009). Use `t-*` theme tokens per styling conventions. Call `authStore.signIn()` on submit. No sign-up link (FR-003)
- [x] T012 [US1] Create `web/src/routes/login/+page.svelte` — login page route rendering `LoginForm.svelte`. Full-screen terminal layout matching existing aesthetic
- [x] T013 [US1] Enhance `web/src/routes/+layout.svelte` — add auth gate logic: import `authStore`, show `TerminalSpinner` while `authStore.loading`, if `!authStore.session` and current path is not `/login` then `goto('/login')` (FR-006), if `authStore.session` and current path is `/login` then `goto('/')` (FR-011). Preserve deep-link intended path for post-login redirect

**Checkpoint**: User Story 1 complete — login flow works end-to-end in the browser. Run `npm -w web run test:e2e -- web/e2e/auth.spec.ts` to validate.

---

## Phase 4: User Story 2 — Session Persists Across Browser Sessions (Priority: P1)

**Goal**: After login, closing and reopening the browser automatically signs the player in without re-entering credentials. Token refresh is handled silently.

**Independent Test**: Log in → close tab → reopen app → verify automatic authentication without login screen.

### Tests for User Story 2 (MANDATORY) ⚠️

- [x] T014 [US2] Add session persistence E2E tests to `web/e2e/auth.spec.ts` — test: after login, reloading page does not show login screen (localStorage session); verify `TOKEN_REFRESHED` event keeps session alive; when refresh token is invalid, user is redirected to login with message

### Implementation for User Story 2

- [x] T015 [US2] Verify and harden `AuthStore` token refresh handling in `web/src/lib/domain/auth-store.svelte.ts` — ensure `TOKEN_REFRESHED` event updates session state, handle refresh failure by clearing session and setting error message ("Session expired, please sign in again"), verify cross-tab `SIGNED_OUT` propagation via `onAuthStateChange`. Most behavior is provided by the Supabase client defaults (R6), this task is about edge-case error handling

**Checkpoint**: User Story 2 complete — session persists across browser restarts. E2E tests confirm no re-login needed.

---

## Phase 5: User Story 3 — Unauthenticated Requests Are Rejected by Backend (Priority: P1)

**Goal**: All Edge Functions require valid JWT. Requests without tokens or with invalid tokens are rejected with 401. RLS policies prevent cross-user data access.

**Independent Test**: Call any Edge Function without token → get 401. Call with valid token → get success. User A cannot read User B's sessions.

### Tests for User Story 3 (MANDATORY) ⚠️

- [x] T016 [P] [US3] Write integration test for Edge Function auth in `tests/api/integration/auth-rejection.test.ts` — test against `game-start` and `blueprints-list`: no Authorization header → 401, invalid token → 401, valid token → success (200/201). Use testkit `createTestUser` and `signIn` helpers
- [x] T017 [P] [US3] Write integration test for RLS policies in `tests/api/integration/auth-rls.test.ts` — create two test users, User A creates a session, User B tries to read/update/delete User A's session → empty/no-op. User B tries to read User A's events → empty. Anon client cannot read any data. Per RLS contract in `contracts/rls-policies.md`

### Implementation for User Story 3

- [x] T018 [US3] Add auth guard to `supabase/functions/game-start/index.ts` — use `requireAuth(req)` from `_shared/auth.ts` at start of handler, get `{ client, user }`, pass `user.id` as `user_id` in the `game_sessions` insert, use `client` (user-scoped) for RLS-enforced queries instead of service-role `createClient()`
- [x] T019 [P] [US3] Add auth guard to `supabase/functions/game-get/index.ts` — use `requireAuth(req)`, replace `createClient()` with user-scoped client from auth result
- [x] T020 [P] [US3] Add auth guard to `supabase/functions/game-move/index.ts` — use `requireAuth(req)`, replace `createClient()` with user-scoped client from auth result
- [x] T021 [P] [US3] Add auth guard to `supabase/functions/game-talk/index.ts` — use `requireAuth(req)`, replace `createClient()` with user-scoped client from auth result
- [x] T022 [P] [US3] Add auth guard to `supabase/functions/game-ask/index.ts` — use `requireAuth(req)`, replace `createClient()` with user-scoped client from auth result
- [x] T023 [P] [US3] Add auth guard to `supabase/functions/game-end-talk/index.ts` — use `requireAuth(req)`, replace `createClient()` with user-scoped client from auth result
- [x] T024 [P] [US3] Add auth guard to `supabase/functions/game-search/index.ts` — use `requireAuth(req)`, replace `createClient()` with user-scoped client from auth result
- [x] T025 [P] [US3] Add auth guard to `supabase/functions/game-accuse/index.ts` — use `requireAuth(req)`, replace `createClient()` with user-scoped client from auth result
- [x] T026 [P] [US3] Add auth guard to `supabase/functions/blueprints-list/index.ts` — use `requireAuth(req)`, replace `createClient()` with user-scoped client from auth result. Blueprints-list does not write user_id but still requires authentication
- [x] T027 [US3] Update existing integration tests to use authenticated requests — modify all tests in `tests/api/integration/` (`game-start.test.ts`, `game-get.test.ts`, `game-move.test.ts`, `game-talk.test.ts`, `game-ask.test.ts`, `game-end-talk.test.ts`, `game-search.test.ts`, `game-accuse.test.ts`, `blueprints.test.ts`) to create a test user, sign in, and include auth headers. Use testkit helpers from T007
- [x] T028 [US3] Update existing E2E test `tests/api/e2e/game-flow.test.ts` — use authenticated user for the full game flow test

**Checkpoint**: User Story 3 complete — all endpoints reject unauthenticated requests. RLS prevents cross-user data access. Run `npm run test:integration` and `npm run test:e2e` to validate.

---

## Phase 6: User Story 4 — Player Logs Out (Priority: P2)

**Goal**: Authenticated player can log out, clearing their browser session and returning to the login screen. After logout, game pages are inaccessible.

**Independent Test**: Log in → trigger logout → verify login screen appears → try navigating to game page → redirected to login.

### Tests for User Story 4 (MANDATORY) ⚠️

- [x] T029 [US4] Add logout E2E tests to `web/e2e/auth.spec.ts` — test: logged-in user clicks logout → sees login screen; after logout, navigating to `/` redirects to `/login`; after logout, navigating to `/session` redirects to `/login`

### Implementation for User Story 4

- [x] T030 [US4] Add logout button to game UI — add a "LOGOUT" button/link to `web/src/routes/+page.svelte` (start page, visible when authenticated) and `web/src/routes/session/+page.svelte` (game page). Clicking calls `authStore.signOut()`. Use terminal-aesthetic styling with `t-*` theme tokens. Position unobtrusively (top-right corner or footer area)

**Checkpoint**: User Story 4 complete — logout works and clears session. Run `npm -w web run test:e2e -- web/e2e/auth.spec.ts` to validate.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, edge cases, quality gates, and final validation

- [x] T031 [P] Update `docs/screen-navigation.md` — add `/login` route documentation, update navigation patterns to describe auth redirects, add auth gate description to layout docs
- [x] T032 [P] Update `docs/component-inventory.md` — add `LoginForm.svelte` component entry with purpose, props, and usage
- [x] T033 [P] Update `docs/architecture.md` — change "optional authentication" to "required authentication" in the Supabase Auth section and request lifecycle sequence diagrams. Update Edge Function responsibilities to mention JWT verification as mandatory. Document the RLS policy design: `user_id` ownership on `game_sessions`, ownership-inherited RLS on `game_events` via FK join, and the `authenticated`-role policy pattern replacing the old `anon` policies
- [x] T034 [P] Update `docs/testing.md` — add auth-specific testing guidance: test user provisioning via testkit, auth header requirements for integration tests, auth E2E test coverage list
- [x] T035 Handle edge cases in `web/src/lib/domain/auth-store.svelte.ts` — network failure during token refresh shows friendly error, deep-link preservation after login redirect, cross-tab session sync on sign-out
- [x] T036 Run full quality gates: `npm run test:all` — verify lint, typecheck, unit tests, integration tests, E2E tests all pass
- [x] T037 Validate `specs/005-supabase-auth/quickstart.md` — manually verify the quickstart guide works: start stack, seed users, login, play game, logout

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — no dependencies on other stories
- **US2 (Phase 4)**: Depends on Phase 3 (US1) — extends the auth store created in US1
- **US3 (Phase 5)**: Depends on Phase 2 — can run in PARALLEL with US1/US2 (backend-only, no frontend dependency)
- **US4 (Phase 6)**: Depends on Phase 3 (US1) — requires login UI to exist for logout to be meaningful
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Login flow — can start after Foundational. MVP story.
- **US2 (P1)**: Session persistence — depends on US1 (auth store must exist)
- **US3 (P1)**: Backend auth enforcement — can start after Foundational, independent of frontend stories
- **US4 (P2)**: Logout — depends on US1 (login must exist first)

### Within Each User Story

- Tests (when included) should be written first and expected to FAIL before implementation
- Store/domain logic before UI components
- UI components before route pages
- Route pages before layout integration
- Backend auth guard before RLS tests

### Parallel Opportunities

- **Phase 1**: T002 and T003 can run in parallel (different files)
- **Phase 2**: T005, T006, and T007 can all run in parallel (different files)
- **Phase 3 (US1)**: T008 and T009 (tests) can run in parallel; T011 can run in parallel with T010 (different files)
- **Phase 5 (US3)**: T016 and T017 (tests) in parallel; T019–T026 (auth guards) can ALL run in parallel (each modifies a separate Edge Function file)
- **Cross-story**: US3 (backend) can run in parallel with US1+US2 (frontend) after Foundational

---

## Parallel Example: User Story 3

```bash
# All Edge Function auth guard tasks can run in parallel (separate files):
T019: "Add auth guard to game-get/index.ts"
T020: "Add auth guard to game-move/index.ts"
T021: "Add auth guard to game-talk/index.ts"
T022: "Add auth guard to game-ask/index.ts"
T023: "Add auth guard to game-end-talk/index.ts"
T024: "Add auth guard to game-search/index.ts"
T025: "Add auth guard to game-accuse/index.ts"
T026: "Add auth guard to blueprints-list/index.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T007)
3. Complete Phase 3: User Story 1 (T008–T013)
4. **STOP and VALIDATE**: Test login flow independently
5. Deploy/demo if ready — players can log in and see the game

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 (Login) → Test independently → **MVP!** Players can authenticate
3. US3 (Backend auth) → Test independently → Backend is secure
4. US2 (Session persistence) → Test independently → Smooth UX
5. US4 (Logout) → Test independently → Full auth lifecycle
6. Polish → Documentation, edge cases, final validation

### Recommended Execution Order (Single Developer)

1. Phase 1: Setup (T001–T003)
2. Phase 2: Foundational (T004–T007)
3. Phase 3: US1 Login (T008–T013) — frontend auth gate
4. Phase 5: US3 Backend auth (T016–T028) — secure all endpoints
5. Phase 4: US2 Session persistence (T014–T015) — hardens auth store
6. Phase 6: US4 Logout (T029–T030) — completes auth lifecycle
7. Phase 7: Polish (T031–T037) — docs, edge cases, quality gates

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- US3 backend tasks are the most parallelizable (9 independent Edge Function files)
- Migration T004 will require `supabase db reset` — run early before other tests
