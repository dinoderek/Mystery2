-- Brief management: per-user story briefs for the blueprint generation pipeline.

create table briefs (
    id                      uuid primary key default gen_random_uuid(),
    user_id                 uuid not null references auth.users(id),
    brief                   text not null,
    target_age              integer not null,
    time_budget             integer,
    title_hint              text,
    one_liner_hint          text,
    art_style               text,
    must_include            text[] not null default '{}',
    culprits                integer,
    suspects                integer,
    locations               integer,
    witnesses               integer,
    red_herring_trails      integer,
    cover_ups               boolean,
    elimination_complexity  text check (
        elimination_complexity is null
        or elimination_complexity in ('simple', 'moderate', 'complex')
    ),
    archived_at   timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index briefs_user_active_idx on briefs(user_id) where archived_at is null;

alter table briefs enable row level security;

create policy "Users can manage own briefs" on briefs
    for all
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
