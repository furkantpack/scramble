# App user identity integration

## Invariants

- `ApiActor.appUserId` is always `public.app_users.id`.
- `ApiActor.authUserId` is always `auth.users.id`.
- A `workspace_members.id` is never used as a domain actor ID.
- Signup does not create an `app_users` row because no trustworthy `company_id` exists yet.
- Provisioning starts only after a company is verified to belong to one of the authenticated user's workspaces.
- An existing `app_users` row is never reassigned to another company or given a different role by automatic provisioning.

The onboarding flow provisions through a server endpoint after company creation and before onboarding is marked complete. Domain API authentication also performs the same idempotent resolution so existing users with an established company are repaired on first use. Both paths write with the service role; browser roles retain no direct access to `app_users`.

## Current multi-company limitation

`public.app_users.auth_user_id` is globally unique, and the RLS helpers `auth_company_id()`, `auth_role()`, and `auth_app_user_id()` resolve a single row with `limit 1`. This models one authenticated account as belonging to exactly one domain company. It conflicts with allowing the same auth user to participate in multiple companies.

This change deliberately does not alter that constraint. If an account already has an `app_users` row for company A, provisioning for company B fails with `app_user_company_conflict`. Removing the constraint alone would be unsafe: every RLS helper and company-selection mechanism would become ambiguous. Multi-company support requires an explicit active-company context, a unique constraint such as `(auth_user_id, company_id)`, updated RLS helpers/policies, and migration of every company-scoped authorization path as one reviewed change.

## Database migration

No new SQL migration is required for this integration when the reviewed full-schema migration is already applied. It already enables RLS on `app_users`, revokes access from `anon` and `authenticated`, and grants table writes only to `service_role`. The application now uses that existing boundary.
