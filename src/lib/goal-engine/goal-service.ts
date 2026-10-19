import "server-only";

import type { ApiActor } from "@/lib/signal-engine/auth";
import { ApiError } from "@/lib/signal-engine/http";
import { createSignalEngineAdminClient } from "@/lib/signal-engine/supabase-admin";

import type { GoalDetail, WeightedGoal } from "./types";
import { createGoalsSchema, mutationSchema } from "./validation";

const messages: Record<string, [number, string]> = {
  forbidden: [403, "Your workspace role cannot perform this action."],
  goal_not_found: [404, "Goal not found in this workspace."],
  stale_goal: [409, "This goal changed. Refresh it before trying again."],
  voting_closed: [409, "This goal is not open for voting."],
  deadline_passed: [409, "The voting deadline has passed."],
  quorum_not_met: [409, "More eligible leadership votes are required."],
  invalid_transition: [409, "This action is unavailable in the current goal state."],
  request_reused: [409, "This request was already saved with different values. Refresh and try again."],
  invalid_weight: [400, "Enter a weight from 0 to 100 with up to two decimals."],
  reason_required: [400, "Enter a reason of at least five characters."],
};

function databaseError(error: { code?: string; message?: string }): never {
  if (error.code === "23505")
    throw new ApiError(409, "A goal with this code already exists for that period.", "duplicate_goal");
  const known = messages[error.message ?? ""];
  if (known) throw new ApiError(known[0], known[1], error.message ?? "goal_error");
  if (["42703", "42P01", "PGRST202", "PGRST204"].includes(error.code ?? "")) {
    throw new ApiError(
      503,
      "Goal storage is not ready. Apply the Goal Weighting Engine migration.",
      "migration_required",
    );
  }
  throw new ApiError(500, "The goal could not be saved or loaded. No success has been recorded.", "goal_storage_error");
}

export async function listGoals(actor: ApiActor, active = false) {
  const db = createSignalEngineAdminClient();
  let query = db
    .from("goals")
    .select("*")
    .eq("company_id", actor.companyId)
    .order("period_start", { ascending: false })
    .order("created_at", { ascending: false });
  if (active) {
    const today = new Date().toISOString().slice(0, 10);
    query = query.lte("period_start", today).gte("period_end", today).neq("status", "closed");
  }
  const { data, error } = await query.limit(500);
  if (error) databaseError(error);
  if (data?.some((goal) => !goal.consensus_method)) databaseError({ code: "42703" });
  return { goals: data as WeightedGoal[], actor: { appUserId: actor.appUserId, role: actor.role } };
}

export async function getGoal(actor: ApiActor, id: string): Promise<GoalDetail> {
  const db = createSignalEngineAdminClient();
  const { data: goal, error } = await db
    .from("goals")
    .select("*")
    .eq("id", id)
    .eq("company_id", actor.companyId)
    .maybeSingle();
  if (error) databaseError(error);
  if (!goal) throw new ApiError(404, "Goal not found in this workspace.", "goal_not_found");
  if (!goal.consensus_method) databaseError({ code: "42703" });
  const votes = await db
    .from("goal_weight_votes")
    .select("*, voter:app_users!voter_app_user_id(name,status,role,company_id)")
    .eq("goal_id", id)
    .eq("round", goal.voting_round)
    .order("voted_at");
  if (votes.error) databaseError(votes.error);
  const history = await db
    .from("audit_log")
    .select("id,action,created_at,before,after")
    .eq("company_id", actor.companyId)
    .eq("entity_type", "goal")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (history.error) databaseError(history.error);
  return {
    goal: goal as WeightedGoal,
    votes: (votes.data ?? [])
      .filter(
        (v) =>
          v.voter?.company_id === actor.companyId &&
          v.voter.status === "active" &&
          ["founder_admin", "team_lead"].includes(v.voter.role),
      )
      .map(({ voter, ...v }) => ({ ...v, voter_name: voter.name })),
    history: history.data ?? [],
  };
}

export async function createGoals(actor: ApiActor, body: unknown) {
  const input = createGoalsSchema.parse(body);
  if (
    !["founder_admin", "team_lead"].includes(actor.role) ||
    (actor.role !== "founder_admin" && input.goals.some((g) => g.initial_weight !== undefined))
  ) {
    throw new ApiError(403, "Only a founder can finalize initial weights.", "forbidden");
  }
  const { data, error } = await createSignalEngineAdminClient().rpc("create_weighted_goals", {
    p_actor: actor.appUserId,
    p_request: input.request_id,
    p_goals: input.goals,
  });
  if (error) databaseError(error);
  return { goals: data as WeightedGoal[] };
}

export async function mutateGoal(actor: ApiActor, id: string, body: unknown) {
  const input = mutationSchema.parse(body);
  if (actor.role !== "founder_admin" && (input.action !== "vote" || actor.role !== "team_lead")) {
    throw new ApiError(403, "Your role cannot perform this goal action.", "forbidden");
  }
  const { data, error } = await createSignalEngineAdminClient().rpc("mutate_weighted_goal", {
    p_actor: actor.appUserId,
    p_goal: id,
    p_action: input.action,
    p_revision: input.revision,
    p_weight: "weight" in input ? (input.weight ?? null) : null,
    p_reason: "reason" in input ? input.reason : null,
  });
  if (error) databaseError(error);
  return { goal: data as WeightedGoal };
}
