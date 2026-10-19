# Supabase migration plan — owner approval required

Only one Supabase project is currently known. No migration was applied in this implementation. Do **not** run the destructive `test:supabase-rls` fixture against that project: it creates and deletes users and rows.

## Prerequisites

1. Export a database backup/snapshot and confirm a restore procedure in Supabase Dashboard. Export the private Storage bucket inventory and review existing policies. Record the backup timestamp and operator.
2. Run `npm run verify:production-schema` for a non-mutating PostgREST probe, then run `scripts/production-schema-readonly.sql` in Supabase SQL Editor. Compare output with the expected columns, enum values, RLS status, policies and functions. Neither probe proves that all constraints work.
3. Establish a separate staging Supabase project before testing writes. The checkout does not contain the original foundational migrations for the existing application tables/types; obtain their baseline or a schema-only dump from the project before applying later migrations elsewhere.
4. Confirm Vercel plan. The committed five-minute cron expressions require a paid plan; Hobby allows daily cron only and is unsuitable for the intended Autopilot latency.

## Exact application order (after review and backup)

Open each SQL file in Supabase SQL Editor and execute it separately, in this order. Inspect the result and rerun the read-only probe between files. Do not use `supabase db push` against the sole remote project until migration history is reconciled; it may apply unrelated earlier migrations.

For a future **staging** database with `psql` installed, have a secret manager inject staging-only `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` and `PGSSLMODE=require`. Do not put a password in command arguments or shell history. The exact ordered commands from the repository root are below. Run one at a time and stop on the first error; do not point these environment variables at the sole remote project without separate approval.

```powershell
psql -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/202610070001_pitch_deck_analysis.sql"
psql -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/202610080001_unified_startup_intelligence.sql"
psql -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/202610080002_skyvern_submission_safety.sql"
psql -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/202610090001_application_dispatch_jobs.sql"
psql -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/202610090002_source_analysis_jobs.sql"
```

1. `supabase/migrations/202610070001_pitch_deck_analysis.sql` — adds extraction columns, private bucket and scoped Storage policies. Review existing bucket/policies before running.
2. `supabase/migrations/202610080001_unified_startup_intelligence.sql` — adds unified analysis and founder-confirmed canonical profile columns.
3. `supabase/migrations/202610080002_skyvern_submission_safety.sql` — adds `submission_unverified` and the scoped authorization ledger. Commit this SQL Editor execution before using the new enum value.
4. `supabase/migrations/202610090001_application_dispatch_jobs.sql` — adds the application outbox, leases, atomic claim/begin RPCs and private RLS.
5. `supabase/migrations/202610090002_source_analysis_jobs.sql` — adds PDF fingerprint and durable company/PDF analysis jobs.

Migration 4 depends on existing `workspaces`, `companies`, `accelerator_applications`, `browser_agent_runs`, `auth.users` and `service_role`. Migration 5 additionally depends on `company_assets`. All are expected to be pre-existing but foundational DDL is absent from this checkout. Stop if any prerequisite differs; do not patch production ad hoc.

## After approval

Run `scripts/production-schema-readonly.sql` again. In staging, run `npm run test:supabase-rls` and an owned-form Skyvern test. Verify cron RPC grants, `application_dispatch_jobs`/`source_analysis_jobs` RLS, private bucket policies, and status transitions. Only then configure Vercel production secrets and deploy Review Mode. Keep `SKYVERN_AUTO_SUBMIT_ENABLED=false` until separate approval and a controlled Autopilot test.

Rollback: prefer redeploying the previous Vercel build and disabling cron/feature flags. The new migrations add columns/tables/functions; do not drop them or reverse enum values without a reviewed data migration and backup. Existing queued/unknown jobs must be reconciled before rollback.
