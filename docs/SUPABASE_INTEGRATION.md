# Supabase integration

AcceleratorPilot uses the existing Supabase schema without adding migrations or duplicate tables.

## Clients

- `src/lib/supabase/client.ts`: browser client using the public key and RLS.
- `src/lib/supabase/server.ts`: cookie-backed SSR client using the current user's session and RLS.
- `src/lib/supabase/admin.ts`: server-only service-role client for trusted jobs and webhook processing.

The service-role key must never use a `NEXT_PUBLIC_` variable and must never be imported into a Client Component.

## Connected product areas

- Auth: email/password, OAuth callback, session refresh proxy, sign out and protected routes.
- Founder onboarding: `founder_profiles`, `companies`, `founder_needs`, `complete_founder_onboarding`.
- Pitch deck: private `pitch-decks` bucket and `company_assets` metadata; signed URLs are used for agent access.
- Founder dashboard: `accelerator_applications`, `audit_logs`, `notifications`, and `companies`.
- Knowledge Base: `knowledge_base_entries`, `knowledge_sources`, edits, approvals and audit records.
- Marketplace: global `accelerator_programs`, with no workspace filter.
- Applications: `accelerator_applications`, `application_questions`, and `application_answers`.
- Browser agent: `browser_agent_runs` and `browser_agent_artifacts`; no Skyvern-specific table.

Production data flow uses Supabase by default. Marketplace and application-question mocks are only enabled when the explicit development flags are set.

## Required configuration

Set the Supabase Auth Site URL and allow `/auth/callback` as a redirect URL. Enable the Google provider only when Google sign-in is required. Keep the `pitch-decks` bucket private.

The browser agent uses mock mode during local development unless `BROWSER_AGENT_PROVIDER=skyvern` is set. Production defaults to Skyvern and requires its server-side API key.

## Verification

`npm run test:supabase-rls` creates two disposable confirmed users, verifies cross-tenant isolation for workspace, company, application, Knowledge Base, and private Storage, then removes the generated test data.
