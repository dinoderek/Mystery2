-- Migration: Make the blueprints bucket private and restrict access to authenticated users
-- Previously the bucket was public with an unrestricted SELECT policy.

update storage.buckets
set public = false
where id = 'blueprints';

drop policy if exists "Public Access" on storage.objects;

create policy "Authenticated users can read blueprints" on storage.objects
  for select
  to authenticated
  using (bucket_id = 'blueprints');
