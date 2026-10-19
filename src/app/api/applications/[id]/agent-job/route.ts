import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { ApiError, handleApiError, noStoreJson } from "@/lib/signal-engine/http";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request, ["founder_admin"]);
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "Application unavailable", "application_not_found");
    const db = createSupabaseAdminClient();
    const { data: application } = await db.from("accelerator_applications").select("id")
      .eq("id", id).eq("workspace_id", actor.workspaceId).eq("company_id", actor.companyId).maybeSingle();
    if (!application) throw new ApiError(404, "Application unavailable", "application_not_found");
    const { data, error } = await db.from("application_dispatch_jobs")
      .update({ status: "cancelled", lease_until: null, updated_at: new Date().toISOString() })
      .eq("application_id", id).eq("workspace_id", actor.workspaceId).eq("company_id", actor.companyId)
      .in("status", ["queued", "claimed"]).select("id").limit(1).maybeSingle();
    if (error) throw new ApiError(503, "Cancellation unavailable", "job_cancel_unavailable");
    if (!data) throw new ApiError(409, "The browser task has already started or no queued task exists", "job_cannot_cancel");
    await db.from("audit_logs").insert({ workspace_id: actor.workspaceId, actor_user_id: actor.authUserId,
      application_id: id, action: "application_job_cancelled", metadata: { jobId: data.id } });
    return noStoreJson({ cancelled: true });
  } catch (error) { return handleApiError(error); }
}
