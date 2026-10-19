-- Review in a backed-up staging database before applying to the sole remote project.
-- This outbox stores IDs and non-sensitive request intent, never profile text or signed files.
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
    ('queued', 'claimed', 'dispatching', 'dispatched', 'completed', 'failed', 'cancelled', 'unknown_dispatch')),
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
  where status in ('queued', 'claimed', 'dispatching', 'dispatched', 'unknown_dispatch');
create index if not exists application_dispatch_jobs_due
  on public.application_dispatch_jobs(next_attempt_at, created_at)
  where status = 'queued';
create index if not exists application_dispatch_jobs_lease
  on public.application_dispatch_jobs(lease_until)
  where status in ('claimed', 'dispatching');

alter table public.application_dispatch_jobs enable row level security;
revoke all on public.application_dispatch_jobs from public, anon, authenticated;
grant select, insert, update on public.application_dispatch_jobs to service_role;

-- A claim is atomic and uses SKIP LOCKED. A lease that expires after dispatch
-- started becomes UNKNOWN, never queued again: Skyvern may have accepted it.
create or replace function public.claim_application_dispatch_jobs(max_jobs integer default 2)
returns setof public.application_dispatch_jobs
language plpgsql security definer set search_path = '' as $$
declare active_dispatches integer;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(9210921) then return; end if;
  update public.application_dispatch_jobs
     set status = 'unknown_dispatch', lease_until = null, error_code = 'LEASE_EXPIRED_AFTER_DISPATCH', updated_at = now()
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
     set status = 'failed', updated_at = now(), error_code = coalesce(r.error_code, 'BROWSER_RUN_FAILED')
    from public.browser_agent_runs r
   where j.status = 'dispatched' and j.browser_run_id = r.id and r.status in ('failed', 'cancelled');
  select count(*) into active_dispatches from public.application_dispatch_jobs
   where status in ('claimed', 'dispatching');
  return query
    with due as (
      select id from public.application_dispatch_jobs
       where status = 'queued' and next_attempt_at <= now() and attempts < 3
       order by created_at for update skip locked
       limit least(greatest(max_jobs, 0), greatest(0, 2 - active_dispatches))
    )
    update public.application_dispatch_jobs j
       set status = 'claimed', attempts = attempts + 1,
           lease_until = now() + interval '90 seconds', updated_at = now()
      from due where j.id = due.id returning j.*;
end;
$$;

create or replace function public.begin_application_dispatch(target_job_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update public.application_dispatch_jobs
     set status = 'dispatching', lease_until = now() + interval '90 seconds', updated_at = now()
   where id = target_job_id and status = 'claimed' and lease_until > now();
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.claim_application_dispatch_jobs(integer) from public, anon, authenticated;
revoke all on function public.begin_application_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.claim_application_dispatch_jobs(integer) to service_role;
grant execute on function public.begin_application_dispatch(uuid) to service_role;
