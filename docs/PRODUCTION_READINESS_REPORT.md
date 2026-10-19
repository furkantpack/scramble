# Scramble production readiness audit

Date: 2026-10-09 (Europe/Istanbul). Scope: inspected repository and safe local checks. No production deployment, schema mutation, live accelerator fill, or real submission was performed.

## A. Executive summary and verdict

**Verdict: NOT READY FOR PRODUCTION.** The Next.js application compiles, the available offline suites pass when run serially, and the application agent has explicit authorization, durable run records, and a conservative unknown-submission state. However, the current Supabase schema was not confirmed against the two latest migrations, the Skyvern fill/submit path has not passed an owned-form end-to-end test, no production scheduler/deployment platform is configured, and a provider-accepted task can be orphaned if the server dies before its run ID is persisted. These are release blockers, not hypothetical benchmarks.

Strengths: server-side credentials; workspace/company checks before privileged operations; private PDF Storage policies in migration; bounded Firecrawl acquisition; structured Gemini output validation; separate fill and final-submit commands; no automatic retry of uncertain final submission. Highest risks: unsupported/unapplied database schema, orphaned or ambiguous Skyvern run, unreliable confirmation evidence, unverified deployment controls, and publicly disclosed Skyvern credential requiring rotation.

## B. Actual technology stack and architecture

- Next.js **16.3.4** installed (App Router, route handlers, Turbopack build), React **19.2.7**, TypeScript **5.9.3**, Node **22.12.0** in the audit environment. `package.json` allows compatible newer versions; the installed build banner is the exact Next.js version tested.
- Supabase Auth, PostgREST, Storage and typed `@supabase/supabase-js`; cookie-based SSR client for pages and bearer-token verification for application-agent APIs. Privileged writes use server-only service-role client after an actor/company check.
- Gemini via `@google/genai`, default code model `gemini-3.8-flash` (override `GEMINI_MODEL`). Firecrawl SDK `4.41.0` handles website extraction. `@skyvern/client` is declared `^1.0.24` and the installed SDK's `runTask`, `getRun`, and browser-session methods are used. No second browser automation framework was added.
- Founder UI is under App Router pages such as `/onboarding`, `/profile`, `/knowledge-base`, `/introductions`, and `/dashboard/founder-dashboard`. Backend route handlers live under `src/app/api`. Skyvern tasks are started by authenticated routes and reconciled by UI polling or a protected cron route.
- **Hosting platform not established**: README has a Vercel template link, but there is no deployment manifest or CI workflow proving the target platform. DNS, HTTPS termination, scheduled jobs, secrets and rollback are therefore deployment-owner decisions.

## C. Security findings

| Severity | Area/files | Finding, mitigation, remaining concern |
| --- | --- | --- |
| P0 | Skyvern credential / ignored `.env.local` | A credential was supplied in chat. It was put only in server-side ignored env configuration, not code or a `NEXT_PUBLIC_` variable. Treat it as disclosed and **rotate it before production**; set replacement in the deployment secret manager. No key value is in this report. |
| P1 | `src/lib/skyvern/webhook-security.ts` (removed), callback route (removed), `src/lib/application-agent/service.ts` | The old callback assumed an HMAC signing format that was not established from current official documentation. Callback is now disabled; provider polling is the supported path. Re-enable only after confirming provider signature, replay and payload contracts and adding fixture tests. |
| P1 | `src/lib/application-agent/service.ts` | Completed historical runs could become timed-out on a later GET. Fixed: timeout applies only to nonterminal runs; regression test added. |
| P1 | `src/lib/application-agent/repository.ts`, agent service | Founder/workspace/company ownership is checked before admin reads and writes. The model still chooses the first workspace/company in `requireApiActor`; multi-workspace selection is not implemented. A future multi-company UI needs explicit, authorized selection instead of this implicit choice. |
| P1 | `src/lib/skyvern/get-run.ts` | Submission evidence is Skyvern's reported output plus confirmation text and URL/screenshot, not independent portal-side verification. Ambiguous outcomes map to `submission_unverified`; do not advertise this as cryptographic proof of acceptance. Founder/operator must inspect the portal for uncertain outcomes. |
| P1 | `src/lib/skyvern/get-run.ts` | Raw provider failure text could reach the UI/run record and might contain portal-sensitive content. Replaced it with bounded, actionable messages; added regression test. |
| P1 | `src/lib/application-agent/service.ts`, `src/lib/application-agent/repository.ts` | Run claims are persisted before Skyvern is called, but a crash after provider acceptance and before external run ID persistence can leave a pending claim. Timeout/reconciliation does not recover the provider ID. Do not blindly rerun submissions. A durable dispatch/outbox or provider-side idempotency/reconciliation contract is needed for unattended production execution. |
| P1 | `src/lib/application-agent/prepared-context.ts` | Private PDF is selected server-side within the actor's company and shared using a 30-minute signed URL. This is a bearer URL exposed to Skyvern by design; ensure vendor retention/access expectations are acceptable and prefer shorter TTL if upload timing permits. No arbitrary browser-provided storage path is accepted. |
| P2 | `next.config.mjs` | Added `nosniff`, frame denial, referrer and permissions policies. A complete nonce-based CSP, HSTS at the HTTPS edge, and deployment header verification remain open. |
| P2 | `src/lib/application-agent/url-safety.ts`, Firecrawl | Public HTTP(S) DNS/IP guard blocks common private, loopback and metadata targets. DNS rebinding/redirect validation by external providers cannot be proven locally; test under the actual hosted network and constrain vendor-side navigation. |
| P2 | `src/app/api/onboarding/pitch-deck/[assetId]/route.ts` | Owner-scoped Storage access and same-origin mutation check exist. PDF analysis still runs inside one HTTP request; timeout/restart risks remain. PDF byte/type checks are present but not a full malware scanner. |
| P2 | `src/lib/gemini/*`, `src/lib/firecrawl/*` | Website/deck content is framed as untrusted evidence and structured outputs are validated. This reduces, but does not eliminate, prompt injection or invented claims; founder approval is still essential before external applications. |

`requireApiActor` checks Supabase user with `auth.getUser(token)`, then membership and company using the caller-scoped client. Service-role access is server-only. No blanket RLS disablement was introduced. The live RLS script is **not run** here because it creates and deletes real Supabase users/data; it should run in staging after migration review. Static migration inspection is not a substitute for a live policy test.

## D. Performance and resource audit

Measured baseline is limited to local build/test execution, not page-load latency. No browser network trace, real database EXPLAIN, production traffic sample, or Core Web Vitals capture was available, so no runtime speedup percentage is claimed.

- Production build: compiled in **14.7 s**, TypeScript phase **36.3 s**, generated **38 static pages** in **2.6 s** on the audit host. Build exited 0; a nonfatal `Failed to compact database` shutdown message appeared.
- `src/lib/application-agent/repository.ts` hydrated all historical browser runs even though only the latest fill and submit IDs are used. This audit capped that lookup to the 20 most recent runs. Questions, answers and assets remain unbounded because silently truncating them could change application behavior; pagination or targeted projections require measured query plans and explicit product limits.
- Founder dashboard, introductions and Knowledge Base have route-level loading components. No bundle analyzer or real browser performance measurement was run. `reactCompiler: true` is enabled. Broad client-component or dynamic-import rewrites were not justified from measurements.
- Firecrawl limits page count/depth, excludes low-value paths, truncates normalized content, and has bounded retries/fallback. Gemini records token usage when returned and validates schema, but cross-run content-hash reuse is incomplete; website/deck changes can trigger repeated synthesis. Deck analysis runs synchronously in the request and may exceed hosted route duration.
- Application-agent workspace limits (two active, five starts/minute) are checked by count queries. They are not an atomic global rate limiter; concurrent requests can race. Supabase indexes should be reviewed with EXPLAIN against `browser_agent_runs(workspace_id,status,created_at)`, `browser_agent_runs(application_id,created_at)`, and answer/question lookups before adding any index.

## E. Supabase schema, queries and storage

Auth is via Supabase; workspace membership and company are the effective startup authorization scope. Key tables include `companies`, `company_assets`, `scrape_snapshots`, `knowledge_base_entries`, `knowledge_sources`, `accelerator_programs`, `accelerator_applications`, `application_questions`, `application_answers`, `browser_agent_runs`, `browser_agent_artifacts`, `audit_logs`. A private `pitch-decks` bucket and workspace-scoped object policies are defined in `202610070001_pitch_deck_analysis.sql`.

`202610080001_unified_startup_intelligence.sql` adds unified-analysis and founder-confirmed profile columns. `202610080002_skyvern_submission_safety.sql` adds `submission_unverified` and a private, RLS-enabled, per-application auto-submit authorization ledger. **Neither migration was applied in this audit.** A read-only remote schema probe returned unavailable without useful error codes, so their live state remains unverified. Foundational application tables/types are not created by the migrations present in this checkout; production schema provenance and migration baseline must be reconciled before deployment.

The new authorization ledger grants no `anon`/`authenticated` direct access and is used through the server-side service role after actor checks. Before applying migration, test on staging, snapshot/backup the database, inspect existing enum/type/table definitions, and then run `npm run test:supabase-rls` against staging only. Do not disable RLS to make APIs work.

## F. AI pipeline

Website: server-side URL guard → bounded Firecrawl crawl, homepage scrape fallback → normalized pages and snapshots → Gemini. Pitch deck: private PDF Storage → extracted page text/visual-derived profile stored on `company_assets` → same Gemini synthesis. Unified analysis is stored on `companies.unified_analysis`; founder-reviewed canonical data on `companies.canonical_profile`; approved Knowledge and answers retain separate evidence/state. The application agent reads the confirmed profile as primary context, not unreviewed raw extraction. Model default is `gemini-3.8-flash`; prompts use JSON schema/local validation and avoid inventing unknown metrics. Application-answer suggestions are persisted as drafts with source evidence and character/word checks; they require approval before fill.

LLM latency/cost is not benchmarked. Existing provider usage metadata is captured where available. Next optimization should fingerprint website snapshot + deck asset/content + confirmed-profile revision and reuse unchanged synthesis, with a founder-triggered force-refresh override; do not skip verification of stale claims merely to save tokens.

## G. Skyvern and background execution

`BROWSER_AGENT_PROVIDER=skyvern` explicitly selects real provider; mock is explicit and rejected in production. The local credential passed a **read-only SDK browser-session listing**, which verifies authentication only. No live form fill or submission was tested. Fill and submit are different Skyvern tasks; submit requires the exact completed fill run and `confirmSubmit: true`. Auto-submit is behind `SKYVERN_AUTO_SUBMIT_ENABLED=false` by default, scoped to one application/program/fill run, expires in one hour, and can be revoked before atomic dispatch claim. Unknown final outcomes are never automatically retried.

Run IDs/statuses are persisted in Supabase; the protected cron route polls at most three active runs and dispatches at most two authorized auto-submits per invocation. **No scheduler is configured in this checkout.** The first provider call still occurs during the initiating HTTP request. Webhooks are disabled because their signature contract is unverified. Browser session expiry during founder review has not been measured and may force a fresh fill. A production queue/outbox is recommended before hands-off auto-submit, but not added blindly without the hosting/runtime decision.

## H. Changes made in this working session

This session continued an in-progress Skyvern integration. Already prepared: server-only Skyvern env/provider, context preparation, answer persistence, private PDF signed URL, per-program auto-submit authorization route/cron, status mapping, migration and `docs/SKYVERN_INTEGRATION.md`. Audit-specific changes:

- `src/lib/application-agent/service.ts`: stopped passing unverified webhook callbacks; fixed terminal-run timeout regression; extracted testable expiry predicate.
- `src/lib/skyvern/client.ts`: removed callback URL construction and unused Skyvern-specific `APP_BASE_URL` parsing.
- Removed `src/app/api/webhooks/skyvern/route.ts` and `src/lib/skyvern/webhook-security.ts` because the claimed signature format lacked an official verified contract.
- `src/lib/application-agent/repository.ts`: bounded historical run hydration without truncating questions, answers or assets.
- `src/lib/application-agent/__tests__/application-agent.test.ts`: removed misleading callback-signature fixture; added terminal-run regression test.
- `src/lib/skyvern/get-run.ts`: sanitized provider failure text before persistence/UI.
- `next.config.mjs`: added safe baseline security headers.
- `docs/SKYVERN_INTEGRATION.md`: documented polling-only behavior and remaining limits.
- `docs/PRODUCTION_READINESS_REPORT.md`: this report.

The provided workspace does not have a usable Git checkout at this path (`git status` failed while resolving its parent), so commit IDs and an authoritative Git diff cannot be supplied. No claimed commit hash is invented.

## I. Validation, exact outcomes and skips

| Check | Outcome |
| --- | --- |
| `npm run typecheck` | Passed after `npx next typegen` refreshed types for removed callback route. |
| `npm run lint` | Exit 0; 91 warnings and 24 informational diagnostics remain across existing code. |
| `npm run build` | Exit 0 with process-only temporary Signal Engine build keys; first sandbox attempt failed on Windows parent-path permission, escalated retry succeeded. Nonfatal compact-database shutdown message noted. |
| `npm run test:firecrawl` | 20/20 passed. |
| `npm run test:gemini` | 15/15 passed when rerun serially. |
| `npm run test:signal-engine` | 7/7 passed. |
| `npm run test:goal-engine` | 12/12 passed when rerun serially. |
| `npm run test:equity-lifecycle` | 49/49 passed. |
| `npm run test:slice-engine` | 87/87 passed when rerun serially. |
| `npm run test:accelerators` | 6/6 passed when rerun serially. |
| `npm run test:application-agent` | 9/9 passed after audit fixes. |

An initial attempt to run ten checks concurrently exhausted local Node process resources (`ERR_WORKER_INIT_FAILED`, OOM/spawn failures). Failed checks were rerun serially; the final completed outcomes above are authoritative. `npm run test:supabase-rls` was skipped to avoid creating/deleting users and rows in the configured external Supabase project. No live Skyvern application test, browser Lighthouse trace, dependency-vulnerability scan, or real database EXPLAIN was completed.

## J. Deployment checklist

1. Choose and document hosting platform, Node/runtime limits, scheduler mechanism, HTTPS domain, DNS, rollback, and monitoring owner.
2. Rotate the Skyvern token exposed in chat; add the replacement only to server-side deployment secrets. Review Supabase/Gemini/Firecrawl secret rotation and retention separately.
3. Reconcile foundational schema and apply `202610070001`, `202610080001`, `202610080002` in order on staging, then run read-only schema checks and destructive RLS fixture tests **only on staging**.
4. Configure `BROWSER_AGENT_PROVIDER=skyvern`, `APPLICATION_AGENT_REPOSITORY=supabase`, strong `APPLICATION_AGENT_CRON_SECRET`, and a scheduler calling the protected cron route. Keep `SKYVERN_AUTO_SUBMIT_ENABLED=false`.
5. Perform a synthetic founder flow against an owned test form: profile confirmation, approved answers, fill, screenshots, human-intervention states, manual submit, confirmation and ambiguous-outcome handling. Test browser-session lifespan during review.
6. Run production build/tests in CI, dependency audit, staging load/network traces, SQL EXPLAIN and migration drift check. Add error monitoring with redaction and alerts for stuck runs/failed cron.
7. Confirm security headers/HTTPS/HSTS/CSP at actual edge. Validate private Storage, RLS and URL guards under hosting network.
8. Deploy review-only mode first. Enable auto-submit only after owner approval, provider reconciliation strategy and repeated owned-form staging tests. Never test against a real third-party accelerator without explicit founder authorization.

## K. Owner decisions needed

| Question | Why / options / recommended default / blocked item |
| --- | --- |
| Which hosting platform and scheduler? | Defines request time limits, cron auth and rollback. Options: managed Next host with scheduler, container host with worker. Default: managed host plus protected cron for review-only launch. Blocks durable job design and deployment checklist completion. |
| Is unattended auto-submit actually in first production release? | Changes operational/legal risk. Options: review-only or opt-in program-scoped auto-submit. Default: review-only. Blocks enabling flag and worker design. |
| May migrations and RLS tests run on a staging Supabase project? | Required to verify schema/policies without touching production. Default: staging first with backup and operator review. Blocks live database verification. |
| What counts as accepted submission evidence for each portal? | Skyvern's AI text/screenshot can be ambiguous. Options: founder review, portal confirmation number/page, program API/email corroboration. Default: portal confirmation plus human review for uncertainty. Blocks strong “submitted” guarantee. |
| What data sharing/retention with Skyvern is permitted? | Agent receives approved profile and temporary deck URL. Default: minimum approved fields/documents and vendor retention review. Blocks privacy sign-off. |

## L. Remaining risks and M. final verdict

P0: rotate chat-disclosed Skyvern key. P1: schema drift/unapplied migrations; no owned-form end-to-end run; orphaned dispatch window; subjective submission confirmation; unconfigured scheduler and unknown hosting. P2: synchronous PDF processing, cross-run LLM duplication, non-atomic rate-limit counts, absent measured frontend/database performance, no CI/dependency scan, existing lint warnings. Mitigate via checklist above and test evidence rather than assumptions.

**NOT READY FOR PRODUCTION** until key rotation, schema/staging verification, review-only safe Skyvern E2E, scheduler/hosting configuration, and operational recovery are demonstrated. Local build and offline tests are necessary but not sufficient.
