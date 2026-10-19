-- SCRAMBLE: manual, additive Phase 2 migration for the EXISTING Supabase project.
-- Paste this entire file into Supabase SQL Editor as one execution, after taking a backup.
-- Do NOT add this file to Supabase's automatic migration history or run db push.
-- The script does not delete rows/tables, reset auth, or replace existing policies.
-- On error, the transaction is aborted; do not continue or rerun blindly.
-- If SQL Editor keeps the session open, issue ROLLBACK and inspect the error.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $preflight$
declare object_name text; has_active boolean;
begin
  if current_setting('server_version_num')::integer < 120000 then
    raise exception 'PostgreSQL 12+ required for transactional ALTER TYPE ADD VALUE';
  end if;
  -- Older Signal/Goal/Slice/Equity migrations have live sentinel objects. Their
  -- destructive/rewriting DDL must not be replayed as part of this patch.
  foreach object_name in array array[
    'public.workspaces', 'public.workspace_members', 'public.companies',
    'public.company_assets', 'public.accelerator_programs',
    'public.accelerator_applications', 'public.browser_agent_runs',
    'public.signals', 'public.goals', 'public.goal_weight_votes',
    'public.contribution_calculations', 'public.calibration_reviews',
    'storage.buckets', 'storage.objects'
  ] loop
    if to_regclass(object_name) is null then
      raise exception 'Required existing table % is missing; stop and inspect migration history', object_name;
    end if;
  end loop;
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'application_status' and t.typtype = 'e'
  ) then
    raise exception 'public.application_status enum is missing or has a different type';
  end if;
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.accelerator_applications'::regclass
      and a.attname = 'status' and a.atttypid = 'public.application_status'::regtype
      and a.attnum > 0 and not a.attisdropped
  ) then
    raise exception 'accelerator_applications.status does not use public.application_status';
  end if;
  if exists (select 1 from storage.buckets where id = 'pitch-decks' and public) then
    raise exception 'Existing pitch-decks bucket is public; do not silently change access. Review manually.';
  end if;
  if exists (select 1 from storage.buckets where id = 'pitch-decks' and name <> 'pitch-decks') then
    raise exception 'Existing pitch-decks bucket has an unexpected name; inspect it first';
  end if;
  if to_regclass('public.application_dispatch_jobs') is not null then
    execute 'select exists (select 1 from public.application_dispatch_jobs where status in
      (''queued'',''claimed'',''dispatching'',''dispatched'',''unknown_dispatch''))' into has_active;
    if has_active then raise exception 'Active application jobs exist; reconcile before replacing dispatcher functions'; end if;
  end if;
  if to_regclass('public.source_analysis_jobs') is not null then
    execute 'select exists (select 1 from public.source_analysis_jobs where status in
      (''queued'',''running''))' into has_active;
    if has_active then raise exception 'Active source jobs exist; let them finish before migration'; end if;
  end if;
  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.company_assets'::regclass
      and c.conname = 'company_assets_analysis_status_check'
      and (
        position('uploaded' in pg_get_constraintdef(c.oid)) = 0 or
        position('processing' in pg_get_constraintdef(c.oid)) = 0 or
        position('processed' in pg_get_constraintdef(c.oid)) = 0 or
        position('failed' in pg_get_constraintdef(c.oid)) = 0
      )
  ) then
    raise exception 'Existing deck analysis status constraint differs; inspect it before migrating';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.companies'::regclass)
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.company_assets'::regclass)
     or not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass)
  then
    raise exception 'Expected RLS is not enabled on a pre-existing company/asset/storage table';
  end if;
end
$preflight$;

-- 202610070001: add deck extraction fields without dropping an existing constraint.
alter table public.company_assets
  add column if not exists analysis_status text,
  add column if not exists extracted_text text,
  add column if not exists extracted_json jsonb,
  add column if not exists analysis_error text,
  add column if not exists processed_at timestamptz;

-- 202610080001 and 202610090002: unified profile and content fingerprint.
alter table public.company_assets
  add column if not exists extracted_pages jsonb,
  add column if not exists content_sha256 text;
alter table public.companies
  add column if not exists unified_analysis jsonb,
  add column if not exists canonical_profile jsonb,
  add column if not exists profile_confirmed_at timestamptz,
  add column if not exists profile_confirmed_by uuid references auth.users(id);

do $validate_columns$
declare bad text;
begin
  select string_agg(format('%s.%s expected %s, found %s', v.tbl, v.col, v.typ,
                           coalesce(format_type(a.atttypid, a.atttypmod), '<missing>')), '; ')
    into bad
  from (values
    ('company_assets','analysis_status','text'),
    ('company_assets','extracted_text','text'),
    ('company_assets','extracted_json','jsonb'),
    ('company_assets','analysis_error','text'),
    ('company_assets','processed_at','timestamp with time zone'),
    ('company_assets','extracted_pages','jsonb'),
    ('company_assets','content_sha256','text'),
    ('companies','unified_analysis','jsonb'),
    ('companies','canonical_profile','jsonb'),
    ('companies','profile_confirmed_at','timestamp with time zone'),
    ('companies','profile_confirmed_by','uuid')
  ) as v(tbl,col,typ)
  left join pg_attribute a on a.attrelid = format('public.%I',v.tbl)::regclass
    and a.attname = v.col and a.attnum > 0 and not a.attisdropped
  where a.attname is null or format_type(a.atttypid,a.atttypmod) <> v.typ;
  if bad is not null then raise exception 'Column type conflict: %', bad; end if;
end
$validate_columns$;

do $deck_constraint$
begin
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.company_assets'::regclass
      and conname = 'company_assets_analysis_status_check') then
    alter table public.company_assets add constraint company_assets_analysis_status_check
      check (analysis_status is null or analysis_status in
        ('uploaded','processing','processed','failed'));
  end if;
end
$deck_constraint$;

create index if not exists company_assets_pitch_deck_latest_idx
  on public.company_assets (company_id, created_at desc) where type = 'pitch_deck';
create index if not exists company_assets_processed_fingerprint_idx
  on public.company_assets (company_id, content_sha256)
  where type = 'pitch_deck' and analysis_status = 'processed' and content_sha256 is not null;

insert into storage.buckets (id, name, public)
values ('pitch-decks', 'pitch-decks', false)
on conflict (id) do nothing;

-- PostgreSQL combines permissive policies with OR. An owner-only permissive
-- policy would NOT tighten an existing broad policy. This restrictive ALL-role
-- guard is ANDed with every policy for pitch-decks, including legacy ones.
-- Other buckets pass the guard unchanged. Service-role access bypasses RLS.
do $storage_guard$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage'
    and tablename = 'objects' and policyname = 'pitch_decks_owner_guard_phase2') then
    create policy pitch_decks_owner_guard_phase2 on storage.objects
      as restrictive for all to public
      using (
        bucket_id is distinct from 'pitch-decks' or exists (
          select 1 from public.workspace_members wm
          join public.companies c on c.workspace_id = wm.workspace_id
          where wm.user_id = (select auth.uid()) and wm.role = 'owner'
            and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
            and c.id::text = split_part(storage.objects.name, '/', 2)
        )
      )
      with check (
        bucket_id is distinct from 'pitch-decks' or exists (
          select 1 from public.workspace_members wm
          join public.companies c on c.workspace_id = wm.workspace_id
          where wm.user_id = (select auth.uid()) and wm.role = 'owner'
            and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
            and c.id::text = split_part(storage.objects.name, '/', 2)
        )
      );
  end if;
end
$storage_guard$;

-- These policies add the required positive permission for authenticated owners.
-- Existing policies remain untouched but cannot bypass the restrictive guard.
do $storage_policies$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage'
    and tablename = 'objects' and policyname = 'pitch_decks_owner_select_phase2') then
    create policy pitch_decks_owner_select_phase2 on storage.objects
      for select to authenticated using (
        bucket_id = 'pitch-decks' and exists (
          select 1 from public.workspace_members wm
          join public.companies c on c.workspace_id = wm.workspace_id
          where wm.user_id = (select auth.uid()) and wm.role = 'owner'
            and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
            and c.id::text = split_part(storage.objects.name, '/', 2)
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage'
    and tablename = 'objects' and policyname = 'pitch_decks_owner_insert_phase2') then
    create policy pitch_decks_owner_insert_phase2 on storage.objects
      for insert to authenticated with check (
        bucket_id = 'pitch-decks' and exists (
          select 1 from public.workspace_members wm
          join public.companies c on c.workspace_id = wm.workspace_id
          where wm.user_id = (select auth.uid()) and wm.role = 'owner'
            and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
            and c.id::text = split_part(storage.objects.name, '/', 2)
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage'
    and tablename = 'objects' and policyname = 'pitch_decks_owner_delete_phase2') then
    create policy pitch_decks_owner_delete_phase2 on storage.objects
      for delete to authenticated using (
        bucket_id = 'pitch-decks' and exists (
          select 1 from public.workspace_members wm
          join public.companies c on c.workspace_id = wm.workspace_id
          where wm.user_id = (select auth.uid()) and wm.role = 'owner'
            and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
            and c.id::text = split_part(storage.objects.name, '/', 2)
        )
      );
  end if;
end
$storage_policies$;

-- 202610080002: conservative submission status and scoped authorization.
alter type public.application_status add value if not exists 'submission_unverified';
create table if not exists public.application_submit_authorizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  company_id uuid not null references public.companies(id),
  application_id uuid not null unique references public.accelerator_applications(id),
  program_id uuid not null references public.accelerator_programs(id),
  approved_fill_run_id uuid not null references public.browser_agent_runs(id),
  authorized_by uuid not null references auth.users(id),
  authorized_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  dispatched_at timestamptz,
  constraint application_submit_authorizations_expiry_check check (expires_at > authorized_at)
);
create index if not exists application_submit_authorizations_dispatch_idx
  on public.application_submit_authorizations (expires_at, authorized_at)
  where revoked_at is null and dispatched_at is null;
alter table public.application_submit_authorizations enable row level security;
revoke all on public.application_submit_authorizations from public, anon, authenticated;
grant select, insert, update on public.application_submit_authorizations to service_role;

-- 202610090001: durable, private Skyvern dispatch outbox.
create table if not exists public.application_dispatch_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  company_id uuid not null references public.companies(id),
  application_id uuid not null references public.accelerator_applications(id),
  requested_by uuid not null references auth.users(id),
  kind text not null check (kind in ('fill', 'submit')),
  request_intent jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in
    ('queued','claimed','dispatching','dispatched','completed','failed','cancelled','unknown_dispatch')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  correlation_id uuid not null default gen_random_uuid(),
  browser_run_id uuid references public.browser_agent_runs(id),
  external_run_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_dispatch_jobs_intent_object check (jsonb_typeof(request_intent) = 'object')
);
create unique index if not exists application_dispatch_jobs_one_active_kind
  on public.application_dispatch_jobs(application_id, kind)
  where status in ('queued','claimed','dispatching','dispatched','unknown_dispatch');
create index if not exists application_dispatch_jobs_due
  on public.application_dispatch_jobs(next_attempt_at, created_at) where status = 'queued';
create index if not exists application_dispatch_jobs_lease
  on public.application_dispatch_jobs(lease_until) where status in ('claimed','dispatching');
alter table public.application_dispatch_jobs enable row level security;
revoke all on public.application_dispatch_jobs from public, anon, authenticated;
grant select, insert, update on public.application_dispatch_jobs to service_role;

create or replace function public.claim_application_dispatch_jobs(max_jobs integer default 2)
returns setof public.application_dispatch_jobs
language plpgsql security definer set search_path = '' as $application_claim$
declare active_dispatches integer;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(9210921) then return; end if;
  update public.application_dispatch_jobs
     set status = 'unknown_dispatch', lease_until = null,
         error_code = 'LEASE_EXPIRED_AFTER_DISPATCH', updated_at = now()
   where status = 'dispatching' and lease_until < now();
  update public.application_dispatch_jobs
     set status = case when attempts >= 3 then 'failed' else 'queued' end,
         next_attempt_at = now() + make_interval(secs => least(300, (15 * power(2, attempts))::integer)),
         lease_until = null, error_code = 'PRE_DISPATCH_LEASE_EXPIRED', updated_at = now()
   where status = 'claimed' and lease_until < now();
  update public.application_dispatch_jobs j
     set status = 'completed', updated_at = now()
    from public.browser_agent_runs r
   where j.status = 'dispatched' and j.browser_run_id = r.id and r.status = 'completed';
  update public.application_dispatch_jobs j
     set status = 'failed', updated_at = now(), error_code = coalesce(r.error_code,'BROWSER_RUN_FAILED')
    from public.browser_agent_runs r
   where j.status = 'dispatched' and j.browser_run_id = r.id and r.status in ('failed','cancelled');
  select count(*) into active_dispatches from public.application_dispatch_jobs
   where status in ('claimed','dispatching');
  return query with due as (
    select id from public.application_dispatch_jobs
     where status = 'queued' and next_attempt_at <= now() and attempts < 3
     order by created_at for update skip locked
     limit least(greatest(max_jobs,0),greatest(0,2-active_dispatches))
  ) update public.application_dispatch_jobs j
       set status = 'claimed', attempts = attempts + 1,
           lease_until = now() + interval '90 seconds', updated_at = now()
      from due where j.id = due.id returning j.*;
end
$application_claim$;

create or replace function public.begin_application_dispatch(target_job_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $application_begin$
declare changed integer;
begin
  update public.application_dispatch_jobs
     set status = 'dispatching', lease_until = now() + interval '90 seconds', updated_at = now()
   where id = target_job_id and status = 'claimed' and lease_until > now();
  get diagnostics changed = row_count;
  return changed = 1;
end
$application_begin$;
revoke all on function public.claim_application_dispatch_jobs(integer) from public, anon, authenticated;
revoke all on function public.begin_application_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.claim_application_dispatch_jobs(integer) to service_role;
grant execute on function public.begin_application_dispatch(uuid) to service_role;

-- 202610090002: durable website/PDF analysis outbox.
create table if not exists public.source_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  company_id uuid not null references public.companies(id),
  asset_id uuid references public.company_assets(id),
  requested_by uuid not null references auth.users(id),
  kind text not null check (kind in ('company', 'pitch_deck')),
  analysis_run_id uuid,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  idempotency_key text not null unique,
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_analysis_jobs_target check
    ((kind = 'company' and asset_id is null and analysis_run_id is not null) or
     (kind = 'pitch_deck' and asset_id is not null and analysis_run_id is null))
);
create unique index if not exists source_analysis_jobs_one_active_target
  on public.source_analysis_jobs(company_id, kind, coalesce(asset_id, company_id))
  where status in ('queued','running');
create index if not exists source_analysis_jobs_due
  on public.source_analysis_jobs(next_attempt_at, created_at) where status = 'queued';
alter table public.source_analysis_jobs enable row level security;
revoke all on public.source_analysis_jobs from public, anon, authenticated;
grant select, insert, update on public.source_analysis_jobs to service_role;

create or replace function public.claim_source_analysis_jobs(max_jobs integer default 1)
returns setof public.source_analysis_jobs
language plpgsql security definer set search_path = '' as $source_claim$
begin
  update public.source_analysis_jobs
     set status = case when attempts >= 3 then 'failed' else 'queued' end,
         next_attempt_at = now() + make_interval(secs => least(300, (15 * power(2, attempts))::integer)),
         lease_until = null, error_code = 'WORKER_LEASE_EXPIRED', updated_at = now()
   where status = 'running' and lease_until < now();
  return query with due as (
    select id from public.source_analysis_jobs
     where status = 'queued' and next_attempt_at <= now() and attempts < 3
     order by created_at for update skip locked limit least(greatest(max_jobs,0),1)
  ) update public.source_analysis_jobs j
       set status = 'running', attempts = attempts + 1,
           lease_until = now() + interval '6 minutes', updated_at = now()
      from due where j.id = due.id returning j.*;
end
$source_claim$;
revoke all on function public.claim_source_analysis_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_source_analysis_jobs(integer) to service_role;

-- Fail closed if an already-existing outbox has a partial/incompatible shape.
do $final_checks$
declare bad text;
begin
  select string_agg(format('%s.%s expected %s, found %s',v.tbl,v.col,v.typ,
                           coalesce(format_type(a.atttypid,a.atttypmod),'<missing>')), ', ') into bad
  from (values
    ('application_submit_authorizations','id','uuid'),
    ('application_submit_authorizations','workspace_id','uuid'),
    ('application_submit_authorizations','company_id','uuid'),
    ('application_submit_authorizations','application_id','uuid'),
    ('application_submit_authorizations','program_id','uuid'),
    ('application_submit_authorizations','approved_fill_run_id','uuid'),
    ('application_submit_authorizations','authorized_by','uuid'),
    ('application_submit_authorizations','authorized_at','timestamp with time zone'),
    ('application_submit_authorizations','expires_at','timestamp with time zone'),
    ('application_submit_authorizations','revoked_at','timestamp with time zone'),
    ('application_submit_authorizations','dispatched_at','timestamp with time zone'),
    ('application_dispatch_jobs','id','uuid'),
    ('application_dispatch_jobs','workspace_id','uuid'),
    ('application_dispatch_jobs','company_id','uuid'),
    ('application_dispatch_jobs','application_id','uuid'),
    ('application_dispatch_jobs','requested_by','uuid'),
    ('application_dispatch_jobs','kind','text'),
    ('application_dispatch_jobs','request_intent','jsonb'),
    ('application_dispatch_jobs','correlation_id','uuid'),
    ('application_dispatch_jobs','browser_run_id','uuid'),
    ('application_dispatch_jobs','external_run_id','text'),
    ('application_dispatch_jobs','idempotency_key','text'),
    ('application_dispatch_jobs','lease_until','timestamp with time zone'),
    ('application_dispatch_jobs','attempts','integer'),
    ('application_dispatch_jobs','status','text'),
    ('application_dispatch_jobs','next_attempt_at','timestamp with time zone'),
    ('application_dispatch_jobs','error_code','text'),
    ('application_dispatch_jobs','created_at','timestamp with time zone'),
    ('application_dispatch_jobs','updated_at','timestamp with time zone'),
    ('source_analysis_jobs','id','uuid'),
    ('source_analysis_jobs','workspace_id','uuid'),
    ('source_analysis_jobs','company_id','uuid'),
    ('source_analysis_jobs','requested_by','uuid'),
    ('source_analysis_jobs','kind','text'),
    ('source_analysis_jobs','analysis_run_id','uuid'),
    ('source_analysis_jobs','asset_id','uuid'),
    ('source_analysis_jobs','idempotency_key','text'),
    ('source_analysis_jobs','lease_until','timestamp with time zone'),
    ('source_analysis_jobs','attempts','integer'),
    ('source_analysis_jobs','status','text'),
    ('source_analysis_jobs','next_attempt_at','timestamp with time zone'),
    ('source_analysis_jobs','error_code','text'),
    ('source_analysis_jobs','created_at','timestamp with time zone'),
    ('source_analysis_jobs','updated_at','timestamp with time zone')
  ) as v(tbl,col,typ)
  left join pg_attribute a on a.attrelid = format('public.%I',v.tbl)::regclass
    and a.attname = v.col and a.attnum > 0 and not a.attisdropped
  where a.attname is null or format_type(a.atttypid,a.atttypmod) <> v.typ;
  if bad is not null then raise exception 'Existing outbox table has incompatible columns: %', bad; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.application_submit_authorizations'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.application_dispatch_jobs'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.source_analysis_jobs'::regclass)
  then
    raise exception 'Required RLS is disabled on an authorization/job table';
  end if;
  if not exists (
    select 1 from pg_index i join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.application_submit_authorizations'::regclass
      and i.indisunique and i.indnkeyatts = 1 and a.attname = 'application_id'
  ) or not exists (
    select 1 from pg_index i join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.application_dispatch_jobs'::regclass
      and i.indisunique and i.indnkeyatts = 1 and a.attname = 'idempotency_key'
  ) or not exists (
    select 1 from pg_index i join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.source_analysis_jobs'::regclass
      and i.indisunique and i.indnkeyatts = 1 and a.attname = 'idempotency_key'
  ) then
    raise exception 'Required unique application/job key is missing';
  end if;
  if not exists (
    select 1 from pg_index i join pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = 'public.application_dispatch_jobs'::regclass
      and idx.relname = 'application_dispatch_jobs_one_active_kind'
      and i.indisunique and i.indpred is not null
      and position('application_id' in pg_get_indexdef(idx.oid)) > 0
      and position('kind' in pg_get_indexdef(idx.oid)) > 0
  ) or not exists (
    select 1 from pg_index i join pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = 'public.source_analysis_jobs'::regclass
      and idx.relname = 'source_analysis_jobs_one_active_target'
      and i.indisunique and i.indpred is not null
      and position('company_id' in pg_get_indexdef(idx.oid)) > 0
      and position('kind' in pg_get_indexdef(idx.oid)) > 0
  ) then
    raise exception 'Required partial unique job index is missing or incompatible';
  end if;
  if exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid in (
      'public.claim_application_dispatch_jobs(integer)'::regprocedure,
      'public.begin_application_dispatch(uuid)'::regprocedure,
      'public.claim_source_analysis_jobs(integer)'::regprocedure
    ) and acl.privilege_type = 'EXECUTE'
      and (acl.grantee = 0::oid or acl.grantee not in (p.proowner,'service_role'::regrole))
  ) then
    raise exception 'A SECURITY DEFINER job function has an unexpected EXECUTE grantee';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.claim_application_dispatch_jobs(integer)'::regprocedure,
      'public.begin_application_dispatch(uuid)'::regprocedure,
      'public.claim_source_analysis_jobs(integer)'::regprocedure
    ) and (not p.prosecdef or p.proowner in ('anon'::regrole,'authenticated'::regrole))
  ) then
    raise exception 'Job function SECURITY DEFINER owner/properties are unsafe';
  end if;
  if not has_function_privilege('service_role',
    'public.claim_application_dispatch_jobs(integer)', 'EXECUTE')
     or not has_function_privilege('service_role',
    'public.begin_application_dispatch(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role',
    'public.claim_source_analysis_jobs(integer)', 'EXECUTE') then
    raise exception 'Service role lacks job function EXECUTE';
  end if;
  if exists (select 1 from storage.buckets where id = 'pitch-decks' and public) then
    raise exception 'pitch-decks bucket unexpectedly public';
  end if;
  if not exists (
    select 1 from pg_policy p
    where p.polrelid = 'storage.objects'::regclass
      and p.polname = 'pitch_decks_owner_guard_phase2'
      and not p.polpermissive and p.polcmd = '*' and 0::oid = any(p.polroles)
      and position('pitch-decks' in pg_get_expr(p.polqual,p.polrelid)) > 0
      and position('workspace_members' in pg_get_expr(p.polqual,p.polrelid)) > 0
      and position('owner' in pg_get_expr(p.polqual,p.polrelid)) > 0
      and position('pitch-decks' in pg_get_expr(p.polwithcheck,p.polrelid)) > 0
      and position('workspace_members' in pg_get_expr(p.polwithcheck,p.polrelid)) > 0
      and position('owner' in pg_get_expr(p.polwithcheck,p.polrelid)) > 0
  ) then
    raise exception 'Pitch deck restrictive Storage guard is missing or incompatible';
  end if;
  if exists (
    select 1 from (values
      ('pitch_decks_owner_select_phase2','r'),
      ('pitch_decks_owner_insert_phase2','a'),
      ('pitch_decks_owner_delete_phase2','d')
    ) as expected(policy_name,command_code)
    left join pg_policy p on p.polrelid = 'storage.objects'::regclass
      and p.polname = expected.policy_name
    where p.oid is null or not p.polpermissive or p.polcmd <> expected.command_code
      or not ('authenticated'::regrole = any(p.polroles))
      or coalesce(position('pitch-decks' in pg_get_expr(
        case when expected.command_code = 'a' then p.polwithcheck else p.polqual end,
        p.polrelid)),0) = 0
      or coalesce(position('workspace_members' in pg_get_expr(
        case when expected.command_code = 'a' then p.polwithcheck else p.polqual end,
        p.polrelid)),0) = 0
      or coalesce(position('owner' in pg_get_expr(
        case when expected.command_code = 'a' then p.polwithcheck else p.polqual end,
        p.polrelid)),0) = 0
  ) then
    raise exception 'Pitch deck owner Storage policies are missing or incompatible';
  end if;
end
$final_checks$;

commit;
