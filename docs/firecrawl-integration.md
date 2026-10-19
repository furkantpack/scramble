# Company website intelligence integration

## 1. SDK and verified references

Installed and pinned `firecrawl@4.41.0`, the current official Node package at implementation time.
Reviewed the official agent onboarding skill, installed/read its build/onboarding/scrape skills,
and checked the canonical Node and crawl documentation plus installed SDK types/source:

- https://www.firecrawl.dev/agent-onboarding/SKILL.md
- https://docs.firecrawl.dev/agent-source-of-truth/node
- https://docs.firecrawl.dev/sdks/node
- https://docs.firecrawl.dev/api-reference/endpoint/crawl-post

Uses `Firecrawl`, `startCrawl`, `getCrawlStatus`, `cancelCrawl`, and `scrape` (v2).
No Interact, browser execution, extraction prompt, or second Gemini prompt.
SDK 4.41's `maxRetries` transport option counts attempts: use **1**, not 0, to disable internal retries.
The application's bounded retry wrapper owns retries and counts each attempted API request.

## 2. Files

New acquisition boundary:
`src/lib/firecrawl/{client,crawl-company,normalize-pages,types,errors}.ts`.

New orchestration/status/persistence boundary:
`src/lib/knowledge/{analyze-company,analysis-repository,analysis-status}.ts`.

New authorized endpoint: `src/app/api/companies/[id]/analyze/route.ts` (GET status, POST start/retry).
New processing UI: `src/app/(external)/(scouter-founder-routes)/knowledge-base/company-analysis.tsx`.
Updated onboarding, Knowledge Base workspace/page, existing context loader/shared URL guard, DB types,
package manifests and environment example. Added `src/lib/firecrawl/__tests__` and
`scripts/verify-company-analysis.ts`.

## 3. Trigger and ownership

Final onboarding action first saves founder, company, needs and optional deck, then invokes the existing
`complete_founder_onboarding` validation RPC. Only after success does it POST the company ID to analysis.
The endpoint loads all facts from Supabase; it accepts no arbitrary browser-provided source data.
User authentication, company RLS visibility, workspace membership, founder profile and completed onboarding
are checked before privileged execution. The worker rechecks ownership/completion.
Founder needs are scoped to that founder profile rather than all members of the workspace.
CSRF checks compare Origin to Host and reject cross-site fetches.

## 4. Crawl configuration

10 useful pages, `maxDiscoveryDepth: 2`; external links and subdomains disabled.
Markdown only, `onlyMainContent: true`, nav/footer excluded. Query duplicates suppressed by provider.
Local selection prioritizes homepage, about, product/platform, solution, pricing, customers and team.
Useful other same-company landing pages remain eligible.
Blog/news/press/careers/jobs/legal/privacy/terms/cookies/docs/documentation/support/help/login/signup/contact/
events/webinars are excluded at acquisition and normalization. Obvious file assets are discarded.

## 5. Limits and evidence

URLs are canonicalized (fragments/tracking parameters removed); identical content hashes deduplicate.
Gemini receives at most 10 pages, 12,000 characters per page, 80,000 total.
Truncation keeps the beginning and useful headings; repeated link-only navigation is removed.
Selected untruncated markdown is separately saved in `scrape_snapshots` before Gemini is called.
Metadata uses an explicit allowlist: provider, root URL, title, description, strategy, credits used.
No provider headers, cookies or credentials are persisted.

## 6. Fallback, retries and errors

Crawl is polled for up to 60 seconds, then cancelled best-effort. Requests have a 20-second transport timeout;
page scrape timeout is 18 seconds. Retryable operations get at most 3 attempts with 500ms/1s backoff.
429, 5xx, temporary network failures and request timeouts are retryable. Auth, invalid URL/input and forbidden
errors are not endlessly retried. Failed/empty/timed-out crawls fall back to one homepage scrape;
invalid credentials/targets skip the pointless fallback.
Errors normalize to FIRECRAWL_AUTH_ERROR, RATE_LIMIT, TIMEOUT, BLOCKED, EMPTY_RESULT, INVALID_URL or UNKNOWN.
Only safe codes are logged/returned. Onboarding is never rolled back for analysis failure.

## 7. Gemini and Knowledge Base

Calls existing `generateCompanyKnowledge` with trusted founder/company context and internal page objects;
the Gemini layer never receives Firecrawl SDK types. Existing untrusted-source system instructions remain.
Existing `saveGeneratedKnowledge` creates nine versioned categories and links only Gemini's category-specific
evidence to `knowledge_sources`. Approved/founder-edited rows remain unchanged; reanalysis creates proposals.
Only approved content is intended for application generation, not a claim that every generated statement is verified.

## 8. No website / processing / retry

No website means no Firecrawl call: founder-context-only generation is attempted; unsupported categories stay missing.
An unavailable generator leaves the empty/missing workspace usable for manual editing.
The browser receives 202 immediately and navigates to `/knowledge-base`, with real saving/scraping/generating
progress, safe failure copy and retry. Refresh Sources now starts the real pipeline, not a timer/mock banner.
Polling refreshes server-rendered entries on completion. Pitch decks are never sent to Firecrawl.

## 9. Persistence and job limitations

No migration required against the verified existing schema. A dedicated `company_analysis_status` marker in
existing `audit_logs` (ID = company ID) stores current status/run ID. PK insertion and compare-and-swap run IDs
prevent duplicate concurrent paid jobs. A 60-second retry cooldown prevents accidental rapid reruns.
This marker is mutable status, not append-only audit history. No unrelated tables were created.

Next.js `after()` runs the job outside the browser response, with route `maxDuration=300`.
This is **not a durable queue**: a process crash/deployment can interrupt a job. A 10-minute stale lease becomes
retryable rather than showing processing forever. For production, use a host supporting `after`/waitUntil and
the duration, or dispatch the same `analyzeCompany` worker boundary through a durable queue.

## 10. Usage and security

`usage_counters.firecrawl_calls_this_month` increments server-side for every SDK operation attempt, including
polling/cancellation/retries; it is an API-call count, **not billed credits**. Available crawl credit metadata is
stored separately. Atomic compare-and-swap updates and monthly rollover protect concurrent counts.

FIRECRAWL_API_KEY is server-only in ignored `.env.local`; optional FIRECRAWL_BASE_URL defaults to official hosted API.
No NEXT_PUBLIC key. Central client imports `server-only`. Existing DNS-aware SSRF guard is reused immediately
before provider target calls; localhost/private/link-local/metadata/mapped IPv6 and credentials-in-URL are rejected.
Returned sources are limited to the company hostname. Firecrawl is responsible for its remote redirect/DNS safety;
application-side validation cannot pin the DNS resolution of an external crawler.

## 11. Verification performed

- 190 automated tests passed (17 new acquisition/orchestration tests plus 173 existing tests).
- `npm run typecheck` passed.
- `npm run lint` passed with warnings (including existing UI/style warnings).
- `npm run build` passed. Existing unrelated Signal Engine routes require their configuration at build time;
  build-only placeholder values were supplied in the test process, not persisted to environment files.
- Live disposable-account HTTP integration: registration provisioning, login, founder/company/needs save,
  onboarding completion, unauthorized rejection, 202 dispatch, duplicate suppression, real public website crawl.
- Public target `https://www.firecrawl.dev`: **10 real snapshots saved**, **6 API requests counted**.
- Missing Gemini key produced a safe failure while keeping onboarding and evidence intact.
- A clearly synthetic Gemini fixture separately verified all 9 persisted categories, linked evidence and protection
  of approved content in the real database. It was not represented as a live Gemini result.
- All disposable test account/workspace data was removed. No existing founder/company data was changed by tests.

Run the live check (uses Firecrawl credits and a disposable test account):
`node --conditions=react-server --import tsx scripts/verify-company-analysis.ts`.
Requires the app running at 127.0.0.1:3000 or APP_BASE_URL.

## 12. Remaining configuration

**GEMINI_API_KEY is absent**, so live Gemini output and the full register-to-generated-Knowledge browser journey
could not be verified. Configure it server-side and verify the configured GEMINI_MODEL is available to that key.
Then rerun the live check and the actual browser onboarding journey. Never put either provider key in client env.
For deployment, also set the existing Signal Engine secrets if those routes are deployed, and provide a compatible
long-running worker/runtime. Rotate any credentials that have been pasted into chat as a security precaution.
