-- An ambiguous browser result must never be represented as a confirmed submission.
alter type public.application_status add value if not exists 'submission_unverified';

-- Existing accelerator_applications, browser_agent_runs, artifacts and audit_logs
-- remain the only tracking tables. Their workspace RLS policies are unchanged.

-- A narrowly scoped, revocable authorization is distinct from a submitted application.
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
revoke all on public.application_submit_authorizations from anon, authenticated;
grant select, insert, update on public.application_submit_authorizations to service_role;
-- Only trusted server code with the service role accesses this table after checking
-- the authenticated founder, workspace, company, program and exact fill run.
