-- PROPOSAL ONLY. Review and apply through the normal migration process.
-- This file has not been executed against any Supabase project.
--
-- Canonical profiles have exactly two valid states:
--   unconfirmed: canonical_profile, profile_confirmed_at and profile_confirmed_by are all NULL
--   confirmed:   canonical_profile, profile_confirmed_at and profile_confirmed_by are all NOT NULL
-- Existing legacy rows are not rewritten. Their ordinary company fields remain editable, but the
-- next material change to a protected field must move the row into one of the valid states.

begin;

do $preflight$
begin
  if to_regclass('public.companies') is null
     or to_regclass('public.workspace_members') is null then
    raise exception 'Required companies/workspace_members tables are missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.companies'::regclass and attname = 'workspace_id' and not attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.companies'::regclass and attname = 'canonical_profile'
       and atttypid = 'jsonb'::regtype and not attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.companies'::regclass and attname = 'profile_confirmed_at'
       and atttypid = 'timestamptz'::regtype and not attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.companies'::regclass and attname = 'profile_confirmed_by'
       and atttypid = 'uuid'::regtype and not attisdropped
  ) then
    raise exception 'Canonical profile columns are missing or have unexpected types';
  end if;

  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.companies'::regclass)
     or not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.workspace_members'::regclass) then
    raise exception 'RLS must remain enabled on public.companies and public.workspace_members';
  end if;

  if to_regprocedure('auth.uid()') is null or to_regprocedure('auth.jwt()') is null then
    raise exception 'Required Supabase Auth helper functions are missing';
  end if;
end
$preflight$;

create or replace function public.enforce_canonical_profile_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_role text := coalesce(auth.jwt() ->> 'role', '');
  is_unconfirmed boolean;
  is_confirmed boolean;
begin
  -- UPDATE OF triggers fire when a protected column is named in SET, even if its value is unchanged.
  -- Preserve harmless no-ops and allow legacy rows to receive ordinary updates without rewriting data.
  if tg_op = 'UPDATE'
     and new.canonical_profile is not distinct from old.canonical_profile
     and new.profile_confirmed_at is not distinct from old.profile_confirmed_at
     and new.profile_confirmed_by is not distinct from old.profile_confirmed_by then
    return new;
  end if;

  is_unconfirmed := new.canonical_profile is null
                    and new.profile_confirmed_at is null
                    and new.profile_confirmed_by is null;
  is_confirmed := new.canonical_profile is not null
                  and new.profile_confirmed_at is not null
                  and new.profile_confirmed_by is not null;

  if not is_unconfirmed and not is_confirmed then
    raise exception 'canonical_profile_confirmation_state_invalid' using errcode = '23514';
  end if;

  -- Normal onboarding inserts an unconfirmed company. Existing company RLS remains authoritative.
  if tg_op = 'INSERT' and is_unconfirmed then
    return new;
  end if;

  -- The service role bypasses actor ownership only; it cannot bypass state consistency.
  if request_role = 'service_role' then
    return new;
  end if;

  if actor_id is null or not exists (
    select 1
      from public.workspace_members wm
     where wm.workspace_id = new.workspace_id
       and wm.user_id = actor_id
       and wm.role = 'owner'
  ) then
    raise exception 'canonical_profile_owner_required' using errcode = '42501';
  end if;

  -- A current owner may reconfirm a profile created by a historic owner, but the new
  -- confirmation must record the current actor. Clearing all three fields is allowed.
  if is_confirmed and new.profile_confirmed_by is distinct from actor_id then
    raise exception 'canonical_profile_confirmer_mismatch' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_canonical_profile_owner() from public, anon, authenticated, service_role;

drop trigger if exists companies_canonical_profile_owner_insert on public.companies;
create trigger companies_canonical_profile_owner_insert
before insert on public.companies
for each row execute function public.enforce_canonical_profile_owner();

drop trigger if exists companies_canonical_profile_owner on public.companies;
create trigger companies_canonical_profile_owner
before update of canonical_profile, profile_confirmed_at, profile_confirmed_by
on public.companies
for each row execute function public.enforce_canonical_profile_owner();

commit;
