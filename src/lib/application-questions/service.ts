import "server-only";

import type { ApiActor } from "@/lib/signal-engine/auth";
import { ApiError } from "@/lib/signal-engine/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

import { assertSafePublicHttpUrl } from "../application-agent/url-safety";
import { type ApplicationQuestionDiscoveryProvider, firecrawlApplicationQuestionProvider } from "./firecrawl-provider";
import { ApplicationQuestionExtractionError, type ExtractionAuditMetadata, questionExtractionIsReady } from "./model";
import { createHash, randomUUID } from "node:crypto";

type AdminDb = ReturnType<typeof createSupabaseAdminClient>;

export async function applicationQuestionReadiness(db: AdminDb, actor: ApiActor, applicationId: string) {
  const [applicationResult, questionsResult, auditResult] = await Promise.all([
    db
      .from("accelerator_applications")
      .select("status,status_error,updated_at")
      .eq("id", applicationId)
      .eq("workspace_id", actor.workspaceId)
      .eq("company_id", actor.companyId)
      .maybeSingle(),
    db
      .from("application_questions")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", actor.workspaceId)
      .eq("application_id", applicationId),
    db
      .from("audit_logs")
      .select("metadata")
      .eq("workspace_id", actor.workspaceId)
      .eq("application_id", applicationId)
      .eq("action", "application_questions_extracted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const { data: application, error: applicationError } = applicationResult;
  const { count: questionCount, error: questionsError } = questionsResult;
  const { data: audit, error: auditError } = auditResult;
  if (applicationError || questionsError || auditError)
    throw new ApiError(503, "Application question readiness could not be verified", "question_readiness_unavailable");
  if (!application) throw new ApiError(404, "Application unavailable", "application_not_found");
  const metadata =
    audit?.metadata && typeof audit.metadata === "object" && !Array.isArray(audit.metadata)
      ? (audit.metadata as ExtractionAuditMetadata)
      : null;
  const ready = questionExtractionIsReady({
    applicationStatus: application.status,
    questionCount: questionCount ?? 0,
    auditMetadata: metadata,
  });
  const failureCode = application.status === "failed" ? application.status_error?.match(/\(([^)]+)\)/)?.[1] : undefined;
  return {
    ready,
    questionCount: questionCount ?? 0,
    verifiedNoQuestions: metadata?.outcome === "verified_no_questions" && metadata.verifiedNoQuestions === true,
    phase: ready
      ? ("ready" as const)
      : application.status === "form_questions_extracting"
        ? ("discovering" as const)
        : failureCode
          ? ("failed" as const)
          : ("idle" as const),
    errorCode: failureCode,
    error: failureCode ? publicExtractionFailure(failureCode).message : undefined,
    updatedAt: application.updated_at,
  };
}

export async function requireApplicationQuestionReadiness(db: AdminDb, actor: ApiActor, applicationId: string) {
  const readiness = await applicationQuestionReadiness(db, actor, applicationId);
  if (!readiness.ready) {
    throw new ApiError(409, "Application questions have not been successfully extracted", "questions_not_extracted");
  }
  return readiness;
}

export async function discoverAndPersistApplicationQuestions(
  actor: ApiActor,
  applicationId: string,
  provider: ApplicationQuestionDiscoveryProvider = firecrawlApplicationQuestionProvider,
) {
  const db = createSupabaseAdminClient();
  const existing = await applicationQuestionReadiness(db, actor, applicationId);
  if (existing.ready) return existing;

  const { data: application, error: applicationError } = await db
    .from("accelerator_applications")
    .select("id,form_url,status,accelerator_program_id")
    .eq("id", applicationId)
    .eq("workspace_id", actor.workspaceId)
    .eq("company_id", actor.companyId)
    .maybeSingle();
  if (applicationError || !application) throw new ApiError(404, "Application unavailable", "application_not_found");
  if (!application.accelerator_program_id)
    throw new ApiError(409, "The official application URL is unavailable", "application_url_missing");
  const { data: program, error: programError } = await db
    .from("accelerator_programs")
    .select("application_url")
    .eq("id", application.accelerator_program_id)
    .maybeSingle();
  if (programError || !program?.application_url)
    throw new ApiError(409, "The official application URL is unavailable", "application_url_missing");
  const formUrl = await assertSafePublicHttpUrl(program.application_url, "Official application URL");
  const { count: answerCount, error: answerError } = await db
    .from("application_answers")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", actor.workspaceId)
    .eq("application_id", applicationId);
  if (answerError)
    throw new ApiError(503, "Application answers could not be checked", "question_extraction_unavailable");
  if ((answerCount ?? 0) > 0)
    throw new ApiError(409, "Questions cannot be replaced after answers exist", "questions_already_answered");

  const { data: claimed } = await db
    .from("accelerator_applications")
    .update({ status: "form_questions_extracting", status_error: null })
    .eq("id", applicationId)
    .eq("workspace_id", actor.workspaceId)
    .eq("company_id", actor.companyId)
    .in("status", [
      "draft",
      "product_analyzing",
      "product_ready",
      "kb_approved",
      "form_questions_ready",
      "answers_generating",
      "answers_review_pending",
      "answers_approved",
      "failed",
    ])
    .select("id")
    .maybeSingle();
  if (!claimed) throw new ApiError(409, "Question extraction is already running", "question_extraction_in_progress");

  const extractionId = randomUUID();
  try {
    const result = await provider.discover(formUrl);
    const completedAt = new Date().toISOString();
    const sourceHash = createHash("sha256")
      .update(
        JSON.stringify({
          visitedUrls: result.visitedUrls,
          questions: result.questions.map((question) => ({ label: question.label, evidence: question.evidence })),
          verifiedNoQuestions: result.verifiedNoQuestions,
        }),
      )
      .digest("hex");
    const { error: deleteError } = await db
      .from("application_questions")
      .delete()
      .eq("workspace_id", actor.workspaceId)
      .eq("application_id", applicationId);
    if (deleteError) throw new ApplicationQuestionExtractionError("QUESTION_PERSISTENCE_FAILED");
    if (result.questions.length > 0) {
      const { error: insertError } = await db.from("application_questions").insert(
        result.questions.map((question, index) => ({
          workspace_id: actor.workspaceId,
          application_id: applicationId,
          question_label: question.label,
          field_type: question.fieldType,
          field_selector_hint: question.selectorHint,
          required: question.required,
          max_words: question.maxWords,
          max_characters: question.maxCharacters,
          options: question.options as Json,
          constraints: {
            extractionId,
            source: "firecrawl_interact",
            sourceUrl: formUrl,
            sourceHash,
            completedAt,
            evidence: question.evidence,
          } as Json,
          section_name: question.sectionName,
          order_index: index,
          external_field_id: question.externalFieldId,
        })),
      );
      if (insertError) throw new ApplicationQuestionExtractionError("QUESTION_PERSISTENCE_FAILED");
    }
    const outcome = result.questions.length > 0 ? "questions" : "verified_no_questions";
    const metadata = {
      extractionId,
      outcome,
      questionCount: result.questions.length,
      verifiedNoQuestions: result.verifiedNoQuestions,
      noQuestionsReason: result.noQuestionsReason,
      sourceUrl: formUrl,
      sourceHash,
      visitedUrls: result.visitedUrls,
      completedAt,
    } as Json;
    const { error: auditError } = await db.from("audit_logs").insert({
      workspace_id: actor.workspaceId,
      actor_user_id: actor.authUserId,
      application_id: applicationId,
      action: "application_questions_extracted",
      from_status: application.status,
      to_status: "form_questions_ready",
      metadata,
    });
    if (auditError) throw new ApplicationQuestionExtractionError("QUESTION_EVIDENCE_PERSISTENCE_FAILED");
    const { error: readyError } = await db
      .from("accelerator_applications")
      .update({ status: "form_questions_ready", status_error: null })
      .eq("id", applicationId)
      .eq("workspace_id", actor.workspaceId)
      .eq("company_id", actor.companyId)
      .eq("status", "form_questions_extracting");
    if (readyError) throw new ApplicationQuestionExtractionError("QUESTION_PERSISTENCE_FAILED");
    return {
      ready: true,
      questionCount: result.questions.length,
      verifiedNoQuestions: result.verifiedNoQuestions,
      phase: "ready" as const,
      updatedAt: completedAt,
    };
  } catch (error) {
    const code = error instanceof ApplicationQuestionExtractionError ? error.code : "QUESTION_EXTRACTION_FAILED";
    await db
      .from("accelerator_applications")
      .update({
        status: "failed",
        status_error: `Application question extraction failed (${code})`,
      })
      .eq("id", applicationId)
      .eq("workspace_id", actor.workspaceId)
      .eq("company_id", actor.companyId);
    await db.from("audit_logs").insert({
      workspace_id: actor.workspaceId,
      actor_user_id: actor.authUserId,
      application_id: applicationId,
      action: "application_question_extraction_failed",
      from_status: "form_questions_extracting",
      to_status: "failed",
      metadata: { extractionId, code },
    });
    const failure = publicExtractionFailure(code);
    throw new ApiError(failure.status, failure.message, code);
  }
}

export function publicExtractionFailure(code: string) {
  const failures: Record<string, { status: number; message: string }> = {
    QUESTION_EXTRACTION_LOGIN: {
      status: 409,
      message: "This application requires a login before Scramble can inspect its questions.",
    },
    QUESTION_EXTRACTION_OTP: {
      status: 409,
      message: "This application requires a one-time code before Scramble can inspect its questions.",
    },
    QUESTION_EXTRACTION_CAPTCHA: {
      status: 409,
      message: "A CAPTCHA blocked form discovery. Open the official form and complete the challenge manually.",
    },
    QUESTION_EXTRACTION_ACCESS_DENIED: {
      status: 409,
      message: "The application site denied automated form discovery.",
    },
    QUESTION_EXTRACTION_UNSUPPORTED_NAVIGATION: {
      status: 409,
      message: "Scramble could not safely inspect every step of this application form.",
    },
    FIRECRAWL_AUTH_ERROR: {
      status: 503,
      message: "Form discovery is not configured correctly. Ask an administrator to check Firecrawl.",
    },
    FIRECRAWL_RATE_LIMIT: {
      status: 503,
      message: "Form discovery is temporarily rate limited. Try again shortly.",
    },
    FIRECRAWL_TIMEOUT: {
      status: 504,
      message: "Form discovery timed out before the complete form could be verified.",
    },
  };
  return (
    failures[code] ?? {
      status: 502,
      message: "Scramble could not verify the complete application form. No browser run was started.",
    }
  );
}
