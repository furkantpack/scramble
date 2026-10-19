import { d, units } from "@/domain/sliceCalculation/math";

import type { CalibrationAction, CalibrationResult } from "./types";

export function calibrate(params: {
  action: CalibrationAction;
  currentUnits: string;
  newUnits?: string | null;
  reason?: string | null;
}): CalibrationResult {
  const current = d(params.currentUnits);
  if (!current.isFinite() || current.isNegative()) throw new Error("invalid_current_units");
  const reason = params.reason?.trim() || null;
  if (["dispute", "adjust", "resolve"].includes(params.action) && (!reason || reason.length < 5)) {
    throw new Error("reason_required");
  }
  if (params.action === "dispute") {
    return { state: "disputed", previousUnits: units(current), confirmedUnits: null, reason };
  }
  const next = params.action === "accept" ? current : d(params.newUnits ?? "NaN");
  if (!next.isFinite() || next.isNegative()) throw new Error("invalid_new_units");
  return { state: "confirmed", previousUnits: units(current), confirmedUnits: units(next), reason };
}
