-- Migration: Add AI profiles table and bind game sessions to a profile
-- Feature: restart-free AI mode switching

create table ai_profiles (
    id text primary key,
    provider text not null check (provider in ('mock', 'openrouter')),
    model text not null,
    openrouter_api_key text,
    is_default boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index ai_profiles_single_default_idx
    on ai_profiles (is_default)
    where is_default = true;

insert into ai_profiles (id, provider, model, openrouter_api_key, is_default)
values ('mock', 'mock', 'mock/runtime-default', null, true)
on conflict (id) do update
set provider = excluded.provider,
    model = excluded.model,
    openrouter_api_key = excluded.openrouter_api_key,
    is_default = excluded.is_default,
    updated_at = now();

alter table game_sessions
    add column ai_profile_id text not null default 'mock' references ai_profiles(id);

update game_sessions
set ai_profile_id = 'mock'
where ai_profile_id is null;

alter table ai_profiles enable row level security;
