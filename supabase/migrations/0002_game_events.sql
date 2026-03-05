create table game_events (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references game_sessions(id) on delete cascade,
    sequence integer not null,
    event_type text not null,
    actor text not null,
    payload jsonb,
    narration text not null,
    clues_revealed text[] not null default '{}',
    created_at timestamptz not null default now()
);

create unique index game_events_session_sequence_idx on game_events(session_id, sequence);

alter table game_events enable row level security;

create policy "Enable all access for anon" on game_events
    for all
    to anon
    using (true)
    with check (true);
