import { z } from "zod";

export const extractedQuestionSchema = z.object({
  label: z.string().trim().min(1).max(500),
  fieldType: z.enum([
    "text",
    "textarea",
    "email",
    "url",
    "number",
    "date",
    "select",
    "radio",
    "checkbox",
    "file",
    "other",
  ]),
  selectorHint: z.string().trim().max(1_000).nullable().default(null),
  required: z.boolean(),
  maxWords: z.number().int().positive().max(10_000).nullable().default(null),
  maxCharacters: z.number().int().positive().max(100_000).nullable().default(null),
  options: z.array(z.string().trim().min(1).max(500)).max(200).default([]),
  sectionName: z.string().trim().max(300).nullable().default(null),
  externalFieldId: z.string().trim().max(500).nullable().default(null),
  evidence: z.object({
    pageUrl: z.url(),
    pageTitle: z.string().trim().max(500).nullable().default(null),
    labelText: z.string().trim().min(1).max(1_000),
    controlType: z.string().trim().min(1).max(100),
    selector: z.string().trim().max(1_000).nullable().default(null),
    step: z.string().trim().max(300).nullable().default(null),
  }),
});

export const applicationQuestionDiscoverySchema = z.object({
  completedInspection: z.boolean(),
  observedApplicationForm: z.boolean(),
  visitedUrls: z.array(z.url()).min(1).max(50),
  blockers: z.array(z.enum(["login", "otp", "captcha", "access_denied", "unsupported_navigation", "unknown"])).max(20),
  questions: z.array(extractedQuestionSchema).max(300),
  verifiedNoQuestions: z.boolean(),
  noQuestionsReason: z.string().trim().min(1).max(1_000).nullable().default(null),
});

export type ExtractedApplicationQuestion = z.infer<typeof extractedQuestionSchema>;
export type ApplicationQuestionDiscovery = z.infer<typeof applicationQuestionDiscoverySchema>;

export class ApplicationQuestionExtractionError extends Error {
  constructor(
    public readonly code: string,
    message = "Application questions could not be verified",
  ) {
    super(message);
    this.name = "ApplicationQuestionExtractionError";
  }
}

export function validateCompletedDiscovery(value: unknown): ApplicationQuestionDiscovery {
  const parsed = applicationQuestionDiscoverySchema.safeParse(value);
  if (!parsed.success) throw new ApplicationQuestionExtractionError("QUESTION_EXTRACTION_INVALID");
  const result = parsed.data;
  if (result.blockers.length > 0) {
    throw new ApplicationQuestionExtractionError(discoveryBlockerCode(result.blockers));
  }
  if (!result.completedInspection || !result.observedApplicationForm) {
    throw new ApplicationQuestionExtractionError("QUESTION_EXTRACTION_INCOMPLETE");
  }
  if (result.questions.length > 0) {
    if (result.verifiedNoQuestions) throw new ApplicationQuestionExtractionError("QUESTION_EXTRACTION_CONTRADICTORY");
    return result;
  }
  if (!result.verifiedNoQuestions || !result.observedApplicationForm || !result.noQuestionsReason) {
    throw new ApplicationQuestionExtractionError("QUESTION_EXTRACTION_EMPTY_UNVERIFIED");
  }
  return result;
}

function discoveryBlockerCode(blockers: ApplicationQuestionDiscovery["blockers"]) {
  const priority: ApplicationQuestionDiscovery["blockers"][number][] = [
    "login",
    "otp",
    "captcha",
    "access_denied",
    "unsupported_navigation",
    "unknown",
  ];
  const blocker = priority.find((candidate) => blockers.includes(candidate)) ?? "unknown";
  return `QUESTION_EXTRACTION_${blocker.toUpperCase()}`;
}

export type ExtractionAuditMetadata = {
  outcome?: unknown;
  questionCount?: unknown;
  verifiedNoQuestions?: unknown;
  extractionId?: unknown;
};

const readyStatuses = new Set([
  "form_questions_ready",
  "answers_generating",
  "answers_review_pending",
  "answers_approved",
  "agent_filling",
  "agent_filled_pending_final_approval",
]);

export function questionExtractionIsReady(input: {
  applicationStatus: string;
  questionCount: number;
  auditMetadata: ExtractionAuditMetadata | null;
}) {
  if (!readyStatuses.has(input.applicationStatus) || !input.auditMetadata) return false;
  const count = input.auditMetadata.questionCount;
  if (!Number.isInteger(count) || count !== input.questionCount || typeof input.auditMetadata.extractionId !== "string")
    return false;
  if (input.questionCount > 0) return input.auditMetadata.outcome === "questions";
  return input.auditMetadata.outcome === "verified_no_questions" && input.auditMetadata.verifiedNoQuestions === true;
}
