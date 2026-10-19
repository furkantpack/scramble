import { z } from "zod";

import { requireApiActor } from "@/lib/signal-engine/auth";
import { toDatabaseContribution, toDatabaseDomain, toDatabaseWeight } from "@/lib/signal-engine/db-tags";
import { ApiError, handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";
import { createSignalEngineAdminClient } from "@/lib/signal-engine/supabase-admin";

const overrideSchema = z.object({
  contributionType: z.enum(["TIME", "MONEY", "IP"]),
  domainTag: z.enum(["ENG", "DESIGN", "GROWTH", "SALES", "OPS", "FINANCE", "LEGAL"]),
  weightClass: z.enum(["CORE", "SUPPORTING"]),
  goalId: z.uuid().nullable(),
  status: z.enum(["unlinked", "linked", "ignored", "manual_review"]),
});

export async function PATCH(request: Request, context: { params: Promise<{ signalId: string }> }) {
  try {
    const actor = await requireApiActor(request, ["founder_admin", "team_lead"]);
    const { signalId } = await context.params;
    z.uuid().parse(signalId);
    const override = overrideSchema.parse(await readJsonBody(request));
    if (override.status === "linked" && !override.goalId) {
      throw new ApiError(400, "A linked signal must have a goal", "goal_required");
    }
    const client = createSignalEngineAdminClient();
    if (override.goalId) {
      const { data: goal } = await client
        .from("goals")
        .select("id")
        .eq("id", override.goalId)
        .eq("company_id", actor.companyId)
        .maybeSingle();
      if (!goal) throw new ApiError(400, "The selected goal is not part of this workspace", "invalid_goal");
    }

    const { data, error } = await client
      .from("signals")
      .update({
        contribution_type: override.contributionType,
        contrib_tag: toDatabaseContribution(override.contributionType),
        domain_tag: toDatabaseDomain(override.domainTag),
        normalized_domain_tag: override.domainTag,
        weight_class: override.weightClass,
        weight_tag: toDatabaseWeight(override.weightClass),
        tag_source: "manual",
        tag_confidence: 1,
        goal_id: override.goalId,
        goal_link_source: "manual",
        goal_link_reason: "manual",
        goal_link_confidence: override.goalId ? 1 : 0,
        status: override.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", signalId)
      .eq("company_id", actor.companyId)
      .select("id, contribution_type, domain_tag, normalized_domain_tag, weight_class, goal_id, status")
      .maybeSingle();
    if (error || !data) throw new ApiError(404, "Signal was not found", "signal_not_found");
    await client.from("audit_log").insert({
      company_id: actor.companyId,
      actor_id: actor.appUserId,
      action: "signal.overridden",
      entity_type: "signal",
      entity_id: signalId,
      after: { status: override.status, goalId: override.goalId },
    });
    return noStoreJson({ signal: data });
  } catch (error) {
    return handleApiError(error);
  }
}
