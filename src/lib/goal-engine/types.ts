export type GoalStatus = "draft" | "voting" | "finalized" | "closed";
export type ConsensusMethod = "single" | "median_consensus";
export type GoalRole = "founder_admin" | "team_lead" | "contributor" | "viewer_investor";

export interface ConsensusResult {
  weight: number | null;
  method: "single" | "median" | "median_fallback" | "no_votes";
  votesUsed: number[];
  votesExcludedAsOutliers: number[];
  totalVoters: number;
}

export interface GoalVote {
  id: string;
  goal_id: string;
  voter_app_user_id: string;
  voter_name: string;
  weight_value: number;
  voted_at: string;
  round: number;
}

export interface WeightedGoal {
  id: string;
  name: string;
  goal_code: string;
  owning_team: string;
  period_start: string;
  period_end: string;
  status: GoalStatus;
  weight: number | null;
  consensus_method: ConsensusMethod;
  min_quorum: number;
  voting_deadline: string | null;
  finalized_at: string | null;
  consensus_result: ConsensusResult | null;
  voting_round: number;
  revision: number;
}

export interface GoalCollection {
  goals: WeightedGoal[];
  actor: { appUserId: string; role: GoalRole };
}

export interface GoalDetail {
  goal: WeightedGoal;
  votes: GoalVote[];
  history: { id: string; action: string; created_at: string; before: unknown; after: unknown }[];
}
