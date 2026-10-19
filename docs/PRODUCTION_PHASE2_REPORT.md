# Scramble — Phase 2 production handoff

Date: 2026-10-09. Scope: local implementation and read-only inspection of the sole known Supabase project. No remote migration, user-data mutation, Vercel deployment, live Skyvern form fill/submission, DNS change, or credential rotation was performed.

## 1. Executive summary and verdict

**NOT READY FOR PRODUCTION.** Durable PostgreSQL outboxes, Vercel dispatch routes, asynchronous source-analysis jobs, conservative unknown-dispatch handling, CI, health/readiness checks and a migration plan are implemented locally. Offline tests and an optimized build pass. Release blockers remain: live schema drift, no separate staging Supabase project, no owned-form Skyvern end-to-end test, disclosed Skyvern credential requiring rotation, unconfirmed Vercel cron plan, and no production error-monitoring destination. Autopilot remains disabled by default.

## 2. Updated architecture

Founder/API → authenticated, scoped route → Supabase job row → atomic RPC claim → Vercel post-response task or protected cron → Skyvern Cloud or Firecrawl/Gemini → existing browser-run/Knowledge tables → status polling. Supabase PostgreSQL is the queue; there is no Redis or separate worker service. The service-role client is server-only and only used after an owner/company check at enqueue; workers recheck owner access before acting. Private deck Storage remains company-scoped.

Application jobs contain IDs and bounded request intent, not answer text, company profile, PDF URLs or credentials. The worker reloads approved context immediately before dispatch. The two scheduled endpoints are `/api/cron/application-agent` and `/api/cron/source-analysis`. Vercel `CRON_SECRET` bearer authentication is required; the legacy `APPLICATION_AGENT_CRON_SECRET` is a fallback. `/api/health` is public liveness; `/api/ready` is protected and checks essential DB/provider configuration, not end-to-end external availability.

## 3. Implementation and files

- `supabase/migrations/202610090001_application_dispatch_jobs.sql`: private application outbox, unique idempotency keys, one active job per application/kind, status/lease/attempt fields, correlation IDs, service-role-only RPCs for atomic claim and begin.
- `src/lib/application-agent/dispatch-jobs.ts`: authenticated enqueue, ownership and preflight, bounded retries before provider dispatch, fresh signed URL/context loading, conservative unknown dispatch, duplicate-key handling and queue status view. Existing fill/submit API routes now enqueue; `/api/applications/[id]/agent-job` supports pre-dispatch cancellation; agent-run status can surface queued/failed/unknown work.
- `src/lib/skyvern/fill-application.ts`: SDK retries set to zero. Installed `@skyvern/client` API offers task creation and run retrieval but no verified caller idempotency key or search-by-correlation that would guarantee exact-once dispatch.
- `src/app/api/cron/application-agent/route.ts`, `vercel.json`: bounded claim/dispatch and existing-run reconciliation every five minutes. It does not wait for browser automation to complete. Authorization for auto-submit is per application and fill run, time-limited, revocable and audited.
- `supabase/migrations/202610090002_source_analysis_jobs.sql`, `src/lib/knowledge/source-jobs.ts`, `/api/cron/source-analysis`: durable PDF/company jobs, leases, retry backoff, PDF validation and fingerprint reuse, and unified synthesis after deck completion. Website analysis still uses existing Firecrawl/Gemini services; no second scraper or profile store was created.
- `src/app/api/companies/[id]/analyze/route.ts`, `src/app/api/onboarding/pitch-deck/[assetId]/route.ts`, onboarding and profile UI: quick 202 queue responses and polling/background progress. Deck deletion is blocked while analysis is queued/running.
- `src/lib/knowledge/analyze-company.ts`: source fingerprint avoids a repeated Gemini synthesis when website/deck/founder inputs and saved Knowledge are unchanged. Founder-confirmed canonical profile remains separate; existing persistence rules prevent silent overwrite.
- `.github/workflows/ci.yml`, `.env.example`, `scripts/verify-production-schema.mjs`, `scripts/production-schema-readonly.sql`, `docs/PRODUCTION_MIGRATION_PLAN.md`, `docs/SKYVERN_INTEGRATION.md`: serial CI validation, read-only drift checks, staged migration/runbook and current operational behavior.
- `src/lib/application-agent/__tests__/dispatch-jobs.test.ts`, `src/lib/firecrawl/__tests__/source-jobs.test.ts`: PostgreSQL-compatible PGlite claim/lease/cancellation fixtures.

This checkout's Git metadata is not usable (`git status` cannot resolve its parent), so the list is based on inspected files, not a reliable commit diff.

## 4. Migration state and exact plan

No migration was applied remotely. A read-only PostgREST probe returned **14/18 available checks**. Company unified-profile columns and `company_assets` extraction/status/page/fingerprint columns returned HTTP 400, indicating schema mismatch or unavailable columns; the probe alone does not prove every table's constraints, RPCs or RLS policies. Outbox table probes were readable, but their server-side behavior remains unverified in that project. Foundational DDL for existing app tables/types is absent from this checkout. Docker and Supabase CLI were not available locally; PGlite covered migration function behavior only.

Before a write: create a separate staging Supabase project, obtain a schema-only baseline and migration history, back up the sole remote database and private bucket metadata, then run `scripts/production-schema-readonly.sql` as SELECT-only inspection. After owner review, execute separately in SQL Editor: `202610070001_pitch_deck_analysis.sql` → `202610080001_unified_startup_intelligence.sql` → `202610080002_skyvern_submission_safety.sql` → `202610090001_application_dispatch_jobs.sql` → `202610090002_source_analysis_jobs.sql`. Full instructions and rollback conditions are in `docs/PRODUCTION_MIGRATION_PLAN.md`. Do **not** use `supabase db push` against the sole project until migration history is reconciled; do **not** run the data-mutating `test:supabase-rls` there.

## 5. Durable jobs and failure semantics

`claim_application_dispatch_jobs` uses transaction advisory locking plus `FOR UPDATE SKIP LOCKED`, global maximum two claimed/dispatching jobs, 90-second leases and at most three pre-dispatch attempts with bounded backoff. `begin_application_dispatch` is an atomic transition. After it begins, timeout/crash/ambiguous provider or DB save errors become `unknown_dispatch`—never automatic redispatch. The worker persists the Scramble browser-run ID and provider run ID when known. Run polling reconciles completion. A DB-level partial unique index blocks duplicate active work per application/kind. The UI can cancel only queued/claimed work. This is **at-most-once automatic dispatch after begin**, not provider-guaranteed exact-once delivery; an operator must inspect Skyvern for unknown outcomes before any retry. An unknown final submission must not be inferred as successful.

`claim_source_analysis_jobs` uses atomic row locks, one claim per call, six-minute leases and up to three attempts. Cron can recover queued jobs after request termination. Processing is not guaranteed to finish within one cron invocation; larger PDFs/site analysis require hosted-duration measurement. Current error/status UI is functional but not a live performance proof.

## 6. Review and Autopilot modes

Review remains the default: founder-reviewed answers → scoped fill job → portal review → explicit final-submit request → separate submit job → conservative confirmation evidence. The application is marked submitted only when the existing Skyvern parser observes explicit success and confirmation evidence; uncertain outcomes remain `submission_unverified`. There is no independent portal-side verification for all accelerators.

Autopilot is behind `SKYVERN_AUTO_SUBMIT_ENABLED=false`. Existing per-program/application/exact-fill authorization is authenticated, expires after one hour, can be revoked before claim and is audited. Cron queues authorized final submissions only after checking current application and fill-run state. There is no blanket registration consent or batch-wide grant. Keep it disabled until staging and controlled owned-form tests pass. Unexpected legal declarations, fees and missing answers are not auto-approved.

## 7. Security and observability

The Skyvern key previously appeared in chat; treat it as disclosed. Rotate it in Skyvern and Vercel secret storage before production; do not reuse or print it. No key was added to `NEXT_PUBLIC_` config. Job routes validate auth/workspace/company, cron uses a timing-safe token comparison, deck objects remain private, SSRF URL guards and untrusted-source prompt boundaries are reused, and raw provider errors are not returned to founders. The signed deck URL remains a time-limited bearer URL sent to Skyvern; vendor retention and practical TTL need review. Workers use safe error codes and existing audit records rather than logging source text or secrets.

Monitoring integration point: alert on cron 5xx, queued jobs older than two intervals, `unknown_dispatch`, `submission_unverified`, failed source jobs, readiness 503, and provider rate limits. No Sentry/Datadog or equivalent destination is configured, so alerts are **not yet live**. No Skyvern webhook is enabled because its signing contract is unverified. Existing security headers are a baseline; a complete CSP/HSTS and hosted header check remain open.

## 8. Performance evidence and limits

On this host the optimized build compiled in about **31.4 s**, TypeScript in **36.9 s**, and generated **41 static pages in 3.0 s** with CI-only temporary Signal Engine values; exit 0. The first build attempt was blocked by Windows parent-path sandbox access; the next exposed only ~30 MB free disk and missing local Signal Engine values. Clearing only generated `.next/cache` and using process-local non-production values allowed a full build. Disk space remained tight (~80 MB after build); CI needs adequate storage. No Core Web Vitals, production request latency, EXPLAIN, real Gemini token savings or 100-founder load test was measured. Fingerprint and bounded page/query work reduce repeat work by design, not by a measured percentage.

## 9. Actual tests

`npm run typecheck`: pass. `npm run lint`: exit 0 with **97 warnings and 24 infos**, mostly existing diagnostics. `npm run build`: pass with the environment caveat above. Serial offline suites: Firecrawl **21/21**, Gemini **15/15**, application agent **12/12**, accelerators **6/6**, signal engine **7/7**, goal engine **12/12**, slice engine **87/87**, equity lifecycle **49/49**—all passed. PGlite tests exercise application atomic claim, lease expiry, unknown dispatch and cancellation, plus source claim/retry. These do not replace Supabase-hosted RLS/RPC tests, a real Vercel cron test, or a live Skyvern owned-form test. GitHub Actions workflow was added but has **not run on GitHub**. No live PDF/website generation run was made in this Phase 2 work.

## 10. Vercel deployment and environment

`vercel.json` defines two `*/5 * * * *` schedules. This requires confirmation of the actual Vercel plan; [Vercel cron documentation](https://vercel.com/docs/cron-jobs/manage-cron-jobs) limits Hobby to daily execution, which cannot meet this five-minute design. If the project is Hobby, upgrade or agree on a lower-latency supported scheduler before deploying this config. Cron routes require `CRON_SECRET` of at least 32 characters. CI runs `npm ci`, typecheck, lint, all offline suites serially, then build using non-production placeholders; it does not deploy or apply migrations.

Production server-only variables: Supabase URL/service-role credentials, `SKYVERN_API_KEY`, `BROWSER_AGENT_PROVIDER=skyvern`, `GEMINI_API_KEY`, `FIRECRAWL_API_KEY`, `CRON_SECRET`, and existing Signal Engine encryption/cron settings where those routes are deployed. Browser Supabase publishable URL/key remain public. Use `.env.example` as the complete variable inventory; set all secrets in Vercel environment settings and never commit `.env.local`. Confirm Node runtime/duration support for the two cron routes and `after()` work on the selected Vercel plan before rollout.

Deploy order: stage and test schema → rotate secrets → configure Vercel environment/cron/monitoring → deploy Review Mode with Autopilot off → verify readiness, auth, onboarding, Knowledge generation and an owned-form fill/submit → explicitly approve any Autopilot enablement. Roll back by disabling flags/cron and redeploying the prior build; do not casually drop additive tables or reverse enum values. Reconcile queued/unknown jobs before rollback.

## 11. Remaining risks and owner decisions

1. **Vercel plan/frequency:** Which plan is this project on? Recommended: Pro or Enterprise supporting five-minute cron; alternative: approved external scheduler or accept daily-only operation with a different product SLA. Until answered, the committed cron configuration cannot be certified deployable.
2. **Staging and schema:** Provision a separate staging Supabase project and provide a verified baseline/migration history. Recommended: test all five reviewed migrations and `test:supabase-rls` there before the sole remote project. Without it, migration and tenant isolation cannot be safely validated.
3. **Production schema approval:** Owner must review backup, read-only SQL output, migration order and rollback plan, then explicitly approve remote writes. Until then, schema-dependent new flows may fail.
4. **Skyvern credential and live test:** Rotate the disclosed key; provide/approve a project-owned multi-step test form with PDF upload and confirmation page. No live task will be started or submitted without that approval. Without it, fill/submit and evidence handling remain unproven.
5. **Monitoring and Autopilot:** Select an alert destination/on-call owner; separately approve the feature flag only after a controlled review of authorization, unknown-dispatch and submission evidence. Until then, Review Mode only.

There is no verified release date or production-ready claim until these blockers are closed and revalidated.
