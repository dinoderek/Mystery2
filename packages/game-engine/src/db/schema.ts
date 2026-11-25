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
-- Four tables: three for play (players, sessions, events) and one holding the
-- AI chosen on the settings page. The shape below is the current end state,
-- not a replay of how it got here.
--
-- Applied only to a fresh database. Once a database exists it is upgraded by
-- the numbered steps in \`client.ts\`'s MIGRATIONS array, keyed on
-- \`PRAGMA user_version\`; this file always describes the current shape so a new
-- database never replays that chain. Keep the two in step: a change here needs
-- a bumped SCHEMA_VERSION, and a matching MIGRATIONS entry unless older saves
-- are started over (OLDEST_UPGRADABLE_VERSION).
--
-- Type conventions:
--   ids         TEXT holding a uuid (crypto.randomUUID())
--   timestamps  TEXT holding an ISO-8601 UTC instant
--   structures  TEXT holding JSON
--
-- \`foreign_keys\` is OFF by default in SQLite and is enabled per connection in
-- \`client.ts\`; the game_events cascade below depends on it.

-- Local player profiles: no passwords, no tokens. The browser carries a player
-- id in a cookie and the repositories below scope every read and write to it,
-- which is the whole of the access model.
create table players (
    id          text primary key,
    name        text not null unique,
    created_at  text not null,
    updated_at  text not null,
    -- The reading age this profile's new games start at; null reads each case
    -- at its own. Written only through the profile's own store.
    reading_age integer
);

create table game_sessions (
    id                        text primary key,
    player_id                 text not null references players(id) on delete cascade,
    blueprint_id              text not null,
    -- The AI name the game was started with, resolved again on every request
    -- (see ../ai-config.ts): \`default\` for every game started in the browser.
    -- It references nothing. The evaluation pipeline reads it.
    ai_profile_id             text not null default 'default',
    mode                      text not null,
    current_location_id       text not null,
    current_talk_character_id text,
    time_remaining            integer not null,
    discovered_clues          text not null default '[]',
    outcome                   text,
    created_at                text not null,
    updated_at                text not null,
    clue_graph_snapshot       text,
    -- The age the game is narrated for, saved at its start.
    reading_age               integer
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
    -- Every event must carry at least one narration part, or the transcript
    -- cannot be rebuilt from history.
    narration_parts text not null default '[]'
                    check (json_valid(narration_parts)
                           and json_type(narration_parts) = 'array'
                           and json_array_length(narration_parts) > 0),
    model           text,
    created_at      text not null
);

create unique index game_events_session_sequence_idx
    on game_events(session_id, sequence);

-- --------------------------------------------------------------------------
-- The AI chosen on the settings page
-- --------------------------------------------------------------------------
--
-- At most one row, holding the chosen AI's name: \`mock\` or an entry of
-- ai.json. No row means nothing has been chosen, which narrates with the file's
-- default, else mock. The name is not checked against the file here, because
-- the file can change between starts; resolving it is where a name that has
-- gone is reported.

create table app_settings (
    id       integer primary key check (id = 1),
    ai_name  text not null
);
`;
