import { d, units } from "@/domain/sliceCalculation/math";

import type { BenchmarkContext, BenchmarkPosition, BenchmarkRule } from "./types";

export function classifyBenchmark(value: string, rule: BenchmarkRule): BenchmarkPosition {
  const recommendation = d(value);
  if (recommendation.lt(rule.minimum)) return "below";
  if (recommendation.gt(rule.maximum)) return "above";
  return "within";
}

export function benchmarkContext(value: string, rule: BenchmarkRule): BenchmarkContext {
  const position = classifyBenchmark(value, rule);
  return {
    rule,
    recommendation: units(value),
    position,
    explanation: `The recommendation is ${position} the ${rule.minimum}-${rule.maximum}% reference range for ${rule.role} at ${rule.stage} stage.`,
  };
}
