# Research: Basic Authentication

**Feature**: 005-supabase-auth | **Date**: 2026-03-09

## R1: SvelteKit Adapter for Static SPA Auth

**Decision**: Switch from `adapter-auto` to `@sveltejs/adapter-static` with `fallback: '200.html'`

**Rationale**: The architecture mandates a static site (no SSR runtime). `adapter-static` with a fallback page enables client-side routing for all paths, which is essential for the auth redirect flow (e.g., `/login` → `/` after sign-in, deep-link preservation). The fallback ensures the SPA handles all routes rather than returning 404s from the static host.

**Alternatives considered**:
- `adapter-auto`: Currently in use but doesn't produce a deterministic static build. Depends on the deployment target to choose an adapter, which could introduce SSR behavior unintentionally.
- `adapter-cloudflare`: Would tie the build to Cloudflare Workers runtime, adding SSR capability we explicitly don't want.

## R2: Auth State Management Pattern

**Decision**: Create a reactive `AuthStore` class using Svelte 5 `$state` runes, driven by `supabase.auth.onAuthStateChange()`.

**Rationale**: The existing `GameSessionStore` uses the `$state` rune pattern. Following the same convention keeps the codebase consistent. `onAuthStateChange` provides cross-tab synchronization and handles `INITIAL_SESSION`, `SIGNED_IN`, `SIGNED_OUT`, and `TOKEN_REFRESHED` events — covering all spec requirements (FR-004, FR-005, FR-007). The store exposes `{ session, user, loading }` — `loading` is true until `INITIAL_SESSION` fires, preventing the flash-of-content problem.

**Alternatives considered**:
- Svelte context-based store: Would require prop drilling or context injection. Less ergonomic than a module-level singleton matching the `gameSessionStore` pattern.
- SvelteKit `$page.data` via `+layout.ts` load function: Works in SPA mode but introduces async timing issues with session initialization. Less reactive than `onAuthStateChange`.

## R3: Auth Gate Implementation

**Decision**: Implement the auth gate in the root `+layout.svelte` using the `AuthStore`. Show a loading spinner until `INITIAL_SESSION`, then conditionally render login or app content.

**Rationale**: Centralizes auth gating in one place. The layout checks `authStore.loading` (show spinner), then `authStore.session` (if null, redirect to `/login`; if present, render children). This satisfies FR-001, FR-006, and FR-011. Deep-link preservation is handled by storing the intended path before redirect.

**Alternatives considered**:
- Per-route guards in `+page.ts` load functions: More scattered, harder to maintain, and inconsistent UX (each page handles its own redirect).
- Middleware/hooks: Not available in static SPA mode (no server hooks).

## R4: Edge Function JWT Verification

**Decision**: Create a `requireAuth(req)` helper in `_shared/auth.ts` that extracts the JWT from the `Authorization` header and creates a user-scoped Supabase client using the anon key + Authorization header pass-through. Also validate the user via `supabase.auth.getUser()` for an immediate 401 on invalid tokens.

**Rationale**: This is the established Supabase pattern for Edge Functions. Creating a user-scoped client means all subsequent database operations are automatically subject to RLS policies. The explicit `getUser()` call provides an immediate 401 response rather than waiting for a database error, giving better error messages. The existing `_shared/errors.ts` already has `unauthorized()` ready for this.

**Alternatives considered**:
- Continue using service-role client with manual user_id extraction: Bypasses RLS, requiring manual authorization checks in every query. More error-prone.
- `getClaims(token)` only (no user-scoped client): Validates the JWT but doesn't automatically scope database queries to the user. Would still require manual filtering.

## R5: Database Schema Changes

**Decision**: Add a `user_id uuid not null` column to `game_sessions` (referencing `auth.users(id)`). Do NOT add `user_id` to `game_events` — it inherits ownership via `session_id` foreign key. Replace the `anon` RLS policies with `authenticated`-role policies scoped to `auth.uid() = user_id`.

**Rationale**: Minimal schema change. `game_events` are always accessed via their parent `game_sessions`, so a single ownership column on sessions is sufficient. The `ON DELETE CASCADE` on `game_events.session_id` means user data cleanup cascades naturally. RLS on `game_events` checks ownership by joining through `session_id` to `game_sessions.user_id`.

**Alternatives considered**:
- Add `user_id` to both tables: Redundant data. The FK relationship already establishes ownership. Would require keeping both columns in sync.
- No `user_id` column, rely only on Edge Function checks: Violates the architecture constraint that all data access is RLS-protected. A service-role client or direct DB access could leak data.

## R6: Session Persistence & Token Refresh

**Decision**: Use the default `@supabase/supabase-js` behavior: `persistSession: true` (localStorage) and `autoRefreshToken: true`. No custom storage adapter needed.

**Rationale**: Supabase JS client handles persistence and refresh out of the box. Sessions are stored in localStorage under `sb-<project-ref>-auth-token`. Auto-refresh proactively renews the access token before expiry. Cross-tab synchronization is built-in via `onAuthStateChange`. This directly satisfies FR-004 and FR-005 with zero custom code.

**Alternatives considered**:
- `@supabase/ssr` with cookie-based storage: Designed for SSR frameworks. Adds unnecessary complexity for a static SPA. We don't have a server to set cookies.
- Custom sessionStorage adapter: Would not persist across browser closes, violating FR-004.

## R7: Login Page Design

**Decision**: Create a `/login` route with a `LoginForm.svelte` component. Email + password fields, client-side validation (required fields), and clear error messages. Follows the terminal/retro aesthetic using existing `t-*` theme tokens.

**Rationale**: Spec requires inline validation (FR-010) and user-friendly errors (FR-009). The login form is simple: two inputs, a submit button, and an error display area. Terminal aesthetic matches the game's visual identity. No sign-up flow needed (FR-003).

**Alternatives considered**:
- Supabase Auth UI pre-built component: Would not match the terminal aesthetic. Also includes sign-up/social login UI we explicitly don't want.
- Modal overlay instead of dedicated route: Less clean for deep-link flows and browser history management.

## R8: Test Account Provisioning

**Decision**: Create test accounts via a SQL seed file (`supabase/seed/seed-auth-users.sql`) that inserts into `auth.users` using Supabase's local auth admin API during `supabase db reset` or via testkit helpers that call `supabase.auth.admin.createUser()`.

**Rationale**: Accounts are pre-provisioned (not self-registered). For local dev and tests, we need deterministic accounts. Supabase local stack supports inserting into `auth.users` via admin API. The testkit helpers enable integration tests to create isolated users per test run (following the logical isolation strategy).

**Alternatives considered**:
- Manual account creation via Supabase Dashboard: Not automatable, breaks CI.
- Environment variable with hardcoded tokens: Fragile, tokens expire.

## R9: Handling Existing Anon Data

**Decision**: The migration adding `user_id` to `game_sessions` will require a data migration strategy. For local development, a `supabase db reset` is acceptable (destructive). For any future production deployment, a migration would need to handle orphaned sessions (delete or assign to a default user).

**Rationale**: The project is pre-production with no real user data. Local development uses `supabase db reset` regularly. The migration can safely use `NOT NULL` on `user_id` after cleaning existing rows.

**Alternatives considered**:
- Make `user_id` nullable: Would weaken the data model and require null checks everywhere. Not worth it for a pre-production project.

## R10: Logout Mechanism

**Decision**: Add a logout button in the game UI (accessible from the `/session` page and start page). Calls `supabase.auth.signOut()` which clears localStorage and fires `SIGNED_OUT`. The auth gate in `+layout.svelte` reacts and redirects to `/login`.

**Rationale**: Simple, follows the reactive pattern. No custom session clearing needed — `signOut()` handles everything. Cross-tab sign-out is automatic via `onAuthStateChange`.

**Alternatives considered**:
- Server-side session invalidation (`scope: 'global'`): Overkill for pre-provisioned accounts. Local sign-out is sufficient.
