# Onboarding pitch-deck analysis

The onboarding deck step accepts a PDF up to 20 MB. It uploads to the existing private `pitch-decks` Supabase Storage bucket under `workspace_id/company_id/uuid.pdf`, records the document in `company_assets`, then asks the existing server-side Gemini integration to read the PDF. Structured results, page-numbered evidence, and a concise extracted-text summary are stored on the asset. The combined company analysis can propose Knowledge Base entries from this evidence, but founder-approved entries are never overwritten automatically.

## Deployment

1. Review and apply [`supabase/migrations/202610070001_pitch_deck_analysis.sql`](../supabase/migrations/202610070001_pitch_deck_analysis.sql) in the existing Supabase project. The app does not apply it automatically.
2. Confirm the `pitch-decks` bucket is private and audit all existing Storage policies. PostgreSQL policies are OR-combined; an older permissive policy can still grant access even after the new scoped policies are added.
3. Keep the existing `GEMINI_API_KEY`, `GEMINI_MODEL`, Supabase URL, publishable key, and `SUPABASE_SERVICE_ROLE_KEY` configured server-side. No new environment variable or second Supabase project is required. Never expose the service-role or Gemini key with `NEXT_PUBLIC_`.
4. Deploy the Next.js server with enough request time for PDF analysis. The onboarding UI can retry a failed analysis; for production scale, move analysis behind a durable job queue later.

## Local verification

Register a new founder in the existing project, enter company details, upload a small PDF, and review the suggested description. Confirm that founder-entered nonempty company fields do not change. Replace or remove the PDF, then finish onboarding. In Supabase, inspect the private Storage object and `company_assets` row: `analysis_status`, `extracted_json`, `extracted_text`, `processed_at`. Test with another workspace account that it cannot read or delete that object. A deck with no usable facts should return null fields rather than invented metrics.

The current profile page can still store older PPT/PPTX assets, but only PDFs uploaded in onboarding are analyzed in this MVP.
