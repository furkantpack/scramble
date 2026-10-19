import type { ConsensusMethod } from "./types";
import { goalInputSchema } from "./validation";

export interface OnboardingGoal {
  id: number;
  name: string;
  code: string;
  team: string;
  weight: number;
  start: string;
  end: string;
  method: ConsensusMethod;
  quorum: number;
  methodChosen: boolean;
}
export function emptyOnboardingGoal(id: number): OnboardingGoal {
  return {
    id,
    name: "",
    code: "",
    team: "Company",
    weight: 50,
    start: "",
    end: "",
    method: "single",
    quorum: 1,
    methodChosen: false,
  };
}
export function recommendedMethod(size: string): ConsensusMethod {
  return ["4-5", "6-15", "16-50", "51+"].includes(size) ? "median_consensus" : "single";
}
export function onboardingGoalInput(goal: OnboardingGoal, size: string, founder: boolean) {
  const method = goal.methodChosen ? goal.method : recommendedMethod(size);
  return goalInputSchema.parse({
    name: goal.name,
    goal_code: goal.code,
    owning_team: goal.team,
    period_start: goal.start,
    period_end: goal.end,
    consensus_method: method,
    min_quorum: method === "single" ? 1 : goal.quorum,
    ...(method === "single" && founder ? { initial_weight: goal.weight } : {}),
  });
}
