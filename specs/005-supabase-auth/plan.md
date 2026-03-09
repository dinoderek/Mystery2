# Implementation Plan: Basic Authentication

**Branch**: `005-supabase-auth` | **Date**: 2026-03-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-supabase-auth/spec.md`

## Summary

Implement email/password authentication using Supabase Auth. The frontend gets a login gate (all routes behind auth), persistent browser sessions via `@supabase/supabase-js` localStorage, and a logout flow. The backend gets JWT verification in all Edge Functions and user-scoped RLS policies on `game_sessions` and `game_events`. Accounts are pre-provisioned externally.

## Technical Context

**Language/Version**: TypeScript 5.x (SvelteKit frontend), TypeScript/Deno (Edge Functions)
**Primary Dependencies**: @supabase/supabase-js ^2.98.0, SvelteKit 2.x (adapter-static), Tailwind CSS 4.x
**Storage**: Supabase Postgres (existing `game_sessions`, `game_events` tables) + Supabase Auth (managed `auth.users`)
**Testing**: Vitest (unit + integration), Playwright (E2E browser)
**Target Platform**: Static SPA (Cloudflare Pages) + Supabase backend
**Project Type**: Web application (static SPA + serverless backend)
**Performance Goals**: Login < 30s end-to-end (SC-001), error feedback < 3s (SC-004), logout < 2s (SC-005)
**Constraints**: No SSR runtime, no secrets in browser, no self-registration, pre-provisioned accounts only
**Scale/Scope**: Small (< 100 users, educational kids' mystery game)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Documentation reviewed and lean?
- [x] Testing strategy includes E2E (mandatory) and Unit/Integration?
- [x] Quality gates runnable?
- [x] Static UI + Supabase backend constraints respected?
- [x] Context-specific conventions applied?

**Notes**: All five principles satisfied. Auth uses Supabase Auth (no custom auth server). Static SPA approach maintained — auth gate is client-side UX; security enforced at backend via RLS + JWT. Testing covers all tiers. Tailwind theme tokens used. No SSR required.

## Project Structure

### Documentation (this feature)

```text
specs/005-supabase-auth/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks - NOT created here)
```

### Source Code (repository root)

```text
web/
├── src/
│   ├── lib/
│   │   ├── api/
│   │   │   └── supabase.ts          # Enhanced: explicit auth options
│   │   ├── domain/
│   │   │   └── auth-store.svelte.ts  # NEW: reactive auth state ($state runes)
│   │   └── ui/
│   │       └── LoginForm.svelte      # NEW: email/password login component
│   └── routes/
│       ├── +layout.svelte            # Enhanced: auth gate wrapper
│       ├── +layout.ts                # NEW: export ssr = false
│       ├── login/
│       │   └── +page.svelte          # NEW: login page route
│       └── session/
│           └── +page.svelte          # Existing: add logout button
├── svelte.config.js                  # Change: adapter-auto → adapter-static

supabase/
├── migrations/
│   ├── 0001_game_sessions.sql        # Existing
│   ├── 0002_game_events.sql          # Existing
│   └── 000X_add_user_id.sql          # NEW: add user_id + RLS policies
├── functions/
│   └── _shared/
│       ├── db.ts                     # Enhanced: add createUserClient(req)
│       └── auth.ts                   # NEW: requireAuth(req) helper
├── seed/
│   └── seed-auth-users.sql           # NEW: pre-provision test accounts

tests/
├── testkit/
│   └── src/
│       └── auth.ts                   # Enhanced: real auth helpers (signIn, signUp, getToken)
├── api/
│   ├── unit/
│   │   └── auth-guard.test.ts        # NEW: auth helper unit tests
│   └── integration/
│       └── auth-rls.test.ts          # NEW: RLS policy + JWT rejection tests

web/e2e/
└── auth.spec.ts                      # NEW: login/logout/session persistence E2E
```

**Structure Decision**: Web application structure following existing monorepo layout. Frontend in `web/`, backend in `supabase/`, tests in `tests/`. No new top-level directories needed.

## Complexity Tracking

> No constitution violations. All changes use existing patterns and established dependencies.
