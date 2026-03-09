# RLS Policy Contracts

**Feature**: 005-supabase-auth | **Date**: 2026-03-09

## Overview

Row Level Security policies enforce data ownership at the database level. These are the security contracts that integration tests must verify.

## Policy: `game_sessions`

### Before (current — to be removed)
```sql
-- Allows ANY anonymous user full access
policy "Enable all access for anon" on game_sessions
    for all to anon using (true) with check (true)
```

### After
```sql
-- Only authenticated users can access their own sessions
policy "Users can manage own sessions" on game_sessions
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id)
```

### Test Contracts

| Test Case | Expected |
|-----------|----------|
| User A creates a session | Success, `user_id = A.id` |
| User A reads own session | Returns session |
| User B reads User A's session | Empty result (RLS filters) |
| User B updates User A's session | No rows affected |
| User B deletes User A's session | No rows affected |
| Anon user (no token) creates session | Error (no anon policy) |
| Anon user reads sessions | Empty result |

## Policy: `game_events`

### Before (current — to be removed)
```sql
-- Allows ANY anonymous user full access
policy "Enable all access for anon" on game_events
    for all to anon using (true) with check (true)
```

### After
```sql
-- Only access events belonging to own sessions
policy "Users can manage own session events" on game_events
    for all to authenticated
    using (
        exists (
            select 1 from game_sessions
            where game_sessions.id = game_events.session_id
            and game_sessions.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from game_sessions
            where game_sessions.id = game_events.session_id
            and game_sessions.user_id = auth.uid()
        )
    )
```

### Test Contracts

| Test Case | Expected |
|-----------|----------|
| User A reads events for own session | Returns events |
| User B reads events for User A's session | Empty result |
| User A inserts event for own session | Success |
| User B inserts event for User A's session | Error (FK + RLS) |
| Anon user reads events | Empty result |

## Edge Function Auth Policy

| Test Case | Expected |
|-----------|----------|
| Request with no Authorization header | 401 |
| Request with invalid/malformed token | 401 |
| Request with expired token | 401 |
| Request with valid token | 200 (proceed normally) |
