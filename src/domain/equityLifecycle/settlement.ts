import { d, units } from "@/domain/sliceCalculation/math";

import type { SettlementInput, SettlementMember } from "./types";

export function settleContributions(inputs: SettlementInput[]): SettlementMember[] {
  const grouped = new Map<string, { confirmed: ReturnType<typeof d>; vested: ReturnType<typeof d> }>();
  for (const input of inputs) {
    const confirmed = d(input.confirmedUnits);
    const vested = d(input.vestedUnits);
    if (confirmed.isNegative() || vested.isNegative() || vested.gt(confirmed))
      throw new Error("invalid_settlement_units");
    const current = grouped.get(input.contributorId) ?? { confirmed: d(0), vested: d(0) };
    current.confirmed = current.confirmed.plus(confirmed);
    current.vested = current.vested.plus(vested);
    grouped.set(input.contributorId, current);
  }
  const total = [...grouped.values()].reduce((sum, item) => sum.plus(item.vested), d(0));
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([contributorId, value]) => ({
      contributorId,
      confirmedUnits: units(value.confirmed),
      vestedUnits: units(value.vested),
      eligibleUnits: units(value.vested),
      relativeShare: units(total.isZero() ? 0 : value.vested.div(total).mul(100)),
    }));
}
