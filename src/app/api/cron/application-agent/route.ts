import { dispatchApplicationJobs, enqueueSubmitJob } from "@/lib/application-agent/dispatch-jobs";
import { getApplicationAgentRun } from "@/lib/application-agent/service";
import { ServerConfigurationError, verifyApplicationCronRequest } from "@/lib/configuration/server-env";
import { resolveAppUserWithAdmin } from "@/lib/identity/supabase-app-user";
import type { ApiActor } from "@/lib/signal-engine/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    if (!verifyApplicationCronRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  } catch (error) {
    if (error instanceof ServerConfigurationError) {
      return Response.json({ error: "Server configuration error", code: error.code }, { status: 503 });
    }
    throw error;
  }
  const db = createSupabaseAdminClient();
  let reconciled = 0;
  const { data: activeRuns } = await db.from("browser_agent_runs")
    .select("application_id,workspace_id")
    .in("status", ["queued", "running", "human_input_required"])
    .order("created_at", { ascending: true }).limit(3);
  for (const run of activeRuns ?? []) {
    const actor = await ownerActor(db, run.application_id, run.workspace_id);
    if (!actor) continue;
    try { await getApplicationAgentRun(actor, run.application_id); reconciled++; } catch { /* Retry on the next scheduled poll. */ }
  }

  let dispatched = 0;
  if (process.env.SKYVERN_AUTO_SUBMIT_ENABLED === "true") {
    const { data: candidates } = await db.from("application_submit_authorizations")
      .select("id,application_id,workspace_id,company_id,program_id,approved_fill_run_id,authorized_by")
      .is("revoked_at", null).is("dispatched_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("authorized_at", { ascending: true }).limit(2);
    for (const candidate of candidates ?? []) {
      const actor = await ownerActor(db, candidate.application_id, candidate.workspace_id, candidate.authorized_by);
      if (!actor || actor.authUserId !== candidate.authorized_by || actor.companyId !== candidate.company_id) continue;
      const [{ data: application }, { data: fillRun }] = await Promise.all([
        db.from("accelerator_applications").select("status,accelerator_program_id")
          .eq("id", candidate.application_id).eq("workspace_id", candidate.workspace_id)
          .eq("company_id", candidate.company_id).maybeSingle(),
        db.from("browser_agent_runs").select("status,mode,provider")
          .eq("id", candidate.approved_fill_run_id).eq("application_id", candidate.application_id)
          .eq("workspace_id", candidate.workspace_id).maybeSingle(),
      ]);
      if (application?.status !== "agent_filled_pending_final_approval" ||
        application.accelerator_program_id !== candidate.program_id ||
        fillRun?.status !== "completed" || fillRun.mode !== "fill" || fillRun.provider !== "skyvern") continue;
      const { data: claimed } = await db.from("application_submit_authorizations")
        .update({ dispatched_at: new Date().toISOString() })
        .eq("id", candidate.id).is("revoked_at", null).is("dispatched_at", null)
        .gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
      if (!claimed) continue;
      await db.from("audit_logs").insert({ workspace_id: actor.workspaceId, actor_user_id: actor.authUserId,
        application_id: candidate.application_id, action: "auto_submit_dispatched",
        metadata: { authorizationId: candidate.id, fillRunId: candidate.approved_fill_run_id } });
      try {
        await enqueueSubmitJob(actor, candidate.application_id,
          { confirmSubmit: true, previousRunId: candidate.approved_fill_run_id });
        dispatched++;
      } catch {
        // Never reset dispatched_at or automatically retry an uncertain final submission.
        await db.from("audit_logs").insert({ workspace_id: actor.workspaceId, actor_user_id: actor.authUserId,
          application_id: candidate.application_id, action: "auto_submit_dispatch_needs_review", metadata: {} });
      }
    }
  }
  const jobs = await dispatchApplicationJobs();
  return Response.json({ reconciled, authorizedQueued: dispatched, jobs }, { headers: { "Cache-Control": "no-store" } });
}

async function ownerActor(
  db: ReturnType<typeof createSupabaseAdminClient>, applicationId: string, workspaceId: string, userId?: string,
): Promise<ApiActor | null> {
  let memberQuery = db.from("workspace_members").select("user_id")
    .eq("workspace_id", workspaceId).eq("role", "owner");
  if (userId) memberQuery = memberQuery.eq("user_id", userId);
  const [{ data: application }, { data: owner }] = await Promise.all([
    db.from("accelerator_applications").select("company_id").eq("id", applicationId)
      .eq("workspace_id", workspaceId).maybeSingle(),
    memberQuery.limit(1).maybeSingle(),
  ]);
  if (!application || !owner) return null;
  try {
    const identity = await resolveAppUserWithAdmin(owner.user_id, application.company_id, db);
    if (identity.role !== "founder_admin") return null;
    return { authUserId: owner.user_id, appUserId: identity.id, workspaceId,
      companyId: application.company_id, role: identity.role };
  } catch {
    return null;
  }
}
