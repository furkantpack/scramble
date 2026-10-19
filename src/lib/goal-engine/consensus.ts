import type { ConsensusResult, WeightedGoal } from "./types";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeConsensusWeight(votes: number[]): ConsensusResult {
  if (votes.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new RangeError("Weights must be finite numbers between 0 and 100");
  }
  if (!votes.length) {
    return { weight: null, method: "no_votes", votesUsed: [], votesExcludedAsOutliers: [], totalVoters: 0 };
  }
  const med = median(votes);
  const mad = median(votes.map((value) => Math.abs(value - med)));
  const filtered = mad === 0 ? [...votes] : votes.filter((value) => Math.abs(value - med) <= mad * 2.5);
  const fallback = filtered.length < votes.length / 2;
  const used = fallback ? [...votes] : filtered;
  let method: ConsensusResult["method"] = "median";
  if (votes.length === 1) method = "single";
  else if (fallback) method = "median_fallback";
  return {
    weight: Math.round((median(used) + Number.EPSILON) * 100) / 100,
    method,
    votesUsed: used,
    votesExcludedAsOutliers: fallback || mad === 0 ? [] : votes.filter((value) => Math.abs(value - med) > mad * 2.5),
    totalVoters: votes.length,
  };
}

// The next engine must use this gate, never a truthiness check (zero is valid).
export function calculationWeight(goal: Pick<WeightedGoal, "status" | "weight">): number | null {
  return goal.status === "finalized" &&
    goal.weight !== null &&
    Number.isFinite(goal.weight) &&
    goal.weight >= 0 &&
    goal.weight <= 100
    ? goal.weight
    : null;
}
