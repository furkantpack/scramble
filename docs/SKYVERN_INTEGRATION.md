# Scramble Skyvern application agent

Scramble uses the existing `@skyvern/client` SDK and application-agent repository. Filling and final submission are separate Skyvern tasks. The first release is **review-only**: a founder must inspect the filled portal and click Submit Application for that specific application. Program-specific scheduled auto-submit exists behind a disabled-by-default feature flag. There is no global or batch authorization.

## Configuration

Set these server-only variables in the deployment secret manager (or ignored `.env.local` for local development):

```env
SKYVERN_API_KEY=
BROWSER_AGENT_PROVIDER=skyvern
SKYVERN_BASE_URL=https://api.skyvern.com
APPLICATION_AGENT_REPOSITORY=supabase
SKYVERN_AUTO_SUBMIT_ENABLED=false
APPLICATION_AGENT_CRON_SECRET=
CRON_SECRET=
```

Skyvern callbacks are deliberately disabled because this installed SDK's webhook signing contract has not been independently verified. The UI and protected cron endpoint poll persisted run IDs. Do not configure a Skyvern callback URL until its current official signing scheme has been confirmed and tested. Mock mode must be selected explicitly with `BROWSER_AGENT_PROVIDER=mock` and is rejected in production. Never use `NEXT_PUBLIC_` for the API key. Set the normal Supabase server credentials separately.

The Skyvern credential was verified using the installed SDK's read-only browser-session listing. This does **not** prove a form-filling or submission run works.

## Database step

After backup and staging verification, apply the migrations in `docs/PRODUCTION_MIGRATION_PLAN.md` order. `202610080002_skyvern_submission_safety.sql` adds `submission_unverified` and a private authorization ledger; `202610090001_application_dispatch_jobs.sql` adds the durable dispatch outbox and atomic claim/begin RPCs. The integration reuses `accelerator_applications`, `application_questions`, `application_answers`, `company_assets`, `browser_agent_runs`, `browser_agent_artifacts`, and `audit_logs`.

Do not apply migrations or enable a production release without operator review. Earlier unified-profile migrations must be applied first because a founder-confirmed canonical profile is required for fill.

## Execution and trust boundaries

The server verifies the authenticated founder's workspace and company, loads the program's official application URL, checks its open/deadline state, loads the founder-confirmed startup profile, and reads approved answers from Supabase. Browser-supplied answer text and file URLs are not sent to Skyvern. If the founder explicitly selects a PDF deck, the server resolves the latest asset within that company and issues a 30-minute private Storage signed URL. Missing required answers, unapproved documents, unsupported required uploads, and unavailable canonical profile stop the run.

The fill prompt forbids final submission and unknown declarations. Skyvern may navigate a multi-step form but must pause for login, OTP, CAPTCHA, missing answers, unsupported uploads, or terms requiring founder approval. The UI shows provider-reported status and screenshots only; it no longer claims that individual fields were filled without evidence.

A separate founder-admin request containing `confirmSubmit: true` and the exact completed fill run ID queues submission. Both fill and submit tasks have zero SDK retries because the installed SDK exposes no confirmed provider idempotency/correlation contract. An ambiguous, timed-out, or failed submit is `submission_unverified`, never `submitted`, and cannot be retried automatically. Confirmation requires a completed Skyvern run, `submitted: true`, confirmation text, and a final URL or screenshot. The founder must verify the portal before any further action.

### Optional authorized auto-submit

Keep `SKYVERN_AUTO_SUBMIT_ENABLED=false` until a safe staging end-to-end test has passed. When explicitly enabled, the founder must review a completed Skyvern fill and authorize **that application and exact fill run**. The server records the authenticated founder, startup, program, fill run, one-hour expiry and audit event. The founder may revoke until the atomic dispatch claim. Set a strong Vercel `CRON_SECRET` (`APPLICATION_AGENT_CRON_SECRET` remains a fallback). `vercel.json` schedules the protected endpoint every five minutes; this requires a compatible Vercel plan. The cron reconciles active runs, queues scoped authorizations, and atomically claims at most two dispatch jobs per invocation. It never retries an uncertain final submission. Disable the feature flag to stop new authorizations and dispatches.

Jobs, runs, idempotency keys, correlation IDs, transitions, artifacts, and audits are persisted in Supabase. The initiating request inserts a job and may trigger opportunistic post-response dispatch; cron recovers queued work. A lease expiring before provider dispatch can retry with backoff. A lease expiring after dispatch begins becomes `unknown_dispatch` and is never automatically retried. A founder can cancel a queued or claimed job, not an already-started provider task. A new fill attempt is limited to three explicit versions; no final-submit attempt is automatically repeated. A workspace is limited to two active browser runs and five starts per minute.

## Safe test procedure

1. Apply migrations in a staging Supabase project and configure server-only credentials.
2. Use a synthetic founder profile and an application record pointing to an **owned, safe test form**, never a real accelerator application.
3. Approve test answers, click Fill, and confirm the Skyvern task stops before Submit.
4. Inspect screenshots and the external test form. Test login/CAPTCHA, missing-answer, invalid URL, and expired-run behavior with mocks.
5. If testing actual submission, use only the owned test form and explicitly click the separate Submit button. Check that confirmation evidence is persisted. Do not run this against third-party programs without the founder's real authorization.

Automated tests use mock SDK/provider responses and never submit a real application. A live fill/submit end-to-end test has **not** been run as part of setup.

## Remaining operational limits

- Program-scoped auto-submit is implemented but **disabled**. Do not enable it before reviewing the migration, scheduling the cron, and completing a safe staging form test. Batch authorization is not supported.
- The PostgreSQL outbox is the durable queue and Vercel Cron is its dispatcher; no separate worker server is required. The provider-acceptance-to-run-ID window cannot be closed with the installed SDK. `unknown_dispatch` requires operator reconciliation against Skyvern, especially before any final submission retry. Do not mark it successful or enqueue a duplicate.
- The five-minute cron requires a compatible Vercel plan. A separate staging Supabase project, migration review, owned-form live Skyvern test, and key rotation are required before production release.
- The existing question-extraction workflow is not complete for every program. Skyvern can discover form fields, but unknown required answers pause for founder input.
- Webhooks are disabled pending official signature verification. Protected polling must be scheduled in production.
