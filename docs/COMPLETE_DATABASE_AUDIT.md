# Scramble database architecture audit

Audit date: 2026-10-09. Scope: checked-in Next.js application and the existing Supabase project. **No migration was executed.** The production schema was queried only through zero-row PostgREST GET projections and the read-only REST OpenAPI description. A HEAD/limit(0) probe previously returned false positives (HTTP 204 for nonexistent tables) and was discarded. Catalog metadata (live RLS, constraints, indexes, triggers, function ownership, migration history) is **not accessible through that interface**; those items remain unverified until the separate SQL Editor verification script is run. This report does not claim a successful live migration or end-to-end run.

## Executive conclusion

The remote API exposes 19 core application tables and three core RPCs (`complete_founder_onboarding`, `is_workspace_member`, `is_workspace_owner`). It does **not** expose the 26 Signal/Goal/Slice/Equity tables, the three application/source job tables, or their domain/queue RPCs. The live `companies` table lacks four unified-profile fields and `sector`; `company_assets` lacks six deck-analysis fields. `company_assets.content_sha256` already exists. The `pitch-decks` Storage bucket was observed as private; its live policies could not be inspected.

Consequently, core login/onboarding/marketplace/dashboard reads can use the existing base schema; pitch-deck processing, canonical startup profile persistence, application dispatch, source-analysis worker, and Signal/Goal/Slice/Equity routes cannot operate end-to-end against the observed schema. Applying SQL alone does **not** fix the existing `app_users` identity mismatch described below.

## Application-to-database dependency map

| Implemented surface | Actual database dependency | Observed outcome |
|---|---|---|
| Founder registration/login, callback, onboarding | Supabase Auth, `profiles`, `workspaces`, `workspace_members`, `founder_profiles`, `founder_needs`, `companies`, `complete_founder_onboarding` | Core objects exposed; Auth triggers/policies unverified |
| Dashboard, profile, activity/settings | Core company/founder/knowledge/application/notification tables | Dashboard/profile core objects exposed; activity/settings pages are placeholders, no extra tables justified |
| Website acquisition + Gemini Knowledge Base | `scrape_snapshots`, `knowledge_base_entries`, `knowledge_sources`, `usage_counters`, `source_analysis_jobs`, claim RPC | Core evidence tables exposed; queue/RPC absent |
| Pitch deck extraction + unified analysis | private `pitch-decks` bucket, `company_assets` analysis fields, `companies` unified/canonical fields, source job | Bucket private, columns and queue absent |
| Accelerator marketplace/application editor | `accelerator_programs`, `accelerator_applications`, `application_questions`, `application_answers` | Core tables exposed; no implemented billing or separate discovery crawler tables |
| Skyvern application agent, guarded submit | `browser_agent_runs`, `browser_agent_artifacts`, `application_submit_authorizations`, `application_dispatch_jobs`, claim/begin RPCs | Core run/artifact tables exposed; safety/dispatch schema absent |
| Jira Signal Engine | `app_users`, `integrations`, `tag_mapping_rules`, `goal_link_rules`, `signals`, `sync_logs`, `audit_log` | All domain tables absent |
| Goal weighting | `goals`, `goal_weight_votes`, `goal_creation_requests`, RPCs | All domain tables/RPCs absent |
| Slice calculations | `contribution_engine_settings`, FMV/risk/attribution/FX/calculation/override tables, RPCs | All domain tables/RPCs absent |
| Equity lifecycle | calibration, vesting, settlements, benchmarks, recommendations, exports, RPCs; `companies.sector` | All domain tables/RPCs and sector absent |
| Billing | No implemented checkout/subscription/payment routes or persistence | No billing tables proposed |

The implemented page files under `src/app` include login/register/onboarding, founder dashboard, introductions, knowledge base, profile/deck, activity/settings and match detail. The API routes cover auth, company analysis/profile, Knowledge generation, deck upload/extraction, application fill/submit/agent, cron workers, Jira Signal/Goal/Slice/Equity and health/readiness. Removed legacy investor/conversation routes are not included.

## Migration inventory and state

| File | Intended change | Live evidence |
|---|---|---|
| `202609010001_signal_engine.sql` | 8 domain tables, helper functions, RLS/view | All 8 tables absent |
| `202609040001_goal_weighting_engine.sql` | 2 tables, goals extension, RPCs | Tables and RPCs absent |
| `202609100001_slice_calculation_engine.sql` | 8 tables, settings trigger/RPCs | Tables and RPCs absent |
| `202609120001_equity_lifecycle_engines.sql` | 8 tables, RPCs/benchmarks | Tables and RPCs absent |
| `202610070001_pitch_deck_analysis.sql` | asset analysis fields, bucket/policies | Analysis fields absent; private bucket exists |
| `202610080001_unified_startup_intelligence.sql` | unified/canonical company fields, extracted pages | Fields absent |
| `202610080002_skyvern_submission_safety.sql` | submission authorization and status | Table absent; enum status unverified |
| `202610090001_application_dispatch_jobs.sql` | dispatch jobs and RPCs | Table/RPCs absent |
| `202610090002_source_analysis_jobs.sql` | source jobs and RPC | Table/RPC absent |

These are **schema-state observations**, not claims about rows in `supabase_migrations.schema_migrations`; that catalog was not available remotely. The original four domain migrations contain top-level transaction blocks and are not directly pasteable as one nested Supabase SQL Editor transaction. The older Phase-2-only script assumes those four are already installed and would fail on this project; use the full ordered script prepared for this audit instead.

## Table-by-table changes

"Present" means the zero-row live projection/OpenAPI found the object, not that its live RLS/FKs/indexes were proven. "Create" means the full SQL script creates the table from the matching checked-in migration. Every table below is backed by implemented code or a database function used by implemented code.

| Table | Live | Required action / rationale |
|---|---|---|
| `profiles` | Present | Retain; Auth/profile linkage; no direct new DDL |
| `workspaces` | Present | Retain; tenant root |
| `workspace_members` | Present | Retain; ownership/auth guard |
| `founder_profiles` | Present | Retain; onboarding |
| `founder_needs` | Present | Retain; onboarding |
| `companies` | Present | Add nullable `sector`, `unified_analysis`, `canonical_profile`, `profile_confirmed_at/by` |
| `company_assets` | Present | Add `analysis_status`, `extracted_text/json/pages`, `analysis_error`, `processed_at`; keep existing `content_sha256` |
| `scrape_snapshots` | Present | Retain raw website evidence |
| `knowledge_base_entries` | Present | Retain generated/approved sections |
| `knowledge_sources` | Present | Retain section-specific evidence |
| `usage_counters` | Present | Retain Firecrawl/LLM/agent counters |
| `accelerator_programs` | Present | Retain marketplace catalog |
| `accelerator_applications` | Present | Retain application state; add enum value `submission_unverified` |
| `application_questions` | Present | Retain form schema |
| `application_answers` | Present | Retain draft/approved answers |
| `browser_agent_runs` | Present | Retain Skyvern run records |
| `browser_agent_artifacts` | Present | Retain evidence/artifacts |
| `notifications` | Present | Retain user notifications |
| `audit_logs` | Present | Retain core audit events; distinct from Signal `audit_log` |
| `app_users` | Absent | Create identity for Signal/Equity domain; RLS + server-only grants added |
| `goals` | Absent | Create weighted goal model |
| `integrations` | Absent | Create Jira connection configuration |
| `tag_mapping_rules` | Absent | Create Jira-to-signal mapping |
| `goal_link_rules` | Absent | Create signal-to-goal mapping |
| `signals` | Absent | Create ingested contribution signals |
| `sync_logs` | Absent | Create Jira synchronization record |
| `audit_log` | Absent | Create Signal/Goal domain audit trail |
| `goal_weight_votes` | Absent | Create consensus votes |
| `goal_creation_requests` | Absent | Create controlled goal creation requests |
| `contribution_engine_settings` | Absent | Create per-company calculation settings |
| `contributor_fmv_rates` | Absent | Create contributor fair-market-value rates |
| `contributor_risk_profiles` | Absent | Create contributor risk weights |
| `signal_contributors` | Absent | Create signal attribution links |
| `fx_rate_snapshots` | Absent | Create immutable exchange-rate evidence |
| `contribution_calculations` | Absent | Create calculation results |
| `calculation_override_scopes` | Absent | Create scoped override permissions |
| `contribution_calculation_overrides` | Absent | Create override audit/result records |
| `calibration_reviews` | Absent | Create calibration decisions |
| `vesting_schedules` | Absent | Create vesting terms |
| `vesting_events` | Absent | Create vesting event record |
| `period_settlements` | Absent | Create closed contribution periods |
| `period_settlement_members` | Absent | Create per-contributor settlement amounts |
| `benchmark_rules` | Absent | Create equity recommendation benchmarks |
| `equity_recommendations` | Absent | Create proposed equity recommendations |
| `equity_exports` | Absent | Create export audit records |
| `application_submit_authorizations` | Absent | Create explicit, scoped submission consent |
| `application_dispatch_jobs` | Absent | Create durable application-agent queue |
| `source_analysis_jobs` | Absent | Create durable website/deck analysis queue |

No table is recommended for deletion. `profiles` has little direct application access but may be maintained by Auth-side triggers. `goal_creation_requests`, `vesting_events` and `equity_exports` are used through SQL functions, not necessarily direct `.from(...)` calls. `unlinked_signal_queue` is a view, not a redundant table. The two audit tables serve different subsystems; merging them would be speculative and destructive.

## Relationships, security and function findings

- The full SQL uses the migrations' foreign keys and indexes, adds partial unique queue indexes and validates them. Existing core FKs/indexes **cannot be certified** without catalog access; the read-only verification SQL lists every constraint/index.
- The original Signal migration creates `app_users` without RLS. The full script enables RLS and revokes anonymous/authenticated table access; server-side service role and tightly scoped SECURITY DEFINER helpers continue to function. No broad public `app_users` policy is added.
- The legacy domain helper functions use `SECURITY DEFINER SET search_path=public,pg_temp`. The full script aborts if `anon` or `authenticated` can CREATE in `public`; the verification SQL reports live owners, search paths and effective EXECUTE privileges. Job mutation RPCs are service-role-only per the reviewed Phase-2 patch.
- Existing `storage.objects` policies are preserved. A restrictive guard limits `pitch-decks` objects to workspace owners and is ANDed with any legacy permissive policy; owner-specific positive policies are added. The script refuses to make an existing public `pitch-decks` bucket silently private. Live policy conflicts/definitions require the post-run catalog query.
- The original core schema's full DDL is not in this repository. It is therefore unsafe to "repair" hypothetical core RLS/foreign-key gaps automatically. The script preflights essential core objects and Phase-2 checks core RLS; verification exposes details for human review.
- Storage object path shape is `workspace_id/company_id/...`; objects using another layout may become unreadable to clients after the restrictive guard. The service role can still recover them. Inspect existing bucket object names before running if it has contents.
- The script is one PostgreSQL transaction. It removes nested top-level `BEGIN/COMMIT` wrappers from source migrations. On a preflight/conflict/lock timeout it rolls back. It deliberately **fails closed on re-run** rather than replaying the older migrations against populated domain tables. Do not run both this script and the older Phase-2-only script.

## Non-SQL integration blocker

`src/lib/signal-engine/auth.ts` returns `appUserId: membership.id`, where `membership.id` belongs to `workspace_members`. All Goal/Slice/Equity domain foreign keys and RPCs expect `app_users.id`. No signup/onboarding code creates an `app_users` row. Thus the domain APIs may authenticate but then fail FK checks or return no data even after this SQL migration. A separate code change must lookup/provision `app_users` by `auth_user_id + company_id` and use its ID. This audit does **not** add a trigger or silently re-key existing membership data. If these APIs should be live immediately, approve that code change separately and test it before launch.

## Execution order and risks

1. Review and back up the existing Supabase project; inspect current `storage.objects` paths and any live policy/constraint drift.
2. Run **only** `supabase/manual/20261009_full_scramble_existing_project.sql` once in SQL Editor after your approval. It creates 29 tables, adds nullable fields, functions/policies/indexes/triggers, seeds benchmark/settings rows, and updates application enum status. It does not reset or delete core data.
3. If it errors, do not run fragments; inspect the error and use `ROLLBACK` if the SQL Editor session remains open. The script's five-second lock timeout can fail under concurrent activity.
4. Run `supabase/manual/20261009_verify_full_scramble_readonly.sql` section-by-section and inspect every result. Then run application integration tests and fix the `app_users` identity mapping.
5. Manual SQL Editor execution normally does not record the nine source migration versions in the migration-history table. Do not later run `db push` blindly against this database. Reconcile migration history deliberately before any automated deployment process.

The migration and verification files were generated and statically reviewed only. **No database changes have been made.**


