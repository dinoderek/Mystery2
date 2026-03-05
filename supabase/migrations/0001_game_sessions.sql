create table game_sessions (
    id uuid primary key default gen_random_uuid(),
    blueprint_id uuid not null,
    mode text not null,
    current_location_id text not null,
    current_talk_character_id text,
    time_remaining integer not null,
    discovered_clues text[] not null default '{}',
    outcome text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table game_sessions enable row level security;

create policy "Enable all access for anon" on game_sessions
    for all
    to anon
    using (true)
    with check (true);
