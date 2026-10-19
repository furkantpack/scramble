import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { ApiError, handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const authorizationSchema = z.object({
  approvedFillRunId: z.uuid(),
  reviewedForm: z.literal(true),
  confirmAuthorization: z.literal(true),
});

async function context(request: Request, route: RouteContext) {
  const actor = await requireApiActor(request, ["founder_admin"]);
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "Application unavailable", "application_not_found");
  const db = createSupabaseAdminClient();
  const { data: application } = await db.from("accelerator_applications")
    .select("id,workspace_id,company_id,accelerator_program_id,status")
    .eq("id", id).eq("workspace_id", actor.workspaceId).eq("company_id", actor.companyId).maybeSingle();
  if (!application?.accelerator_program_id)
    throw new ApiError(404, "Application unavailable", "application_not_found");
  return { actor, db, application };
}

export async function GET(request: Request, route: RouteContext) {
  try {
    const { db, application } = await context(request, route);
    const { data: record } = await db.from("application_submit_authorizations")
      .select("approved_fill_run_id,authorized_at,expires_at,revoked_at,dispatched_at")
      .eq("application_id", application.id).maybeSingle();
    return noStoreJson({
      enabled: process.env.SKYVERN_AUTO_SUBMIT_ENABLED === "true",
      authorized: Boolean(record && !record.revoked_at && !record.dispatched_at && Date.parse(record.expires_at) > Date.now()),
      dispatched: Boolean(record?.dispatched_at),
      approvedFillRunId: record?.approved_fill_run_id ?? null,
    });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request, route: RouteContext) {
  try {
    const { actor, db, application } = await context(request, route);
    if (process.env.SKYVERN_AUTO_SUBMIT_ENABLED !== "true")
      throw new ApiError(409, "Automatic submission is not enabled for this deployment", "auto_submit_disabled");
    const input = authorizationSchema.parse(await readJsonBody(request, 4 * 1024));
    if (application.status !== "agent_filled_pending_final_approval")
      throw new ApiError(409, "Review a completed fill before authorizing submission", "fill_not_ready");
    const { data: fillRun } = await db.from("browser_agent_runs")
      .select("id,status,mode,provider")
      .eq("id", input.approvedFillRunId).eq("application_id", application.id)
      .eq("workspace_id", actor.workspaceId).maybeSingle();
    if (!fillRun || fillRun.mode !== "fill" || fillRun.status !== "completed" || fillRun.provider !== "skyvern")
      throw new ApiError(409, "The reviewed Skyvern fill run is unavailable", "fill_run_mismatch");
    const { data: existing } = await db.from("application_submit_authorizations")
      .select("id,dispatched_at").eq("application_id", application.id).maybeSingle();
    if (existing?.dispatched_at)
      throw new ApiError(409, "Submission dispatch has already started", "already_dispatched");
    const now = new Date();
    const authorization = {
      workspace_id: actor.workspaceId,
      company_id: actor.companyId,
      application_id: application.id,
      program_id: application.accelerator_program_id ?? undefined,
      approved_fill_run_id: fillRun.id,
      authorized_by: actor.authUserId,
      authorized_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 60 * 60_000).toISOString(),
      revoked_at: null,
      dispatched_at: null,
    };
    const { data: saved, error } = existing
      ? await db.from("application_submit_authorizations").update(authorization)
        .eq("id", existing.id).is("dispatched_at", null).select("id").maybeSingle()
      : await db.from("application_submit_authorizations").insert(authorization).select("id").maybeSingle();
    if (error || !saved) throw new ApiError(409, "Authorization changed or dispatch already started", "authorization_conflict");
    await db.from("audit_logs").insert({
      workspace_id: actor.workspaceId, actor_user_id: actor.authUserId,
      application_id: application.id, action: "auto_submit_authorized",
      metadata: { programId: application.accelerator_program_id, fillRunId: fillRun.id },
    });
    return noStoreJson({ authorized: true, expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString() });
  } catch (error) { return handleApiError(error); }
}

export async function DELETE(request: Request, route: RouteContext) {
  try {
    const { actor, db, application } = await context(request, route);
    const { data, error } = await db.from("application_submit_authorizations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("application_id", application.id).eq("workspace_id", actor.workspaceId)
      .is("revoked_at", null).is("dispatched_at", null).select("id").maybeSingle();
    if (error) throw new ApiError(503, "Authorization could not be revoked", "revocation_failed");
    if (!data) throw new ApiError(409, "Submission dispatch has already started or no authorization exists", "revocation_too_late");
    await db.from("audit_logs").insert({ workspace_id: actor.workspaceId, actor_user_id: actor.authUserId,
      application_id: application.id, action: "auto_submit_revoked", metadata: {} });
    return noStoreJson({ revoked: true });
  } catch (error) { return handleApiError(error); }
}
