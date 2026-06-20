-- Migration: Grant table-level DML to the PostgREST API roles.
--
-- Recent Supabase CLI / Postgres versions no longer auto-grant the `public`
-- schema to the API roles (anon, authenticated, service_role). Without explicit
-- grants every public table exposes only REFERENCES/TRIGGER/TRUNCATE/MAINTAIN,
-- so service_role has DML on zero tables and all PostgREST access (seed:ai,
-- Edge Functions, the API) fails with "permission denied for table ...".
--
-- RLS still governs row visibility for anon/authenticated; service_role bypasses
-- RLS. These grants only restore the table-level access the roles need.
--
-- NOTE: any future table created in `public` must add the same grant.

grant select, insert, update, delete on table game_sessions to anon, authenticated, service_role;
grant select, insert, update, delete on table game_events to anon, authenticated, service_role;
grant select, insert, update, delete on table ai_profiles to anon, authenticated, service_role;
grant select, insert, update, delete on table briefs to anon, authenticated, service_role;
