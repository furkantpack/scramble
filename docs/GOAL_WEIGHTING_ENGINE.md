# Goal Weighting Engine

Goal Weighting is Rising's second engine. It turns company priorities into
auditable, period-specific weights. The Signal Engine may link work to goals in
`draft`, `voting`, or `finalized` state, but downstream calculations must call
`calculationWeight()` and use only `finalized` goals.

## Lifecycle

- `draft`: created without an approved weight.
- `voting`: at least one leadership vote exists, or a finalized goal was reopened.
- `finalized`: quorum and role checks passed; the approved weight is available.
- `closed`: historical record. It is never eligible for a new calculation.

`single` mode allows only a `founder_admin` to enter and immediately finalize a
weight. `median_consensus` accepts votes from active founders and team leads in
the same company. Finalization uses a median with a 2.5 MAD outlier threshold.
Weights are independent and are not normalized to a total of 100.

## Database setup

Apply migrations in this order:

1. `supabase/migrations/202609010001_signal_engine.sql`
2. `supabase/migrations/202609040001_goal_weighting_engine.sql`

The second migration intentionally moves legacy `active` goals back to `draft`
and clears unapproved weights. Their original values are preserved in
`audit_log`. Run the migration in a staging project first and inspect the audit
rows before production rollout.

The privileged lifecycle RPCs are executable only by `service_role`. The API
verifies the Supabase access token, resolves an active company membership, and
then calls those RPCs with the verified actor. Table writes are revoked from
browser roles. Each write locks the goal row, checks its revision, and records
the audit event in the same transaction.

## API

- `GET /api/goals?active=true`: company goals and verified actor capabilities.
- `POST /api/goals`: idempotent batch creation, limited to 20 goals.
- `GET /api/goals/:goalId`: details, current-round eligible votes, and history.
- `PATCH /api/goals/:goalId`: `vote`, `finalize`, `reopen`, or `close`.

All endpoints require `Authorization: Bearer <Supabase access token>`. Never send
the service-role key or Signal Engine encryption key to the browser.

## Verification

```bash
npm run test:goal-engine
npm run test:signal-engine
npx tsc --noEmit
npm run build -- --webpack
npm audit --omit=dev
```

The Goal Engine test suite runs the actual migrations in an isolated PGlite
PostgreSQL database and covers tenant/role boundaries, quorum, outliers, stale
revisions, vote updates, reopen rounds, idempotency, batch rollback, deadlines,
legacy migration, and direct-table/RPC permission denial.
