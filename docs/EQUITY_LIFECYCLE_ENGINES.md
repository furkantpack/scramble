# Rising Equity Lifecycle Engines

This package completes the product flow after Engine 03 without changing the historical calculation formula.

## Flow

1. Engine 03 creates provisional Contribution Units.
2. Engine 04 records accept, dispute, adjust, and resolve decisions as immutable calibration reviews.
3. Engine 05 applies deterministic monthly or quarterly vesting with an optional cliff and forfeiture event.
4. Period Settlement stores a versioned snapshot and relative contribution shares.
5. Engine 06 compares each share with a configurable stage, sector, and role benchmark.
6. Equity Recommendation combines settlement, vesting, benchmark context, and optional current ownership.
7. Engine 07 approves and exports recommendation records as CSV, JSON, manual legal, Carta, or Cake adapter payloads.
8. Engine 08 exposes a role-aware Equity Coach read model.

Contribution Units and recommendations are internal economic records. They do not change legal ownership and do not replace a legal or cap table provider.

## Migration

Apply migrations in filename order. The lifecycle migration is:

```text
supabase/migrations/202609120001_equity_lifecycle_engines.sql
```

The migration is rerunnable and depends on the Signal, Goal Weighting, and Slice Calculation migrations. It creates only lifecycle-specific tables and reuses existing companies, app users, goals, signals, calculations, audit logs, and override scopes.

## Authorization

- Founder/Admin: company-wide calibration, vesting, settlement, recommendation approval, and export.
- Team Lead: calibration only inside an existing TEAM or DOMAIN override scope.
- Contributor: accept or dispute an own calculation and read only own lifecycle member data.
- Viewer/Investor: read-only company context already permitted by the workspace model.

All mutations are server-side RPCs called by authenticated API routes. Direct browser writes are revoked. RLS enforces tenant isolation and contributor own-data access.

## API

- `GET|POST /api/calibrations/:calculationId`
- `GET|POST /api/vesting`
- `POST /api/vesting/:scheduleId/forfeit`
- `POST /api/settlements`
- `GET /api/settlements/latest`
- `GET /api/benchmarks`
- `GET|POST /api/equity-recommendations`
- `POST /api/equity-recommendations/:recommendationId/approve`
- `POST /api/equity-exports`
- `GET /api/equity-coach`

## Product Placement

- Task Detail: Engine 04 calibration and Engine 05 vesting setup.
- Contribution Settlement: vesting status, settlement members, recommendation approval, and export.
- Company Journey: Engine 06 benchmark explorer.
- Dashboard: Engine 08 Equity Coach.
- Users: role permission reference.

## Verification

```bash
npm run test:equity-lifecycle
npm run test:slice-engine
npm run test:goal-engine
npm run test:signal-engine
npx tsc --noEmit
npx next build --webpack
```

Local PGlite tests verify role restrictions, audit records, versioning, idempotency, migration reruns, and revoked authenticated-client mutations. A production Supabase migration must be applied separately with production credentials.
