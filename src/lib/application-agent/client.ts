"use client";

import { signalEngineFetch } from "@/lib/supabase-browser";

export type BrowserAgentRunView = {
  id: string;
  provider: "mock" | "skyvern";
  mode: "fill" | "submit";
  status: "queued" | "running" | "human_input_required" | "completed" | "failed" | "cancelled";
  applicationState: string;
  screenshots?: string[];
  liveViewUrl?: string;
  runUrl?: string;
  recordingUrl?: string;
  currentAction?: string;
  stepCount?: number;
  error?: string;
  errorCode?: string;
  requiresHumanInput?: boolean;
  humanInputReason?: string;
  submissionEvidence?: {
    confirmed: boolean;
    confirmationText?: string;
    screenshotUrls?: string[];
    finalUrl?: string;
    completedAt?: string;
  };
};

type RunResponse = { run: BrowserAgentRunView };

export type QuestionExtractionView = {
  ready: boolean;
  questionCount: number;
  verifiedNoQuestions: boolean;
  phase: "idle" | "discovering" | "ready" | "failed";
  error?: string;
  errorCode?: string;
  updatedAt?: string;
};

export async function getApplicationQuestionStatus(applicationId: string) {
  const response = (await signalEngineFetch(
    `/api/applications/${encodeURIComponent(applicationId)}/questions/discover`,
  )) as { extraction: QuestionExtractionView };
  return response.extraction;
}

export async function discoverApplicationQuestions(applicationId: string) {
  const response = (await signalEngineFetch(
    `/api/applications/${encodeURIComponent(applicationId)}/questions/discover`,
    { method: "POST" },
  )) as { extraction: QuestionExtractionView };
  return response.extraction;
}

export async function startBrowserAgentFill(
  applicationId: string,
  input: {
    formUrl: string;
    version: number;
    files?: Array<{ label: string; approved: boolean }>;
  },
) {
  const response = (await signalEngineFetch(`/api/applications/${encodeURIComponent(applicationId)}/fill`, {
    method: "POST",
    body: JSON.stringify(input),
  })) as RunResponse;
  return response.run;
}

export async function getBrowserAgentRun(applicationId: string) {
  const response = (await signalEngineFetch(
    `/api/applications/${encodeURIComponent(applicationId)}/agent-run`,
  )) as RunResponse;
  return response.run;
}

export async function cancelQueuedBrowserAgentJob(applicationId: string) {
  return signalEngineFetch(`/api/applications/${encodeURIComponent(applicationId)}/agent-job`, { method: "DELETE" });
}

export async function submitBrowserAgentApplication(applicationId: string, previousRunId?: string) {
  const response = (await signalEngineFetch(`/api/applications/${encodeURIComponent(applicationId)}/submit`, {
    method: "POST",
    body: JSON.stringify({ confirmSubmit: true, previousRunId }),
  })) as RunResponse;
  return response.run;
}

export type AutoSubmitAuthorizationView = {
  enabled: boolean;
  authorized: boolean;
  dispatched: boolean;
  approvedFillRunId: string | null;
};

export async function getAutoSubmitAuthorization(applicationId: string) {
  return signalEngineFetch(
    `/api/applications/${encodeURIComponent(applicationId)}/auto-submit`,
  ) as Promise<AutoSubmitAuthorizationView>;
}

export async function authorizeAutoSubmit(applicationId: string, approvedFillRunId: string) {
  return signalEngineFetch(`/api/applications/${encodeURIComponent(applicationId)}/auto-submit`, {
    method: "POST",
    body: JSON.stringify({ approvedFillRunId, reviewedForm: true, confirmAuthorization: true }),
  });
}

export async function revokeAutoSubmit(applicationId: string) {
  return signalEngineFetch(`/api/applications/${encodeURIComponent(applicationId)}/auto-submit`, { method: "DELETE" });
}
