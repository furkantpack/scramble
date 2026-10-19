import "server-only";

import { resolveAppUserWithAdmin } from "@/lib/identity/supabase-app-user";
import type { ApiActor } from "@/lib/signal-engine/auth";
import { ApiError } from "@/lib/signal-engine/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

import { loadPreparedApplicationContext } from "./prepared-context";
import { getBrowserAgentProvider } from "./provider";
import { getApplicationAgentRepository } from "./repository";
import { fillRequestSchema, getApplicationAgentRun, startApplicationFill, submitPreparedApplication, submitRequestSchema } from "./service";

type Job = Database["public"]["Tables"]["application_dispatch_jobs"]["Row"];
type Intent = { formUrl?: string; version?: number; deckApproved?: boolean; previousRunId?: string };

export function jobRunView(job: Job) {
  const unknown = job.status === "unknown_dispatch";
  return {
    id: job.browser_run_id ?? job.id,
    provider: "skyvern" as const,
    mode: job.kind,
    status: job.status === "cancelled" ? "cancelled" as const :
      unknown || job.status === "failed" ? "failed" as const : "queued" as const,
    applicationState: unknown && job.kind === "submit" ? "SUBMISSION_UNVERIFIED" :
      unknown ? "FAILED" : job.kind === "submit" ? "SUBMITTING" : "AGENT_FILLING",
    errorCode: unknown ? "UNKNOWN_DISPATCH" : job.error_code ?? undefined,
    error: unknown ? "Skyvern may have accepted this task, but its run ID could not be confirmed. Do not retry until an operator checks Skyvern." :
      job.status === "failed" ? "The task could not be prepared. Check the application information before retrying." : undefined,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

export async function activeDispatchJob(actor: ApiActor, applicationId: string) {
  const data = await latestDispatchJob(actor, applicationId);
  return data && ["queued", "claimed", "dispatching", "unknown_dispatch"].includes(data.status) ? data : null;
}

export async function latestDispatchJob(actor: ApiActor, applicationId: string) {
  const { data, error } = await createSupabaseAdminClient().from("application_dispatch_jobs")
    .select("*").eq("workspace_id", actor.workspaceId).eq("company_id", actor.companyId)
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new ApiError(503, "Application job status is unavailable", "job_status_unavailable");
  return data;
}

export async function enqueueFillJob(actor: ApiActor, applicationId: string, raw: unknown) {
  getBrowserAgentProvider(); // Fail closed before claiming work when live credentials are absent.
  const input = fillRequestSchema.parse(raw);
  const repository = getApplicationAgentRepository();
  const application = await repository.getOwnedApplication(applicationId, actor.workspaceId);
  if (!application || application.companyId !== actor.companyId)
    throw new ApiError(404, "Application unavailable", "application_not_found");
  if (["SUBMITTED", "SUBMITTING", "SUBMISSION_UNVERIFIED"].includes(application.state))
    throw new ApiError(409, "This application cannot be filled", "invalid_application_state");
  if (await activeDispatchJob(actor, applicationId))
    throw new ApiError(409, "An application task is already queued or needs reconciliation", "job_already_active");
  if (input.files.some((file) => !file.approved))
    throw new ApiError(409, "Approve each requested document", "files_need_approval");
  const prepared = await loadPreparedApplicationContext(actor, applicationId, input.files);
  if (input.formUrl && new URL(input.formUrl).toString() !== prepared.formUrl)
    throw new ApiError(409, "The program application URL changed", "application_url_changed");
  const intent: Intent = { formUrl: prepared.formUrl, version: input.version,
    deckApproved: input.files.some((file) => file.label === "Pitch deck" && file.approved) };
  const key = `fill:${actor.companyId}:${applicationId}:${prepared.revision}:${input.version}`;
  return insertJob(actor, applicationId, "fill", intent, key);
}

export async function enqueueSubmitJob(actor: ApiActor, applicationId: string, raw: unknown) {
  getBrowserAgentProvider();
  const input = submitRequestSchema.parse(raw);
  const repository = getApplicationAgentRepository();
  const application = await repository.getOwnedApplication(applicationId, actor.workspaceId);
  if (!application || application.companyId !== actor.companyId)
    throw new ApiError(404, "Application unavailable", "application_not_found");
  if (application.state !== "AGENT_FILLED_PENDING_FINAL_APPROVAL" || application.fillRunId !== input.previousRunId)
    throw new ApiError(409, "Review the latest completed fill before submitting", "fill_run_mismatch");
  const fill = await repository.getRun(input.previousRunId);
  if (fill?.status !== "completed" || fill.mode !== "fill")
    throw new ApiError(409, "The fill run is not ready", "fill_not_completed");
  if (await activeDispatchJob(actor, applicationId))
    throw new ApiError(409, "An application task is already queued or needs reconciliation", "job_already_active");
  return insertJob(actor, applicationId, "submit", { previousRunId: input.previousRunId },
    `submit:${actor.companyId}:${applicationId}:${input.previousRunId}`);
}

async function insertJob(actor: ApiActor, applicationId: string, kind: Job["kind"], intent: Intent, key: string) {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.from("application_dispatch_jobs")
    .insert({ workspace_id: actor.workspaceId, company_id: actor.companyId,
      application_id: applicationId, requested_by: actor.authUserId,
      kind, request_intent: intent as Json, idempotency_key: key })
    .select("*").single();
  if (data) return jobRunView(data);
  if (error?.code === "23505") {
    const { data: existing } = await db.from("application_dispatch_jobs")
      .select("*").eq("idempotency_key", key).maybeSingle();
    if (existing && existing.workspace_id === actor.workspaceId && existing.company_id === actor.companyId) {
      if (existing.status === "cancelled" || (existing.status === "failed" && !existing.browser_run_id)) {
        const { data: requeued } = await db.from("application_dispatch_jobs")
          .update({ status: "queued", attempts: 0, next_attempt_at: new Date().toISOString(),
            lease_until: null, error_code: null, updated_at: new Date().toISOString() })
          .eq("id", existing.id).eq("status", existing.status).select("*").maybeSingle();
        if (requeued) return jobRunView(requeued);
      }
      if (existing.browser_run_id) return getApplicationAgentRun(actor, applicationId);
      return jobRunView(existing);
    }
  }
  throw new ApiError(409, "An application task is already queued", "job_conflict");
}

export async function dispatchApplicationJobs() {
  const db = createSupabaseAdminClient();
  const { data: jobs, error } = await db.rpc("claim_application_dispatch_jobs", { max_jobs: 2 });
  if (error) throw new Error(`Application job claim unavailable: ${error.code}`);
  let dispatched = 0;
  for (const job of jobs ?? []) {
    const actor = await currentOwner(job);
    if (!actor) { await markPreDispatchFailure(job, "OWNER_ACCESS_REVOKED", false); continue; }
    const intent = job.request_intent as Intent;
    try {
      // All facts, permissions and signed document URLs are loaded again at execution time.
      if (job.kind === "fill") {
        await loadPreparedApplicationContext(actor, job.application_id,
          intent.deckApproved ? [{ label: "Pitch deck", approved: true }] : []);
      } else {
        const application = await getApplicationAgentRepository().getOwnedApplication(job.application_id, job.workspace_id);
        if (!application || application.fillRunId !== intent.previousRunId ||
          application.state !== "AGENT_FILLED_PENDING_FINAL_APPROVAL")
          throw new ApiError(409, "The reviewed fill changed", "fill_run_mismatch");
      }
    } catch (preflightError) {
      await markPreDispatchFailure(job, preflightError instanceof ApiError ? preflightError.code : "PREFLIGHT_UNAVAILABLE",
        !(preflightError instanceof ApiError));
      continue;
    }
    const { data: begun, error: beginError } = await db.rpc("begin_application_dispatch", { target_job_id: job.id });
    if (beginError || !begun) continue;
    try {
      const result = job.kind === "fill"
        ? await startApplicationFill(actor, job.application_id, {
          formUrl: intent.formUrl, version: intent.version,
          files: intent.deckApproved ? [{ label: "Pitch deck", approved: true }] : [],
        })
        : await submitPreparedApplication(actor, job.application_id,
          { confirmSubmit: true, previousRunId: intent.previousRunId });
      const { data: run } = await db.from("browser_agent_runs").select("external_run_id")
        .eq("id", result.id).eq("workspace_id", job.workspace_id).maybeSingle();
      const { error: saveError } = await db.from("application_dispatch_jobs")
        .update({ status: "dispatched", browser_run_id: result.id,
          external_run_id: run?.external_run_id ?? null, lease_until: null, updated_at: new Date().toISOString() })
        .eq("id", job.id).eq("status", "dispatching");
      if (saveError) throw saveError;
      dispatched++;
    } catch {
      // The SDK may have accepted a task before an HTTP timeout or DB failure.
      // Neither fill nor final submit may be automatically dispatched again.
      await db.from("application_dispatch_jobs").update({ status: "unknown_dispatch",
        lease_until: null, error_code: "UNKNOWN_DISPATCH", updated_at: new Date().toISOString() })
        .eq("id", job.id).eq("status", "dispatching");
      if (job.kind === "submit") await db.from("accelerator_applications")
        .update({ status: "submission_unverified" }).eq("id", job.application_id)
        .eq("workspace_id", job.workspace_id).eq("company_id", job.company_id);
    }
  }
  return { claimed: jobs?.length ?? 0, dispatched };
}

async function currentOwner(job: Job): Promise<ApiActor | null> {
  const db = createSupabaseAdminClient();
  const [{ data: member }, { data: application }] = await Promise.all([
    db.from("workspace_members").select("user_id").eq("workspace_id", job.workspace_id)
      .eq("user_id", job.requested_by).eq("role", "owner").maybeSingle(),
    db.from("accelerator_applications").select("id").eq("id", job.application_id)
      .eq("workspace_id", job.workspace_id).eq("company_id", job.company_id).maybeSingle(),
  ]);
  if (!member || !application) return null;
  try {
    const identity = await resolveAppUserWithAdmin(job.requested_by, job.company_id, db);
    if (identity.role !== "founder_admin") return null;
    return { authUserId: job.requested_by, appUserId: identity.id,
      workspaceId: job.workspace_id, companyId: job.company_id, role: identity.role };
  } catch {
    return null;
  }
}

async function markPreDispatchFailure(job: Job, code: string, retryable: boolean) {
  const shouldRetry = retryable && job.attempts < 3;
  const delayMs = Math.min(300_000, 15_000 * 2 ** job.attempts);
  await createSupabaseAdminClient().from("application_dispatch_jobs").update({
    status: shouldRetry ? "queued" : "failed", lease_until: null,
    next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
    error_code: code, updated_at: new Date().toISOString(),
  }).eq("id", job.id).eq("status", "claimed");
}

