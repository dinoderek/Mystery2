# API Contracts: Authentication

**Feature**: 005-supabase-auth | **Date**: 2026-03-09

## Overview

Authentication uses Supabase Auth directly (no custom auth endpoints). The contracts below document how existing Edge Functions change to require authentication and the new auth-related behaviors at the API boundary.

## 1. Authentication Flow (Supabase Auth — no custom endpoint)

Client uses `@supabase/supabase-js` methods directly:

### Sign In
```
supabase.auth.signInWithPassword({ email, password })
```
**Response (success)**: `{ data: { session: { access_token, refresh_token, expires_in }, user: { id, email } }, error: null }`
**Response (failure)**: `{ data: { session: null, user: null }, error: { message: string, status: number } }`

### Sign Out
```
supabase.auth.signOut()
```
**Response**: `{ error: null }` — clears localStorage session

### Get Session (from storage)
```
supabase.auth.getSession()
```
**Response**: `{ data: { session: Session | null }, error: null }`

## 2. Edge Function Auth Contract (All Game Endpoints)

All existing Edge Functions (`game-start`, `game-get`, `game-move`, `game-talk`, `game-ask`, `game-end-talk`, `game-search`, `game-accuse`) gain the same auth requirement.

### Request Header (Required)
```
Authorization: Bearer <access_token>
```

The `@supabase/supabase-js` client automatically includes this header when calling `supabase.functions.invoke()` if the user is authenticated. No client-side changes needed for header management.

### Auth Error Responses

**401 Unauthorized — Missing or invalid token**
```json
{
  "error": "Missing or invalid authorization token"
}
```

**401 Unauthorized — Expired token (refresh failed)**
```json
{
  "error": "Authorization token expired"
}
```

### Auth Verification Flow (Edge Function Internal)

```
1. Extract Authorization header from request
2. Create user-scoped Supabase client (anon key + auth header)
3. Call supabase.auth.getUser() to validate token
4. If error → return 401 unauthorized
5. If success → proceed with user-scoped client for all DB operations
6. user_id = user.id (from getUser result) used for session ownership
```

## 3. Modified Endpoint: `game-start`

**Change**: The `user_id` from the authenticated user is now included when inserting a `game_session`.

### Request (unchanged body)
```json
{
  "blueprint_id": "uuid"
}
```

### Response (unchanged)
```json
{
  "game_id": "uuid",
  "state": { ... }
}
```

**Internal change**: `INSERT INTO game_sessions` now includes `user_id = auth.uid()`.

## 4. `blueprints-list` Endpoint

**Decision**: `blueprints-list` remains accessible to authenticated users only (same auth requirement as all other endpoints). There are no public endpoints.

## 5. Error Shape (Existing — No Change)

All endpoints continue to use the established error shape from `_shared/errors.ts`:

```json
{
  "error": "string",
  "details": {
    "retriable": false,
    "code": "string"
  }
}
```

Auth errors use HTTP 401 with `error` message. No `details.retriable` flag (auth errors are not retriable without user action).
