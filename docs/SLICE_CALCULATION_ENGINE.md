# Engine 03: Slice Calculation Engine

Engine 03 converts normalized Rising signals into deterministic **provisional Contribution Units**.
It does not calculate legal equity, settle a company period, confirm a score, or resolve disputes.

## Formula

```text
Contribution Units
= Normalized Base Value
× Strategy-Specific Risk Factor
× Finalized Goal Factor
× Weight-Class Factor
× Contributor Attribution
```

Persisted values use `decimal.js` in the TypeScript domain and PostgreSQL `numeric` columns. The
company base currency, exact historical FX record, finalized goal revision, factor settings,
contributor allocation, FMV/risk inputs, and explanation are included in the immutable snapshot.

## Strategies

- `TIME`: explicit hours multiplied by the active contributor FMV rate.
- `CASH`: actual cash with company risk factor or contributor override.
- `EXPENSE`: approved and unreimbursed only; risk applies only when explicitly marked at-risk.
- `IDEA`: an explicitly approved manual valuation only.
- `RELATIONSHIP`: approved economic value, or capped revenue attribution.

Missing deterministic data is returned as a product state: `waiting_for_goal`,
`needs_attribution`, or `needs_input`. The engine never invents hours, attribution, FX, or value.

## API

All routes require a Supabase access token and resolve company/role server-side.

```text
POST /api/slice-calculations/signals/:signalId/calculate
GET  /api/slice-calculations/signals/:signalId
POST /api/slice-calculations/signals/:signalId/recalculate
POST /api/slice-calculations/:calculationId/override
```

The override body contains only `newUnits` and `reason`. Founder and Team Lead authority is resolved
on the server; Team Leads require an active `calculation_override_scopes` row.

## Database

Apply migrations in order:

```text
202609010001_signal_engine.sql
202609040001_goal_weighting_engine.sql
202609100001_slice_calculation_engine.sql
```

Revenue period capacity is checked in a security-definer transaction protected by a PostgreSQL
advisory lock. An input hash makes identical retries idempotent. Changed input creates a new version
and supersedes the prior active rows without overwriting its snapshots.

## Task Detail

Use a persisted signal UUID to open the real calculation panel:

```text
/dashboard/riser-task-detail?signalId=<signal-uuid>
```

Without a signal UUID, the static product preview deliberately displays an unlinked state instead
of presenting sample data as a real economic result.

## Local Verification

```bash
npm run test:slice-engine
npx tsc --noEmit
npx biome check src/domain/sliceCalculation src/app/api/slice-calculations
npm run build
```

The PGlite test suite applies all three migrations and verifies constraints, immutable versions,
idempotency, tenant boundaries, trusted RPC permissions, and override scopes.
