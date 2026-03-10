-- Migration: Canonical default AI profile id and DB-only OpenRouter key config

insert into ai_profiles (id, provider, model, openrouter_api_key, created_at, updated_at)
values ('mock', 'mock', 'mock/runtime-default', null, now(), now())
on conflict (id) do nothing;

with source_profile as (
    select provider, model, openrouter_api_key
    from ai_profiles
    where is_default = true
    order by updated_at desc nulls last, created_at desc nulls last
    limit 1
),
fallback_profile as (
    select provider, model, openrouter_api_key
    from ai_profiles
    where id = 'mock'
)
insert into ai_profiles (id, provider, model, openrouter_api_key, created_at, updated_at)
select 'default', provider, model, openrouter_api_key, now(), now()
from source_profile
union all
select 'default', provider, model, openrouter_api_key, now(), now()
from fallback_profile
where not exists (select 1 from source_profile)
on conflict (id) do nothing;

alter table game_sessions
    alter column ai_profile_id set default 'default';

drop index if exists ai_profiles_single_default_idx;

alter table ai_profiles
    drop column if exists is_default;

alter table ai_profiles
    drop constraint if exists ai_profiles_openrouter_key_required;

alter table ai_profiles
    add constraint ai_profiles_openrouter_key_required
    check (
        provider <> 'openrouter'
        or nullif(btrim(openrouter_api_key), '') is not null
    ) not valid;
