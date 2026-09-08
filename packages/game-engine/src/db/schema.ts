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
-- Six tables: three for play (players, sessions, events) and three for AI
-- configuration (keys, models, and the single settings row that selects among
-- them). The shape below is the current end state, not a replay of how it got
-- here.
--
-- Applied only to a fresh database. Once a database exists it is upgraded by
-- the numbered steps in \`client.ts\`'s MIGRATIONS array, keyed on
-- \`PRAGMA user_version\`; this file always describes the current shape so a new
-- database never replays that chain. Keep the two in step: a change here needs
-- a matching MIGRATIONS entry and a bumped SCHEMA_VERSION.
--
-- Type conventions:
--   ids         TEXT holding a uuid (crypto.randomUUID())
--   timestamps  TEXT holding an ISO-8601 UTC instant
--   structures  TEXT holding JSON
--
-- The ai_keys / ai_models tables below deliberately break the id convention and
-- key on \`label\` instead; the reason is written out above those tables.
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
    updated_at  text not null
);

create table game_sessions (
    id                        text primary key,
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
    -- Every event must carry at least one narration part, or the transcript
    -- cannot be rebuilt from history.
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

-- --------------------------------------------------------------------------
-- AI configuration
-- --------------------------------------------------------------------------
--
-- \`label\` is the primary key here, against the id convention above, because
-- every \`source = 'env'\` row is deleted and re-inserted on each startup from
-- the environment files (see ../ai-settings-env.ts). A uuid would be a
-- different value after every restart, so a foreign key from app_settings would
-- be cleared by the delete half of that reseed and the player's selection would
-- evaporate on every boot. The label is what the environment matches on and
-- what the player picked, so it is the real identity.
--
-- \`source\` records who owns a row. 'env' rows are rewritten from the
-- filesystem on startup and are read-only in the UI; 'user' rows were typed
-- into the settings page and are only ever touched from there.

create table ai_keys (
    label       text primary key,
    api_key     text not null,
    source      text not null check (source in ('env', 'user')),
    created_at  text not null,
    updated_at  text not null
);

create table ai_models (
    label       text primary key,
    model_id    text not null,
    source      text not null check (source in ('env', 'user')),
    created_at  text not null,
    updated_at  text not null
);

-- Exactly one row, id 'singleton'. The selections are labels rather than
-- foreign keys and are allowed to dangle: a label removed from the environment
-- disappears on the next reseed, and the selection pointing at it is resolved
-- as "nothing selected" at read time rather than being repaired by a
-- constraint. See ../ai-settings.ts.
create table app_settings (
    id              text primary key check (id = 'singleton'),
    ai_mode         text not null default 'mock' check (ai_mode in ('mock', 'openrouter')),
    ai_key_label    text,
    ai_model_label  text,
    updated_at      text not null
);
`;
