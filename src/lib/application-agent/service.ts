import "server-only";

import { z } from "zod";

import type { ApiActor } from "@/lib/signal-engine/auth";
import { ApiError } from "@/lib/signal-engine/http";
import { BrowserAgentError } from "@/lib/skyvern/errors";
import { normalizeSkyvernRun } from "@/lib/skyvern/get-run";
import type { SkyvernWebhookPayload } from "@/lib/skyvern/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { logAgentTransition } from "./logging";
import { loadPreparedApplicationContext } from "./prepared-context";
import { getBrowserAgentProvider } from "./provider";
import { createPendingRun, getApplicationAgentRepository } from "./repository";
import type { ApplicationAutomationRecord, ApprovedAnswer, BrowserAgentRun } from "./types";

const fileSchema = z.object({
  label: z.string().trim().min(1).max(200),
  approved: z.boolean(),
});

export const fillRequestSchema = z.object({
  formUrl: z.url().optional(),
  version: z.number().int().min(1).max(3).default(1),
  files: z.array(fileSchema).max(30).optional().default([]),
});

export const submitRequestSchema = z.object({
  confirmSubmit: z.literal(true),
  previousRunId: z.string().uuid(),
});

export async function startApplicationFill(actor: ApiActor, applicationId: string, rawInput: unknown) {
  const applicationAgentRepository = getApplicationAgentRepository();
  const startedAt = Date.now();
  const input = fillRequestSchema.parse(rawInput);
  const application = await requireOwnedApplication(applicationId, actor.workspaceId, applicationAgentRepository);
  if (application.companyId && application.companyId !== actor.companyId)
    throw new ApiError(404, "Application not found", "application_not_found");
  const provider = getBrowserAgentProvider();
  if (
    application.state === "SUBMITTED" ||
    application.state === "SUBMITTING" ||
    application.state === "SUBMISSION_UNVERIFIED"
  ) {
    throw new ApiError(409, "This application can no longer be filled", "invalid_application_state");
  }
  if (application.state === "AGENT_FILLING" || application.state === "AGENT_FILLED_PENDING_FINAL_APPROVAL") {
    const existing = application.fillRunId ? await applicationAgentRepository.getRun(application.fillRunId) : null;
    if (existing) {
      if (existing.provider !== provider.name)
        throw new ApiError(
          409,
          "The previous run used a different provider. Review it before continuing.",
          "provider_changed",
        );
      return publicRun(existing, application);
    }
  }
  if (input.version > 1 && application.state !== "FAILED")
    throw new ApiError(409, "A new fill attempt is only available after a failed attempt", "retry_not_allowed");
  if (input.files.some((file) => !file.approved)) {
    throw new ApiError(409, "All attached files must be approved before filling", "files_need_approval");
  }
  const preparedContext = await loadPreparedApplicationContext(actor, applicationId, input.files);
  if (input.formUrl && new URL(input.formUrl).toString() !== preparedContext.formUrl)
    throw new ApiError(
      409,
      "The official application URL has changed. Refresh and review the program.",
      "application_url_changed",
    );
  await assertWorkspaceCapacity(actor.workspaceId);
  const idempotencyKey = `fill:${actor.companyId}:${applicationId}:${preparedContext.revision}:${input.version}`;
  const pending = createPendingRun(applicationId, "fill");
  const claim = await applicationAgentRepository.claimRun(pending, idempotencyKey);
  if (!claim.claimed) {
    if (claim.run.provider !== provider.name && !claim.run.externalRunId.startsWith("pending:"))
      throw new ApiError(409, "A run from another provider already exists", "provider_changed");
    return publicRun(claim.run, application);
  }
  const prepared: ApplicationAutomationRecord = {
    ...application,
    formUrl: preparedContext.formUrl,
    version: input.version,
    answers: preparedContext.approvedAnswers,
    files: preparedContext.files,
    fillRunId: pending.id,
    state: "AGENT_FILLING",
  };
  await applicationAgentRepository.saveApplication(prepared);
  await writeAudit(
    prepared.workspaceId,
    "agent_fill_started",
    applicationId,
    actor.authUserId,
    application.state,
    prepared.state,
  );

  try {
    const providerRun = await provider.startFill({
      applicationId,
      formUrl: preparedContext.formUrl,
      programName: preparedContext.programName,
      programContext: preparedContext.programContext,
      confirmedProfile: preparedContext.profile,
      answers: approvedAnswers(preparedContext.approvedAnswers),
      files: preparedContext.files.map(({ label, urlOrPath }) => ({ label, urlOrPath })),
    });
    const run = { ...providerRun, id: pending.id, applicationId, mode: "fill" as const };
    await applicationAgentRepository.saveRun(run, idempotencyKey);
    logAgentTransition(run, pending.status, startedAt);
    return publicRun(run, prepared);
  } catch (error) {
    const run = failedPendingRun(pending, error);
    await applicationAgentRepository.saveRun(run, idempotencyKey);
    await applicationAgentRepository.saveApplication({ ...prepared, state: "FAILED" });
    await writeAudit(
      prepared.workspaceId,
      "application_failed",
      applicationId,
      actor.authUserId,
      prepared.state,
      "FAILED",
    );
    logAgentTransition(run, pending.status, startedAt);
    throw error;
  }
}

export async function submitPreparedApplication(actor: ApiActor, applicationId: string, rawInput: unknown) {
  const applicationAgentRepository = getApplicationAgentRepository();
  const startedAt = Date.now();
  const input = submitRequestSchema.parse(rawInput);
  const application = await requireOwnedApplication(applicationId, actor.workspaceId, applicationAgentRepository);
  if (application.companyId && application.companyId !== actor.companyId)
    throw new ApiError(404, "Application not found", "application_not_found");
  if (application.state !== "AGENT_FILLED_PENDING_FINAL_APPROVAL" || !application.fillRunId) {
    throw new ApiError(409, "The application is not awaiting final submission approval", "invalid_application_state");
  }

  const fillRun = await applicationAgentRepository.getRun(application.fillRunId);
  if (fillRun?.status !== "completed") {
    throw new ApiError(409, "The fill run has not completed", "fill_not_completed");
  }
  if (input.previousRunId !== fillRun.id) {
    throw new ApiError(409, "The approved fill run does not match", "fill_run_mismatch");
  }

  const provider = getBrowserAgentProvider(fillRun.provider);
  await assertWorkspaceCapacity(actor.workspaceId);
  const idempotencyKey = `submit:${actor.companyId}:${applicationId}:${fillRun.externalRunId}`;
  const pending = createPendingRun(applicationId, "submit");
  const claim = await applicationAgentRepository.claimRun(pending, idempotencyKey);
  if (!claim.claimed) return publicRun(claim.run, application);
  const submitting: ApplicationAutomationRecord = {
    ...application,
    submitRunId: pending.id,
    submittedBy: actor.appUserId,
    state: "SUBMITTING",
  };
  await applicationAgentRepository.saveApplication(submitting);
  await writeAudit(
    submitting.workspaceId,
    "final_submit_confirmed",
    applicationId,
    actor.authUserId,
    application.state,
    submitting.state,
  );

  try {
    const providerRun = await provider.submit({
      applicationId,
      previousRunId: fillRun.externalRunId,
      browserSessionId: fillRun.browserSessionId,
    });
    const run = { ...providerRun, id: pending.id, applicationId, mode: "submit" as const };
    await applicationAgentRepository.saveRun(run, idempotencyKey);
    logAgentTransition(run, pending.status, startedAt);
    return publicRun(run, submitting);
  } catch (error) {
    const run = failedPendingRun(pending, error);
    await applicationAgentRepository.saveRun(run, idempotencyKey);
    await applicationAgentRepository.saveApplication({ ...submitting, state: "SUBMISSION_UNVERIFIED" });
    await writeAudit(
      submitting.workspaceId,
      "application_submission_unverified",
      applicationId,
      actor.authUserId,
      submitting.state,
      "SUBMISSION_UNVERIFIED",
    );
    logAgentTransition(run, pending.status, startedAt);
    throw error;
  }
}

export async function getApplicationAgentRun(actor: ApiActor, applicationId: string) {
  const applicationAgentRepository = getApplicationAgentRepository();
  const application = await requireOwnedApplication(applicationId, actor.workspaceId, applicationAgentRepository);
  if (application.companyId && application.companyId !== actor.companyId)
    throw new ApiError(404, "Application not found", "application_not_found");
  const runId = application.submitRunId ?? application.fillRunId;
  if (!runId) throw new ApiError(404, "No browser agent run exists for this application", "run_not_found");
  const current = await applicationAgentRepository.getRun(runId);
  if (!current) throw new ApiError(404, "Browser agent run not found", "run_not_found");
  if (isActiveRunExpired(current)) {
    return persistRunOutcome(
      {
        ...current,
        status: "failed",
        error: "The browser run timed out. Check the application portal before another attempt.",
        errorCode: "SKYVERN_TIMEOUT",
        updatedAt: new Date().toISOString(),
      },
      application,
    );
  }
  if (["completed", "failed", "cancelled"].includes(current.status)) {
    if (application.state === "AGENT_FILLING" || application.state === "SUBMITTING")
      return persistRunOutcome(current, application);
    return publicRun(current, application);
  }
  if (current.externalRunId.startsWith("pending:")) return publicRun(current, application);

  try {
    const updated = await getBrowserAgentProvider(current.provider).getRun(current);
    return persistRunOutcome(updated, application);
  } catch (error) {
    if (error instanceof BrowserAgentError && error.retryable) return publicRun(current, application);
    throw error;
  }
}

export function isActiveRunExpired(run: BrowserAgentRun, now = Date.now()) {
  if (["completed", "failed", "cancelled"].includes(run.status)) return false;
  const age = now - Date.parse(run.createdAt);
  return (run.externalRunId.startsWith("pending:") && age > 2 * 60_000) || age > 2 * 60 * 60_000;
}

export async function processSkyvernWebhook(payload: SkyvernWebhookPayload) {
  const applicationAgentRepository = getApplicationAgentRepository();
  const current = await applicationAgentRepository.getRunByExternalId(payload.run_id);
  if (current?.provider !== "skyvern") return { accepted: true, ignored: true };
  const incomingStatus = normalizeWebhookStatus(payload.status);
  if (
    current.status === "completed" ||
    (["failed", "cancelled"].includes(current.status) && incomingStatus !== "completed")
  )
    return { accepted: true, duplicate: true };
  const applicationRun = normalizeSkyvernRun(payload, current);
  const application = await findApplicationForRun(current);
  if (!application) return { accepted: true, ignored: true };
  await persistRunOutcome(applicationRun, application);
  return { accepted: true, duplicate: false };
}

async function persistRunOutcome(run: BrowserAgentRun, application: ApplicationAutomationRecord) {
  const applicationAgentRepository = getApplicationAgentRepository();
  const previousStatus = (await applicationAgentRepository.getRun(run.id))?.status;
  let normalizedRun = run;
  let state = application.state;
  if (run.requiresHumanInput) {
    state = run.mode === "fill" ? "AGENT_FILLING" : "SUBMITTING";
  } else if (run.status === "completed" && run.mode === "fill") {
    if (isFillReadyForReview(run.result)) state = "AGENT_FILLED_PENDING_FINAL_APPROVAL";
    else {
      state = "FAILED";
      normalizedRun = {
        ...run,
        status: "failed",
        error: "The browser agent did not confirm that the form is ready for human review",
        errorCode: "SKYVERN_RUN_FAILED",
      };
    }
  } else if (run.status === "completed" && run.mode === "submit") {
    if (run.submissionEvidence?.confirmed) state = "SUBMITTED";
    else {
      state = "SUBMISSION_UNVERIFIED";
      normalizedRun = {
        ...run,
        error: "The external site did not provide a clear submission confirmation. Check the portal before retrying.",
        errorCode: "SUBMISSION_UNVERIFIED",
      };
    }
  } else if (run.status === "failed" || run.status === "cancelled") {
    state = run.mode === "submit" ? "SUBMISSION_UNVERIFIED" : "FAILED";
  } else {
    state = run.mode === "fill" ? "AGENT_FILLING" : "SUBMITTING";
  }

  await applicationAgentRepository.saveRun(normalizedRun);
  const updatedApplication = { ...application, state, submissionEvidence: run.submissionEvidence };
  await applicationAgentRepository.saveApplication(updatedApplication);
  if (state !== application.state) {
    const action =
      state === "AGENT_FILLED_PENDING_FINAL_APPROVAL"
        ? "agent_fill_completed"
        : state === "SUBMITTED"
          ? "application_submitted"
          : state === "FAILED"
            ? "application_failed"
            : state === "SUBMISSION_UNVERIFIED"
              ? "application_submission_unverified"
              : null;
    if (action) await writeAudit(application.workspaceId, action, application.id, undefined, application.state, state);
  }
  logAgentTransition(normalizedRun, previousStatus);
  return publicRun(normalizedRun, updatedApplication);
}

async function requireOwnedApplication(
  applicationId: string,
  workspaceId: string,
  repository = getApplicationAgentRepository(),
) {
  const application = await repository.getOwnedApplication(applicationId, workspaceId);
  if (!application) throw new ApiError(404, "Application not found", "application_not_found");
  return application;
}

async function findApplicationForRun(run: BrowserAgentRun) {
  return getApplicationAgentRepository().getApplicationByRunId(run.id);
}

function approvedAnswers(answers: ApprovedAnswer[]) {
  return answers
    .filter((answer) => answer.approved)
    .map(({ question, value, fieldType }) => ({ question, value, fieldType }));
}

function failedPendingRun(run: BrowserAgentRun, error: unknown): BrowserAgentRun {
  return {
    ...run,
    status: "failed",
    error: error instanceof BrowserAgentError ? error.message : "The browser agent operation failed",
    errorCode: error instanceof BrowserAgentError ? error.code : "SKYVERN_UNKNOWN",
    updatedAt: new Date().toISOString(),
  };
}

function publicRun(run: BrowserAgentRun, application: ApplicationAutomationRecord) {
  return {
    id: run.id,
    provider: run.provider,
    mode: run.mode,
    status: run.status,
    applicationState: application.state,
    screenshots: run.screenshots,
    liveViewUrl: run.liveViewUrl,
    runUrl: run.runUrl,
    recordingUrl: run.recordingUrl,
    currentAction: run.currentAction,
    stepCount: run.stepCount,
    error: run.error,
    errorCode: run.errorCode,
    requiresHumanInput: run.requiresHumanInput,
    humanInputReason: run.humanInputReason,
    submissionEvidence: run.submissionEvidence,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function normalizeWebhookStatus(status: string): BrowserAgentRun["status"] {
  if (status === "completed") return "completed";
  if (status === "canceled" || status === "cancelled" || status === "terminated") return "cancelled";
  if (status === "running") return "running";
  if (status === "queued" || status === "created") return "queued";
  return "failed";
}

function isFillReadyForReview(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  return (result as { ready_for_review?: unknown }).ready_for_review === true;
}

async function writeAudit(
  workspaceId: string,
  action: string,
  applicationId: string,
  actorUserId?: string,
  fromStatus?: string,
  toStatus?: string,
) {
  const { error } = await createSupabaseAdminClient()
    .from("audit_logs")
    .insert({
      workspace_id: workspaceId,
      actor_user_id: actorUserId ?? null,
      application_id: applicationId,
      action,
      from_status: fromStatus ?? null,
      to_status: toStatus ?? null,
      metadata: {},
    });
  if (error) console.error("application_agent_audit_failed", { action, applicationId, code: error.code });
}

async function assertWorkspaceCapacity(workspaceId: string) {
  const db = createSupabaseAdminClient();
  const [{ count: active, error: activeError }, { count: recent, error: recentError }] = await Promise.all([
    db
      .from("browser_agent_runs")
      .select("id", { head: true, count: "exact" })
      .eq("workspace_id", workspaceId)
      .in("status", ["queued", "running"]),
    db
      .from("browser_agent_runs")
      .select("id", { head: true, count: "exact" })
      .eq("workspace_id", workspaceId)
      .gte("created_at", new Date(Date.now() - 60_000).toISOString()),
  ]);
  if (activeError || recentError)
    throw new ApiError(503, "Automation capacity could not be checked", "capacity_unavailable");
  if ((active ?? 0) >= 2 || (recent ?? 0) >= 5)
    throw new ApiError(429, "Too many browser runs are in progress. Try again shortly.", "agent_rate_limited");
}
