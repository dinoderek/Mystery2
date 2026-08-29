// The local database, as one statement list.
//
// This is a TypeScript module rather than the `schema.sql` file it would
// rather be. The engine has to load identically under three loaders — Vite's
// SSR bundle, vitest, and plain `node` — and only a module works in all three:
// a bundled chunk cannot read a sibling `.sql` file off disk, and `?raw` is a
// Vite-only import. The cost is syntax highlighting; the benefit is that
// nothing about how the engine is loaded can break the schema.

export const SCHEMA_SQL = `
-- Local SQLite schema for the mystery engine.
--
-- This is the whole database: three tables, no migration chain. It was derived
-- from the *end state* of supabase/migrations/0001..0014 rather than replayed
-- from them, because none of that history needs to survive the move off
-- Postgres (existing session data is disposable — see
-- docs/plans/local-execution/plan.md).
--
-- Applied only to a fresh database. Once a database exists it is upgraded by
-- the numbered steps in \`client.ts\`'s MIGRATIONS array, keyed on
-- \`PRAGMA user_version\`; this file always describes the current shape so a new
-- database never replays that chain. Keep the two in step: a change here needs
-- a matching MIGRATIONS entry and a bumped SCHEMA_VERSION.
--
-- Type mapping from the Postgres original:
--   uuid        -> TEXT (crypto.randomUUID())
--   timestamptz -> TEXT holding an ISO-8601 UTC instant
--   jsonb       -> TEXT holding JSON
--   text[]      -> TEXT holding a JSON array
--
-- \`foreign_keys\` is OFF by default in SQLite and is enabled per connection in
-- \`client.ts\`; the game_events cascade below depends on it.

-- Local player profiles. Replaces \`auth.users\`: no passwords, no JWTs — the
-- browser carries a player id in a cookie and the repositories below scope
-- every read and write to it, which is where the old RLS policies now live.
create table players (
    id          text primary key,
    name        text not null unique,
    created_at  text not null,
    updated_at  text not null
);

create table game_sessions (
    id                        text primary key,
    -- was \`user_id uuid references auth.users(id)\` (migration 0004)
    player_id                 text not null references players(id) on delete cascade,
    blueprint_id              text not null,
    -- Provenance label only. The \`ai_profiles\` table is gone: profiles are
    -- resolved from the environment (see ../ai-profile.ts), so this no longer
    -- references anything. The evaluation pipeline reads it.
    ai_profile_id             text not null default 'default',
    mode                      text not null,
    current_location_id       text not null,
    current_talk_character_id text,
    time_remaining            integer not null,
    discovered_clues          text not null default '[]',
    outcome                   text,
    created_at                text not null,
    updated_at                text not null
);

create index game_sessions_player_id_idx on game_sessions(player_id);

create table game_events (
    id              text primary key,
    session_id      text not null references game_sessions(id) on delete cascade,
    sequence        integer not null,
    event_type      text not null,
    actor           text not null,
    payload         text,
    narration       text not null,
    -- Migration 0008's non-empty check, kept: every event must carry at least
    -- one narration part or the transcript cannot be rebuilt from history.
    narration_parts text not null default '[]'
                    check (json_valid(narration_parts)
                           and json_type(narration_parts) = 'array'
                           and json_array_length(narration_parts) > 0),
    model           text,
    created_at      text not null
);

-- Dropped on the way over: \`game_events.clues_revealed\`. The runtime has never
-- written it (see evaluation/lib/game-events.mjs) — reveals live in \`payload\`.

create unique index game_events_session_sequence_idx
    on game_events(session_id, sequence);
`;
