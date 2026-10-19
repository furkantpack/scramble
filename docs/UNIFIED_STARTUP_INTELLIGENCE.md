# Unified startup intelligence

The existing onboarding now accepts a website, a private PDF deck, or both. A company name remains required. After onboarding is committed, `/api/companies/[id]/analyze` claims a background analysis run. It reuses the existing bounded Firecrawl crawl and its homepage-scrape fallback; it never runs a second website scraper.

The latest deck is read from the private `pitch-decks` bucket. Gemini extracts page-numbered text, tables, charts, and meaningful visual facts into `company_assets.extracted_pages`. Original files, deck extractions, and `scrape_snapshots` remain separate. Replacing a deck leaves previous evidence intact; only the latest deck is used for a new synthesis.

One orchestrator sends both sources to Gemini for a unified field-level proposal and to the existing nine-section Knowledge Base generator. The proposal is stored in `companies.unified_analysis`; it records source, confidence, evidence, conflicts, missing fields, and potentially outdated claims. Reanalysis updates only the proposal. It never replaces `companies.canonical_profile` or founder-approved Knowledge Base versions.

The founder reviews the proposal at `/profile`, can edit every field, and explicitly confirms it. Confirmation writes `companies.canonical_profile`, including per-field provenance, and syncs the confirmed company name, one-liner, and recognized stage into the existing company columns. The canonical profile is the primary context for the application-question suggestion endpoint. Suggestions also see bounded website/deck evidence, return clarification needs when facts are missing, and are not saved or approved until the founder acts.

## Required Supabase step

Apply migrations in order in the Supabase SQL editor:

1. `supabase/migrations/202610070001_pitch_deck_analysis.sql` if not previously applied.
2. `supabase/migrations/202610080001_unified_startup_intelligence.sql`.

The second migration adds JSON columns to the existing `companies` and `company_assets` tables. It creates no parallel startup profile table and relies on the existing workspace RLS policies. Verify that `companies.unified_analysis`, `companies.canonical_profile`, and `company_assets.extracted_pages` are visible before testing.

Server-only `FIRECRAWL_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and the existing Supabase URL/public key configuration must remain configured. Do not expose these keys in the browser. No new provider key is required.

## Verification

Run `npm run typecheck`, `npm run test:firecrawl`, `npm run test:gemini`, and `node --conditions=react-server --import tsx --test src/lib/pitch-deck/__tests__/*.test.ts`.

Then use a test founder and a public company website plus a small PDF deck. Finish onboarding, wait for analysis, review `/profile`, confirm the profile, and verify company JSON columns, page-numbered deck extraction, website snapshots, and Knowledge Base entries. Change the deck or website and reanalyze: the prior canonical profile must remain active until the founder confirms a revision. Use a separate workspace to verify RLS isolation.
