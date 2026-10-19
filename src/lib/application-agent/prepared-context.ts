import "server-only";

import { createHash } from "node:crypto";

import type { ApiActor } from "@/lib/signal-engine/auth";
import { ApiError } from "@/lib/signal-engine/http";
import { requireApplicationQuestionReadiness } from "@/lib/application-questions/service";
import { confirmedProfileSchema, PROFILE_FIELDS } from "@/lib/knowledge/unified-profile";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import type { ApprovedAnswer, ApprovedFile } from "./types";
import { assertSafePublicHttpUrl } from "./url-safety";

const fieldLabels: Record<string, string> = {
  company_name: "Company name", one_liner: "Company one-liner", product_description: "Product description",
  problem: "Problem", solution: "Solution", industry: "Industry", market_category: "Market category",
  target_customers: "Target customers", business_model: "Business model", pricing: "Pricing",
  market_opportunity: "Market opportunity", competitors: "Competitors", differentiation: "Differentiation",
  traction: "Traction", metrics: "Metrics", founders_team: "Founders and team",
  funding_stage: "Funding stage", fundraising: "Fundraising", geographic_focus: "Geographic focus",
  startup_maturity: "Startup maturity", technologies: "Technologies", other_relevant_information: "Other information",
};

export async function loadPreparedApplicationContext(
  actor: ApiActor,
  applicationId: string,
  requestedFiles: { label: string; approved: boolean }[],
) {
  const db = createSupabaseAdminClient();
  const { data: application, error: applicationError } = await db.from("accelerator_applications")
    .select("id,workspace_id,company_id,accelerator_program_id,form_url")
    .eq("id", applicationId).eq("workspace_id", actor.workspaceId).eq("company_id", actor.companyId).maybeSingle();
  if (applicationError || !application?.accelerator_program_id)
    throw new ApiError(404, "Application or program unavailable", "application_not_found");
  // This is intentionally checked on every enqueue and again by the dispatch worker.
  // A client-side empty array can never authorize a browser run.
  await requireApplicationQuestionReadiness(db, actor, applicationId);
  const [{ data: program }, { data: company }, { data: questions }, { data: answers }] = await Promise.all([
    db.from("accelerator_programs").select("name,description,application_url,application_open,deadline,required_materials,eligibility")
      .eq("id", application.accelerator_program_id).maybeSingle(),
    db.from("companies").select("canonical_profile,website_url")
      .eq("id", actor.companyId).eq("workspace_id", actor.workspaceId).maybeSingle(),
    db.from("application_questions").select("id,question_label,field_type,required,max_words,max_characters")
      .eq("workspace_id", actor.workspaceId).eq("application_id", applicationId),
    db.from("application_answers").select("question_id,answer_text,status,answer_file_path")
      .eq("workspace_id", actor.workspaceId).eq("application_id", applicationId),
  ]);
  if (!program?.application_url) throw new ApiError(409, "The official application link is unavailable", "application_url_missing");
  if (program.application_open === false || (program.deadline && Date.parse(program.deadline) < Date.now()))
    throw new ApiError(409, "This program appears to be closed", "application_closed");
  if (!company) throw new ApiError(404, "Startup unavailable", "company_not_found");
  const canonical = confirmedProfileSchema.safeParse(company.canonical_profile);
  if (!canonical.success) throw new ApiError(409, "Confirm your startup profile before filling an application", "profile_unconfirmed");
  const formUrl = await assertSafePublicHttpUrl(program.application_url, "Official application URL");
  const answerByQuestion = new Map((answers ?? []).map((answer) => [answer.question_id, answer]));
  const approvedAnswers: ApprovedAnswer[] = [];
  let requiresFile = false;
  for (const question of questions ?? []) {
    const answer = answerByQuestion.get(question.id);
    if (question.field_type.toLowerCase().includes("file")) {
      if (question.required && !/pitch|deck/i.test(question.question_label))
        throw new ApiError(409, `Upload and approve the required document: ${question.question_label}`, "unsupported_document");
      if (question.required) requiresFile = true;
      continue;
    }
    const value = answer?.answer_text?.trim() ?? "";
    if (question.required && (!value || answer?.status !== "approved"))
      throw new ApiError(409, `Approve the required answer: ${question.question_label}`, "answers_need_approval");
    if (answer?.status !== "approved" || !value) continue;
    if (question.max_characters && value.length > question.max_characters)
      throw new ApiError(409, `Shorten the answer: ${question.question_label}`, "answer_too_long");
    if (question.max_words && value.split(/\s+/).length > question.max_words)
      throw new ApiError(409, `Shorten the answer: ${question.question_label}`, "answer_too_long");
    approvedAnswers.push({ question: question.question_label, value, fieldType: question.field_type, approved: true, required: question.required });
  }
  const wantsDeck = requestedFiles.some((file) => file.label === "Pitch deck" && file.approved);
  if (requiresFile && !wantsDeck)
    throw new ApiError(409, "Confirm the required pitch deck before filling", "document_approval_required");
  const files: ApprovedFile[] = [];
  if (wantsDeck) {
    const { data: asset } = await db.from("company_assets")
      .select("storage_path,file_name,mime_type")
      .eq("workspace_id", actor.workspaceId).eq("company_id", actor.companyId).eq("type", "pitch_deck")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!asset || asset.mime_type !== "application/pdf" ||
      !asset.storage_path.startsWith(`${actor.workspaceId}/${actor.companyId}/`))
      throw new ApiError(409, "An approved PDF pitch deck is not available", "document_missing");
    const { data: signed, error } = await db.storage.from("pitch-decks").createSignedUrl(asset.storage_path, 30 * 60);
    if (error || !signed?.signedUrl) throw new ApiError(502, "Pitch deck could not be shared securely", "document_unavailable");
    files.push({ label: asset.file_name ?? "Pitch deck", urlOrPath: signed.signedUrl, approved: true });
  }
  const profile = Object.fromEntries(PROFILE_FIELDS.map((key) => [fieldLabels[key], canonical.data.fields[key]]).filter(([, value]) => Boolean(value))) as Record<string, string>;
  if (company.website_url) profile["Company website"] = company.website_url;
  const revision = createHash("sha256").update(JSON.stringify({ formUrl, profile, approvedAnswers, files: files.map((file) => file.label) })).digest("hex").slice(0, 24);
  const programContext = JSON.stringify({
    description: program.description,
    eligibility: program.eligibility,
    requiredMaterials: program.required_materials,
    deadline: program.deadline,
  }).slice(0, 8_000);
  return { formUrl, programName: program.name, programContext, profile, approvedAnswers, files, revision };
}
