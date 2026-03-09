-- Migration: Add user_id to game_sessions and enforce authenticated RLS policies
-- Feature: 005-supabase-auth

-- 1. Drop existing permissive anon policies
drop policy if exists "Enable all access for anon" on game_sessions;
drop policy if exists "Enable all access for anon" on game_events;

-- 2. Delete orphaned sessions (pre-production, no real user data)
delete from game_sessions;

-- 3. Add user_id column with FK to auth.users
alter table game_sessions
    add column user_id uuid not null references auth.users(id);

-- 4. Create index for RLS performance
create index game_sessions_user_id_idx on game_sessions(user_id);

-- 5. Create RLS policies for authenticated users only
create policy "Users can manage own sessions" on game_sessions
    for all
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can manage own session events" on game_events
    for all
    to authenticated
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
    );
