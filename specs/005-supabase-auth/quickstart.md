# Quickstart: Basic Authentication

**Feature**: 005-supabase-auth | **Date**: 2026-03-09

## Prerequisites

- Node.js 18+
- Docker (for Supabase local stack)
- Supabase CLI installed

## Local Development Setup

### 1. Start the stack

```bash
npm run dev
```

This starts the Supabase local stack (Postgres/Auth/Storage/Functions) and the SvelteKit dev server.

### 2. Test accounts (auto-provisioned)

After `supabase db reset` or stack start, these test accounts are available:

| Email | Password | Notes |
|-------|----------|-------|
| `player1@test.local` | `password123` | Primary test player |
| `player2@test.local` | `password123` | For RLS isolation tests |

These are seeded via `supabase/seed/seed-auth-users.sql`.

### 3. Login

Navigate to `http://localhost:5173`. You'll see the login screen. Enter test credentials to access the game.

## Key Files

| File | Purpose |
|------|---------|
| `web/src/lib/domain/auth-store.svelte.ts` | Reactive auth state management |
| `web/src/lib/ui/LoginForm.svelte` | Login form component |
| `web/src/routes/login/+page.svelte` | Login page route |
| `web/src/routes/+layout.svelte` | Auth gate (redirects unauthenticated users) |
| `supabase/functions/_shared/auth.ts` | Edge Function auth helper |
| `supabase/functions/_shared/db.ts` | Enhanced with `createUserClient(req)` |
| `supabase/migrations/000X_add_user_id.sql` | Schema migration for user ownership |

## Running Tests

### Unit tests
```bash
npm run test:unit
```

### Integration tests (requires Supabase stack)
```bash
npm run test:integration
```
Tests RLS policies, JWT rejection, and auth-scoped data access.

### E2E tests (requires Supabase stack + web dev server)
```bash
npm run test:e2e
```
Tests login flow, session persistence, logout, and auth gate redirects in a real browser.

## Architecture Notes

- **Frontend auth gate is UX only** — prevents showing game content to unauthenticated users
- **Real security is backend** — RLS policies + Edge Function JWT verification
- **No SSR** — all auth logic is client-side via `@supabase/supabase-js` localStorage
- **No sign-up** — accounts are pre-provisioned by admins
- **Cross-tab sync** — `onAuthStateChange` propagates sign-out across browser tabs
