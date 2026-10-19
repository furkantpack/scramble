-- Run in Supabase SQL Editor only. SELECTs only; no schema or data mutation.
select current_database() as database_name, current_user as inspected_as;

select table_schema, table_name
from information_schema.tables
where table_schema = 'public' and table_name in
  ('workspaces','workspace_members','companies','company_assets','scrape_snapshots',
   'knowledge_base_entries','accelerator_programs','accelerator_applications',
   'application_questions','application_answers','browser_agent_runs',
   'application_submit_authorizations','application_dispatch_jobs','source_analysis_jobs')
order by table_name;

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and (
  (table_name = 'companies' and column_name in
    ('unified_analysis','canonical_profile','profile_confirmed_at','profile_confirmed_by')) or
  (table_name = 'company_assets' and column_name in
    ('analysis_status','extracted_text','extracted_json','extracted_pages','content_sha256')) or
  (table_name in ('application_dispatch_jobs','source_analysis_jobs') and column_name in
    ('status','lease_until','attempts','idempotency_key')))
order by table_name, column_name;

select t.typname as enum_name, e.enumlabel as value
from pg_type t join pg_enum e on e.enumtypid = t.oid
where t.typname in ('application_status','browser_agent_status')
order by t.typname, e.enumsortorder;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('companies','company_assets','accelerator_applications','browser_agent_runs',
   'application_submit_authorizations','application_dispatch_jobs','source_analysis_jobs')
order by c.relname;

select schemaname, tablename, policyname, roles, cmd
from pg_policies where (schemaname = 'public' and tablename in
  ('application_submit_authorizations','application_dispatch_jobs','source_analysis_jobs'))
or (schemaname = 'storage' and tablename = 'objects' and policyname like 'pitch_decks_%')
order by schemaname, tablename, policyname;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('claim_application_dispatch_jobs','begin_application_dispatch','claim_source_analysis_jobs')
order by p.proname;

select id, public from storage.buckets where id = 'pitch-decks';
