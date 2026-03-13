-- Migration: Private storage bucket + authenticated read policy for static blueprint images
-- Feature: 009-static-blueprint-images

insert into storage.buckets (id, name, public)
values ('blueprint-images', 'blueprint-images', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "Authenticated users can read blueprint images" on storage.objects;
create policy "Authenticated users can read blueprint images" on storage.objects
  for select
  to authenticated
  using (bucket_id = 'blueprint-images');
