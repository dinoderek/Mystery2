insert into storage.buckets (id, name, public) 
values ('blueprints', 'blueprints', true)
on conflict (id) do nothing;

create policy "Public Access" on storage.objects
  for select
  using (bucket_id = 'blueprints');
