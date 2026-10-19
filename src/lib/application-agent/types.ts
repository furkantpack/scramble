export const applicationAutomationStates = [
  "PREPARE",
  "READY_TO_FILL",
  "AGENT_FILLING",
  "AGENT_FILLED_PENDING_FINAL_APPROVAL",
  "SUBMITTING",
  "SUBMITTED",
  "SUBMISSION_UNVERIFIED",
  "FAILED",
] as const;

export type ApplicationAutomationState = (typeof applicationAutomationStates)[number];
export type BrowserAgentMode = "fill" | "submit";
export type BrowserAgentStatus = "queued" | "running" | "human_input_required" | "completed" | "failed" | "cancelled";
export type HumanInputReason =
  | "login"
  | "otp"
  | "captcha"
  | "missing_answer"
  | "unsupported_field"
  | "unapproved_declaration"
  | "unknown";

export type ApprovedAnswer = {
  question: string;
  value: string;
  fieldType?: string;
  required?: boolean;
  approved: boolean;
};

export type ApprovedFile = {
  label: string;
  urlOrPath: string;
  approved: boolean;
};

export type SubmissionEvidence = {
  confirmationText?: string;
  screenshotUrls?: string[];
  finalUrl?: string;
  completedAt?: string;
  confirmed: boolean;
};

export type BrowserAgentRun = {
  id: string;
  provider: "skyvern" | "mock";
  externalRunId: string;
  browserSessionId?: string;
  liveViewUrl?: string;
  runUrl?: string;
  recordingUrl?: string;
  currentAction?: string;
  stepCount?: number;
  mode: BrowserAgentMode;
  status: BrowserAgentStatus;
  applicationId: string;
  screenshots?: string[];
  result?: unknown;
  error?: string;
  errorCode?: string;
  requiresHumanInput?: boolean;
  humanInputReason?: HumanInputReason;
  submissionEvidence?: SubmissionEvidence;
  createdAt: string;
  updatedAt?: string;
};

export type FillApplicationInput = {
  applicationId: string;
  formUrl: string;
  programName?: string;
  programContext?: string;
  confirmedProfile?: Record<string, string>;
  answers: Array<Pick<ApprovedAnswer, "question" | "value" | "fieldType">>;
  files?: Array<Pick<ApprovedFile, "label" | "urlOrPath">>;
  webhookUrl?: string;
};

export type SubmitApplicationInput = {
  applicationId: string;
  previousRunId?: string;
  browserSessionId?: string;
  webhookUrl?: string;
};

export interface BrowserAgentProvider {
  readonly name: "skyvern" | "mock";
  startFill(input: FillApplicationInput): Promise<BrowserAgentRun>;
  submit(input: SubmitApplicationInput): Promise<BrowserAgentRun>;
  getRun(run: BrowserAgentRun): Promise<BrowserAgentRun>;
}

export type ApplicationAutomationRecord = {
  id: string;
  workspaceId: string;
  companyId?: string;
  formUrl: string;
  state: ApplicationAutomationState;
  version: number;
  answers: ApprovedAnswer[];
  files: ApprovedFile[];
  fillRunId?: string;
  submitRunId?: string;
  submittedBy?: string;
  submissionEvidence?: SubmissionEvidence;
  createdAt: string;
  updatedAt: string;
};
