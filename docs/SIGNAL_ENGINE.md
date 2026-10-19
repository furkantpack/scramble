# Rising Signal Engine

The first Signal Engine adapter reads Jira Cloud issue metadata, applies transparent contribution/domain/weight rules, links unambiguous signals to goals, and persists an audit trail. It never calculates equity slices or approves equity changes.

## Setup

1. Run `supabase/migrations/202609010001_signal_engine.sql` in the Supabase SQL editor.
2. Keep these values in `.env.local` or the deployment platform's encrypted server environment:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SIGNAL_ENGINE_ENCRYPTION_KEY` (base64, exactly 32 decoded bytes)
   - `SIGNAL_ENGINE_CRON_SECRET` (at least 32 characters)
   - `SIGNAL_ENGINE_WEBHOOK_BASE_URL`
3. Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` may be exposed to the browser.
4. Configure the deployment scheduler to `POST /api/cron/signal-engine` with `Authorization: Bearer <SIGNAL_ENGINE_CRON_SECRET>`.

## Jira connection

Open `/dashboard/riser-integrations/jira`. A founder admin or team lead can test and save a Jira Cloud URL, account email, and API token. Rising validates the credentials before encrypting them with AES-256-GCM.

Jira API tokens cannot register dynamic Jira webhooks. After connection, Rising displays a one-time webhook URL. Add it in Jira administration for:

- `jira:issue_created`
- `jira:issue_updated`

The webhook URL contains a secret. Rising stores only its SHA-256 hash. Regenerate the connection if the URL is lost or exposed.

## Security boundaries

- Service and encryption keys live in server-only modules and are never returned by an API.
- Workspace APIs require a verified Supabase bearer session and an `app_users` workspace membership.
- Writes are limited to `founder_admin` and `team_lead` roles.
- Direct client inserts into `signals` are denied by RLS; server ingestion uses the service role.
- Jira URLs are restricted to root `https://*.atlassian.net` origins to prevent SSRF.
- Jira request timeouts, payload limits, event allowlists, webhook rate limits, and fingerprint uniqueness limit abuse and retries.
- Stored Jira payloads exclude descriptions, comments, email addresses, and other fields that are not required for tagging.

## Verification

Run:

```bash
npm run test:signal-engine
npx tsc --noEmit
npm run build
npm audit --omit=dev
```
