-- Extend the existing company_assets document record instead of creating a parallel startup table.
-- Apply this migration in Supabase before enabling pitch-deck analysis in production.
alter table public.company_assets
  add column if not exists analysis_status text,
  add column if not exists extracted_text text,
  add column if not exists extracted_json jsonb,
  add column if not exists analysis_error text,
  add column if not exists processed_at timestamptz;

alter table public.company_assets
  drop constraint if exists company_assets_analysis_status_check;
alter table public.company_assets
  add constraint company_assets_analysis_status_check
  check (analysis_status is null or analysis_status in ('uploaded', 'processing', 'processed', 'failed'));

create index if not exists company_assets_pitch_deck_latest_idx
  on public.company_assets (company_id, created_at desc)
  where type = 'pitch_deck';

insert into storage.buckets (id, name, public)
values ('pitch-decks', 'pitch-decks', false)
on conflict (id) do update set public = false;

-- Existing policies may already grant this access. These narrowly scoped policies
-- make the intended workspace/company path explicit without dropping legacy policies.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pitch_decks_workspace_select_v2') then
    create policy pitch_decks_workspace_select_v2 on storage.objects for select to authenticated
      using (bucket_id = 'pitch-decks' and exists (
        select 1 from public.workspace_members wm join public.companies c on c.workspace_id = wm.workspace_id
        where wm.user_id = auth.uid() and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
          and c.id::text = split_part(storage.objects.name, '/', 2)
      ));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pitch_decks_workspace_insert_v2') then
    create policy pitch_decks_workspace_insert_v2 on storage.objects for insert to authenticated
      with check (bucket_id = 'pitch-decks' and exists (
        select 1 from public.workspace_members wm join public.companies c on c.workspace_id = wm.workspace_id
        where wm.user_id = auth.uid() and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
          and c.id::text = split_part(storage.objects.name, '/', 2)
      ));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pitch_decks_workspace_delete_v2') then
    create policy pitch_decks_workspace_delete_v2 on storage.objects for delete to authenticated
      using (bucket_id = 'pitch-decks' and exists (
        select 1 from public.workspace_members wm join public.companies c on c.workspace_id = wm.workspace_id
        where wm.user_id = auth.uid() and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
          and c.id::text = split_part(storage.objects.name, '/', 2)
      ));
  end if;
end $$;
