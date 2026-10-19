import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function d(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function fixed(value: Decimal.Value, places = 8): string {
  return d(value).toDecimalPlaces(places).toFixed(places);
}

export function money(value: Decimal.Value): string {
  return fixed(value, 8);
}

export function units(value: Decimal.Value): string {
  return fixed(value, 8);
}

export function bpsToFactor(bps: number): Decimal {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error("Invalid attribution basis points");
  return d(bps).div(10_000);
}

export function goalWeightToFactor(weight: Decimal.Value): Decimal {
  const value = d(weight);
  if (value.lt(0) || value.gt(100)) throw new Error("Invalid goal weight");
  return value.div(100);
}
