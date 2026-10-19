import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json, Tables } from "@/types/database";

import type { ApplicationAutomationRecord, BrowserAgentRun } from "./types";
import { randomUUID } from "node:crypto";

export interface ApplicationAgentRepository {
  getOwnedApplication(applicationId: string, workspaceId: string): Promise<ApplicationAutomationRecord | null>;
  getApplicationByRunId(runId: string): Promise<ApplicationAutomationRecord | null>;
  saveApplication(application: ApplicationAutomationRecord): Promise<void>;
  getRun(runId: string): Promise<BrowserAgentRun | null>;
  getRunByExternalId(externalRunId: string): Promise<BrowserAgentRun | null>;
  getRunByIdempotencyKey(key: string): Promise<BrowserAgentRun | null>;
  claimRun(run: BrowserAgentRun, idempotencyKey: string): Promise<{ claimed: boolean; run: BrowserAgentRun }>;
  saveRun(run: BrowserAgentRun, idempotencyKey?: string): Promise<void>;
}

type Store = {
  applications: Map<string, ApplicationAutomationRecord>;
  runs: Map<string, BrowserAgentRun>;
  externalRuns: Map<string, string>;
  idempotency: Map<string, string>;
};

const storeKey = Symbol.for("accelerator-pilot.application-agent.repository");
const root = globalThis as typeof globalThis & { [storeKey]?: Store };
if (!root[storeKey]) {
  root[storeKey] = {
    applications: new Map(),
    runs: new Map(),
    externalRuns: new Map(),
    idempotency: new Map(),
  };
}
const store = root[storeKey];

const knownApplicationIds = new Set(["yc", "techstars", "antler", "aws", "eic", "pearx"]);

class MemoryApplicationAgentRepository implements ApplicationAgentRepository {
  async getOwnedApplication(applicationId: string, workspaceId: string) {
    const storageKey = applicationStorageKey(applicationId, workspaceId);
    const current = store.applications.get(storageKey);
    if (current) return structuredClone(current);
    if (!knownApplicationIds.has(applicationId)) return null;

    const now = new Date().toISOString();
    const application: ApplicationAutomationRecord = {
      id: applicationId,
      workspaceId,
      formUrl: "",
      state: "PREPARE",
      version: 1,
      answers: [],
      files: [],
      createdAt: now,
      updatedAt: now,
    };
    store.applications.set(storageKey, application);
    return structuredClone(application);
  }

  async saveApplication(application: ApplicationAutomationRecord) {
    store.applications.set(
      applicationStorageKey(application.id, application.workspaceId),
      structuredClone({ ...application, updatedAt: new Date().toISOString() }),
    );
  }

  async getApplicationByRunId(runId: string) {
    const application = [...store.applications.values()].find(
      (candidate) => candidate.fillRunId === runId || candidate.submitRunId === runId,
    );
    return application ? structuredClone(application) : null;
  }

  async getRun(runId: string) {
    const run = store.runs.get(runId);
    return run ? structuredClone(run) : null;
  }

  async getRunByExternalId(externalRunId: string) {
    const runId = store.externalRuns.get(externalRunId);
    return runId ? this.getRun(runId) : null;
  }

  async getRunByIdempotencyKey(key: string) {
    const runId = store.idempotency.get(key);
    return runId ? this.getRun(runId) : null;
  }

  async claimRun(run: BrowserAgentRun, idempotencyKey: string) {
    const existingId = store.idempotency.get(idempotencyKey);
    const existing = existingId ? store.runs.get(existingId) : undefined;
    if (existing) return { claimed: false, run: structuredClone(existing) };
    store.runs.set(run.id, structuredClone(run));
    store.externalRuns.set(run.externalRunId, run.id);
    store.idempotency.set(idempotencyKey, run.id);
    return { claimed: true, run: structuredClone(run) };
  }

  async saveRun(run: BrowserAgentRun, idempotencyKey?: string) {
    store.runs.set(run.id, structuredClone(run));
    store.externalRuns.set(run.externalRunId, run.id);
    if (idempotencyKey) store.idempotency.set(idempotencyKey, run.id);
  }
}

class SupabaseApplicationAgentRepository implements ApplicationAgentRepository {
  private readonly supabase = createSupabaseAdminClient();

  async getOwnedApplication(applicationId: string, workspaceId: string) {
    const { data } = await this.supabase
      .from("accelerator_applications")
      .select("*")
      .eq("id", applicationId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    return data ? this.hydrateApplication(data) : null;
  }

  async getApplicationByRunId(runId: string) {
    const { data: run } = await this.supabase
      .from("browser_agent_runs")
      .select("application_id,workspace_id")
      .eq("id", runId)
      .maybeSingle();
    return run ? this.getOwnedApplication(run.application_id, run.workspace_id) : null;
  }

  async saveApplication(application: ApplicationAutomationRecord) {
    const status = databaseStatus(application.state);
    const { error } = await this.supabase
      .from("accelerator_applications")
      .update({
        form_url: application.formUrl,
        status,
        submitted_at: status === "submitted" ? new Date().toISOString() : undefined,
        submission_confirmation:
          status === "submitted"
            ? (application.submissionEvidence?.confirmationText ?? application.submissionEvidence?.finalUrl ?? null)
            : undefined,
        status_error:
          status === "submission_unverified"
            ? "Final submission could not be verified. Do not retry until the program portal is checked."
            : status === "failed"
              ? "Browser agent operation failed"
              : null,
      })
      .eq("id", application.id)
      .eq("workspace_id", application.workspaceId);
    if (error) throw error;
  }

  async getRun(runId: string) {
    const { data } = await this.supabase.from("browser_agent_runs").select("*").eq("id", runId).maybeSingle();
    return data ? fromRunRow(data) : null;
  }

  async getRunByExternalId(externalRunId: string) {
    const { data } = await this.supabase
      .from("browser_agent_runs")
      .select("*")
      .eq("external_run_id", externalRunId)
      .maybeSingle();
    return data ? fromRunRow(data) : null;
  }

  async getRunByIdempotencyKey(key: string) {
    const { data } = await this.supabase
      .from("browser_agent_runs")
      .select("*")
      .eq("idempotency_key", key)
      .maybeSingle();
    return data ? fromRunRow(data) : null;
  }

  async claimRun(run: BrowserAgentRun, idempotencyKey: string) {
    const application = await this.applicationIdentity(run.applicationId);
    const { data, error } = await this.supabase
      .from("browser_agent_runs")
      .insert(toRunInsert(run, application.workspace_id, idempotencyKey))
      .select("*")
      .single();
    if (!error && data) return { claimed: true, run: fromRunRow(data) };
    const existing = await this.getRunByIdempotencyKey(idempotencyKey);
    if (existing) return { claimed: false, run: existing };
    throw error;
  }

  async saveRun(run: BrowserAgentRun, idempotencyKey?: string) {
    const application = await this.applicationIdentity(run.applicationId);
    const current = await this.getRun(run.id);
    const key = idempotencyKey ?? (await this.runIdempotencyKey(run.id));
    const { error } = await this.supabase
      .from("browser_agent_runs")
      .upsert(toRunInsert(run, application.workspace_id, key ?? `${run.mode}:${run.id}`), { onConflict: "id" });
    if (error) throw error;

    const urls = run.submissionEvidence?.screenshotUrls ?? run.screenshots ?? [];
    if (urls.length > 0 && current?.status !== run.status) {
      await this.supabase.from("browser_agent_artifacts").insert(
        urls.map((externalUrl) => ({
          workspace_id: application.workspace_id,
          run_id: run.id,
          type: run.mode === "submit" ? ("confirmation" as const) : ("screenshot" as const),
          external_url: externalUrl,
          metadata: {},
        })),
      );
    }
  }

  private async hydrateApplication(row: Tables<"accelerator_applications">): Promise<ApplicationAutomationRecord> {
    const [{ data: questions }, { data: answers }, { data: assets }, { data: runs }] = await Promise.all([
      this.supabase.from("application_questions").select("*").eq("application_id", row.id).order("order_index"),
      this.supabase.from("application_answers").select("*").eq("application_id", row.id),
      this.supabase.from("company_assets").select("*").eq("company_id", row.company_id),
      this.supabase
        .from("browser_agent_runs")
        .select("id,mode")
        .eq("application_id", row.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    const answerByQuestion = new Map((answers ?? []).map((answer) => [answer.question_id, answer]));
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      companyId: row.company_id,
      formUrl: row.form_url,
      state: automationState(row.status),
      version: Math.max(1, ...(answers ?? []).map(() => 1)),
      answers: (questions ?? []).map((question) => {
        const answer = answerByQuestion.get(question.id);
        return {
          question: question.question_label,
          value: answer?.answer_text ?? "",
          fieldType: question.field_type,
          required: question.required,
          approved: answer?.status === "approved",
        };
      }),
      files: (assets ?? []).map((asset) => ({
        label: asset.file_name ?? asset.type,
        urlOrPath: asset.storage_path,
        approved: true,
      })),
      fillRunId: runs?.find((run) => run.mode === "fill")?.id,
      submitRunId: runs?.find((run) => run.mode === "submit")?.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async applicationIdentity(id: string) {
    const { data, error } = await this.supabase
      .from("accelerator_applications")
      .select("workspace_id")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  }

  private async runIdempotencyKey(id: string) {
    const { data } = await this.supabase
      .from("browser_agent_runs")
      .select("idempotency_key")
      .eq("id", id)
      .maybeSingle();
    return data?.idempotency_key;
  }
}

function applicationStorageKey(applicationId: string, workspaceId: string) {
  return `${workspaceId}:${applicationId}`;
}

export const applicationAgentRepository: ApplicationAgentRepository = new MemoryApplicationAgentRepository();

let databaseRepository: ApplicationAgentRepository | undefined;
export function getApplicationAgentRepository() {
  if (process.env.APPLICATION_AGENT_REPOSITORY === "memory" || process.env.NODE_ENV === "test") {
    return applicationAgentRepository;
  }
  databaseRepository ??= new SupabaseApplicationAgentRepository();
  return databaseRepository;
}

export function createPendingRun(applicationId: string, mode: BrowserAgentRun["mode"]): BrowserAgentRun {
  const id = randomUUID();
  return {
    id,
    provider: "mock",
    externalRunId: `pending:${id}`,
    applicationId,
    mode,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
}

function databaseStatus(state: ApplicationAutomationRecord["state"]): Tables<"accelerator_applications">["status"] {
  return {
    PREPARE: "draft",
    READY_TO_FILL: "answers_approved",
    AGENT_FILLING: "agent_filling",
    AGENT_FILLED_PENDING_FINAL_APPROVAL: "agent_filled_pending_final_approval",
    SUBMITTING: "submitting",
    SUBMITTED: "submitted",
    SUBMISSION_UNVERIFIED: "submission_unverified",
    FAILED: "failed",
  }[state] as Tables<"accelerator_applications">["status"];
}

function automationState(status: Tables<"accelerator_applications">["status"]): ApplicationAutomationRecord["state"] {
  if (status === "agent_filling") return "AGENT_FILLING";
  if (status === "agent_filled_pending_final_approval") return "AGENT_FILLED_PENDING_FINAL_APPROVAL";
  if (status === "submitting") return "SUBMITTING";
  if (status === "submitted") return "SUBMITTED";
  if (status === "submission_unverified") return "SUBMISSION_UNVERIFIED";
  if (status === "failed") return "FAILED";
  if (status === "answers_approved") return "READY_TO_FILL";
  return "PREPARE";
}

function toRunInsert(run: BrowserAgentRun, workspaceId: string, idempotencyKey: string) {
  return {
    id: run.id,
    workspace_id: workspaceId,
    application_id: run.applicationId,
    provider: run.provider,
    external_run_id: run.externalRunId,
    mode: run.mode,
    status: run.requiresHumanInput ? ("human_input_required" as const) : run.status,
    requires_human_input: Boolean(run.requiresHumanInput),
    human_input_reason: run.humanInputReason ?? null,
    result_summary: {
      result:
        run.mode === "fill"
          ? { ready_for_review: isReadyForReview(run.result) }
          : { submitted: run.submissionEvidence?.confirmed === true },
      submissionEvidence: run.submissionEvidence,
    } as Json,
    raw_response: {
      browserSessionId: run.browserSessionId,
      liveViewUrl: run.liveViewUrl,
      runUrl: run.runUrl,
      recordingUrl: run.recordingUrl,
      currentAction: run.currentAction,
      stepCount: run.stepCount,
      screenshots: run.screenshots,
    } as Json,
    error_code: run.errorCode ?? null,
    error_message: run.error ?? null,
    idempotency_key: idempotencyKey,
    started_at: run.createdAt,
    completed_at: ["completed", "failed", "cancelled"].includes(run.status)
      ? (run.updatedAt ?? new Date().toISOString())
      : null,
    updated_at: run.updatedAt ?? new Date().toISOString(),
  };
}

function isReadyForReview(result: unknown) {
  return Boolean(
    result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      (result as { ready_for_review?: unknown }).ready_for_review === true,
  );
}

function fromRunRow(row: Tables<"browser_agent_runs">): BrowserAgentRun {
  const summary =
    row.result_summary && typeof row.result_summary === "object" && !Array.isArray(row.result_summary)
      ? row.result_summary
      : {};
  const raw =
    row.raw_response && typeof row.raw_response === "object" && !Array.isArray(row.raw_response)
      ? row.raw_response
      : {};
  return {
    id: row.id,
    provider: row.provider,
    externalRunId: row.external_run_id ?? `pending:${row.id}`,
    browserSessionId: typeof raw.browserSessionId === "string" ? raw.browserSessionId : undefined,
    liveViewUrl: typeof raw.liveViewUrl === "string" ? raw.liveViewUrl : undefined,
    runUrl: typeof raw.runUrl === "string" ? raw.runUrl : undefined,
    recordingUrl: typeof raw.recordingUrl === "string" ? raw.recordingUrl : undefined,
    currentAction: typeof raw.currentAction === "string" ? raw.currentAction : undefined,
    stepCount: typeof raw.stepCount === "number" ? raw.stepCount : undefined,
    applicationId: row.application_id,
    mode: row.mode,
    status: row.status,
    requiresHumanInput: row.requires_human_input,
    humanInputReason: (row.human_input_reason as BrowserAgentRun["humanInputReason"]) ?? undefined,
    result: summary.result,
    submissionEvidence: summary.submissionEvidence as BrowserAgentRun["submissionEvidence"],
    screenshots: Array.isArray(raw.screenshots)
      ? raw.screenshots.filter((value): value is string => typeof value === "string")
      : undefined,
    errorCode: row.error_code ?? undefined,
    error: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
