import { d, units } from "@/domain/sliceCalculation/math";

import { classifyBenchmark } from "./benchmark";
import type { EquityRecommendationInput, EquityRecommendationResult } from "./types";

const min = (a: ReturnType<typeof d>, b: ReturnType<typeof d>) => (a.lte(b) ? a : b);
const max = (a: ReturnType<typeof d>, b: ReturnType<typeof d>) => (a.gte(b) ? a : b);

export function recommendEquity(input: EquityRecommendationInput): EquityRecommendationResult {
  const share = d(input.contributionShare);
  const lower = d(input.benchmark.minimum);
  const upper = d(input.benchmark.maximum);
  if (share.isNegative() || share.gt(100) || lower.isNegative() || upper.gt(100) || lower.gt(upper)) {
    throw new Error("invalid_recommendation_input");
  }
  const center = min(upper, max(lower, share));
  const halfWidth = min(d("2.5"), upper.minus(lower).div(2));
  const recommendedMinimum = max(lower, center.minus(halfWidth));
  const recommendedMaximum = min(upper, center.plus(halfWidth));
  const position = classifyBenchmark(share.toString(), input.benchmark);
  let ownershipSentence = "No current ownership value was supplied.";
  if (input.currentOwnership !== null) {
    ownershipSentence = share.gt(input.currentOwnership)
      ? "Contribution share is above the current allocation."
      : "Contribution share does not exceed the current allocation.";
  }
  return {
    recommendedMinimum: units(recommendedMinimum),
    recommendedMaximum: units(recommendedMaximum),
    benchmarkPosition: position,
    rationale: `${ownershipSentence} The suggested range stays inside the configured ${input.benchmark.stage} ${input.benchmark.role} benchmark.`,
  };
}
