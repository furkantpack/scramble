-- Durable source-analysis jobs. Review against the sole remote project before applying.
alter table public.company_assets add column if not exists content_sha256 text;

create table if not exists public.source_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  company_id uuid not null references public.companies(id),
  asset_id uuid references public.company_assets(id),
  requested_by uuid not null references auth.users(id),
  kind text not null check (kind in ('company', 'pitch_deck')),
  analysis_run_id uuid,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
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
  where status in ('queued', 'running');
create index if not exists source_analysis_jobs_due
  on public.source_analysis_jobs(next_attempt_at, created_at) where status = 'queued';
alter table public.source_analysis_jobs enable row level security;
revoke all on public.source_analysis_jobs from public, anon, authenticated;
grant select, insert, update on public.source_analysis_jobs to service_role;

create or replace function public.claim_source_analysis_jobs(max_jobs integer default 1)
returns setof public.source_analysis_jobs language plpgsql security definer set search_path = '' as $$
begin
  update public.source_analysis_jobs
     set status = case when attempts >= 3 then 'failed' else 'queued' end,
         next_attempt_at = now() + make_interval(secs => least(300, (15 * power(2, attempts))::integer)),
         lease_until = null, error_code = 'WORKER_LEASE_EXPIRED', updated_at = now()
   where status = 'running' and lease_until < now();
  return query with due as (
    select id from public.source_analysis_jobs
     where status = 'queued' and next_attempt_at <= now() and attempts < 3
     order by created_at for update skip locked limit least(greatest(max_jobs, 0), 1)
  ) update public.source_analysis_jobs j
       set status = 'running', attempts = attempts + 1,
           lease_until = now() + interval '6 minutes', updated_at = now()
      from due where j.id = due.id returning j.*;
end;
$$;
revoke all on function public.claim_source_analysis_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_source_analysis_jobs(integer) to service_role;
