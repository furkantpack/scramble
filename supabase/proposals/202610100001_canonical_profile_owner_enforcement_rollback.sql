-- REVIEWED ROLLBACK ONLY. This removes enforcement objects and does not modify company data.

begin;

drop trigger if exists companies_canonical_profile_owner_insert on public.companies;
drop trigger if exists companies_canonical_profile_owner on public.companies;
drop function if exists public.enforce_canonical_profile_owner();

commit;
