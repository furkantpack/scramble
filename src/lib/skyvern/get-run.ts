import "server-only";

import type { SkyvernApi } from "@skyvern/client";

import type {
  BrowserAgentRun,
  BrowserAgentStatus,
  HumanInputReason,
  SubmissionEvidence,
} from "@/lib/application-agent/types";

import { getSkyvernClient } from "./client";
import { normalizeSkyvernError } from "./errors";
import type { SkyvernTaskOutput, SkyvernWebhookPayload } from "./types";

export async function getSkyvernRun(run: BrowserAgentRun) {
  try {
    const client = getSkyvernClient();
    const response = await client.getRun(run.externalRunId, { timeoutInSeconds: 30, maxRetries: 1 });
    const session =
      run.browserSessionId && !run.liveViewUrl
        ? await client
            .getBrowserSession(run.browserSessionId, { timeoutInSeconds: 15, maxRetries: 0 })
            .catch(() => undefined)
        : undefined;
    return normalizeSkyvernRun(response, run, session);
  } catch (error) {
    throw normalizeSkyvernError(error);
  }
}

export function normalizeSkyvernRun(
  response: SkyvernApi.GetRunResponse | SkyvernWebhookPayload,
  current: BrowserAgentRun,
  session?: { app_url?: string | null },
): BrowserAgentRun {
  const output = response.output;
  const status = normalizeStatus(response.status);
  const errorText = response.failure_reason ?? undefined;
  const humanInputReason = inferHumanInputReason(output, errorText, response.errors);
  return {
    ...current,
    provider: "skyvern",
    externalRunId: response.run_id,
    browserSessionId: response.browser_session_id ?? current.browserSessionId,
    liveViewUrl: safeProviderUrl(session?.app_url) ?? current.liveViewUrl,
    runUrl: safeProviderUrl("app_url" in response ? response.app_url : undefined) ?? current.runUrl,
    recordingUrl:
      safeProviderUrl("recording_url" in response ? response.recording_url : undefined) ?? current.recordingUrl,
    currentAction: currentAction(status, "step_count" in response ? (response.step_count ?? undefined) : undefined),
    stepCount: "step_count" in response ? (response.step_count ?? undefined) : current.stepCount,
    status,
    screenshots: response.screenshot_urls ?? current.screenshots,
    result: output,
    error: status === "failed" ? safeFailureMessage(humanInputReason) : undefined,
    errorCode: status === "failed" ? "SKYVERN_RUN_FAILED" : undefined,
    requiresHumanInput: Boolean(humanInputReason),
    humanInputReason,
    submissionEvidence: current.mode === "submit" ? submissionEvidence(response) : undefined,
    createdAt: response.created_at ?? current.createdAt,
    updatedAt: response.modified_at ?? new Date().toISOString(),
  };
}

function currentAction(status: BrowserAgentStatus, stepCount?: number) {
  const steps = typeof stepCount === "number" && stepCount > 0 ? ` · ${stepCount} browser steps` : "";
  if (status === "queued") return `Waiting for a Skyvern browser${steps}`;
  if (status === "running") return `Filling the application${steps}`;
  if (status === "human_input_required") return `Waiting for founder input${steps}`;
  if (status === "completed") return `Form ready for founder review${steps}`;
  if (status === "cancelled") return `Browser run cancelled${steps}`;
  return `Browser run stopped${steps}`;
}

function safeProviderUrl(value?: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function safeFailureMessage(reason?: HumanInputReason) {
  if (reason === "login" || reason === "otp" || reason === "captcha")
    return "The application portal needs your help to continue.";
  if (reason === "missing_answer" || reason === "unsupported_field" || reason === "unapproved_declaration")
    return "Review the application and provide the requested information before continuing.";
  return "The browser task could not be completed. Review the portal before another attempt.";
}

function normalizeStatus(status: string): BrowserAgentStatus {
  if (status === "created" || status === "queued") return "queued";
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "canceled" || status === "cancelled" || status === "terminated") return "cancelled";
  return "failed";
}

function inferHumanInputReason(output: unknown, error?: string, errors?: unknown[]): HumanInputReason | undefined {
  const taskOutput = asTaskOutput(output);
  const explicit = normalizeHumanReason(taskOutput?.human_input_reason);
  if (taskOutput?.requires_human_input) return explicit ?? "unknown";

  const haystack = `${error ?? ""} ${JSON.stringify(errors ?? [])}`.toLowerCase();
  if (haystack.includes("captcha")) return "captcha";
  if (haystack.includes("otp") || haystack.includes("two-factor") || haystack.includes("2fa")) return "otp";
  if (haystack.includes("login") || haystack.includes("credential")) return "login";
  if (haystack.includes("missing") && haystack.includes("answer")) return "missing_answer";
  if (haystack.includes("unsupported") && haystack.includes("field")) return "unsupported_field";
  if (haystack.includes("declaration") || haystack.includes("consent") || haystack.includes("paid commitment"))
    return "unapproved_declaration";
  return undefined;
}

function normalizeHumanReason(reason?: string): HumanInputReason | undefined {
  if (!reason) return undefined;
  if (
    ["login", "otp", "captcha", "missing_answer", "unsupported_field", "unapproved_declaration", "unknown"].includes(
      reason,
    )
  ) {
    return reason as HumanInputReason;
  }
  return "unknown";
}

function submissionEvidence(response: SkyvernApi.GetRunResponse | SkyvernWebhookPayload): SubmissionEvidence {
  const output = asTaskOutput(response.output);
  const confirmationText = output?.confirmation_text?.trim();
  const finalUrl = output?.final_url?.trim();
  const screenshotUrls = response.screenshot_urls ?? undefined;
  return {
    confirmed:
      response.status === "completed" &&
      output?.submitted === true &&
      Boolean(confirmationText) &&
      Boolean(finalUrl || screenshotUrls?.length),
    confirmationText,
    finalUrl,
    screenshotUrls,
    completedAt: response.finished_at ?? undefined,
  };
}

function asTaskOutput(output: unknown): SkyvernTaskOutput | undefined {
  return output && typeof output === "object" && !Array.isArray(output) ? (output as SkyvernTaskOutput) : undefined;
}
