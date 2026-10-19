import { formatDeadline, formatProgramLocation, formatProgramType, humanize, sourceUrls } from "@/lib/accelerators/formatting";
import { programLogoUrl } from "@/lib/accelerators/logo";
import type { Tables } from "@/types/database";

const categories = [
  "problem", "solution", "target_customer", "market", "traction",
  "business_model", "competition", "team", "ask",
] as const;

type Application = Tables<"accelerator_applications">;
type Program = Tables<"accelerator_programs">;
type Knowledge = Tables<"knowledge_base_entries">;
type Audit = Tables<"audit_logs">;
type Status = Application["status"];

const preparingStatuses = new Set<Status>([
  "draft", "product_analyzing", "product_ready", "kb_approved", "form_questions_extracting",
  "form_questions_ready", "answers_generating", "answers_review_pending", "answers_approved",
  "agent_filling", "submitting", "failed",
]);

export type DashboardInput = {
  firstName: string;
  lastName: string;
  linkedinUrl: string | null;
  company: Tables<"companies"> | null;
  needsCount: number;
  applications: Application[];
  programs: Program[];
  questions: Pick<Tables<"application_questions">, "id" | "application_id" | "required">[];
  answers: Pick<Tables<"application_answers">, "question_id" | "application_id" | "answer_text" | "answer_file_path" | "status">[];
  knowledge: Knowledge[];
  knowledgeSources: Pick<Tables<"knowledge_sources">, "knowledge_entry_id">[];
  snapshots: Pick<Tables<"scrape_snapshots">, "source_url" | "fetched_at">[];
  assets: Pick<Tables<"company_assets">, "type">[];
  unreadNotifications: number;
  activity: Pick<Audit, "action" | "application_id" | "metadata" | "created_at">[];
  analysisState?: string;
};

export type DashboardView = ReturnType<typeof buildFounderDashboardModel>;

export function buildFounderDashboardModel(input: DashboardInput, now = new Date()) {
  const company = input.company;
  const applications = input.applications;
  const latestByProgram = new Map<string, Application>();
  for (const application of [...applications].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (application.accelerator_program_id && !latestByProgram.has(application.accelerator_program_id)) {
      latestByProgram.set(application.accelerator_program_id, application);
    }
  }
  const isStageMatch = (program: Program) => Boolean(
    company && company.stage !== "not_sure" && program.stages.some((stage) => normalizeStage(stage) === normalizeStage(company.stage)),
  );
  const availablePrograms = input.programs.filter((program) => formatDeadline(program, now).state !== "Closed");
  const orderedPrograms = [...availablePrograms].sort((left, right) => {
    const leftApplication = Number(latestByProgram.has(left.id));
    const rightApplication = Number(latestByProgram.has(right.id));
    if (leftApplication !== rightApplication) return rightApplication - leftApplication;
    const leftStage = Number(isStageMatch(left));
    const rightStage = Number(isStageMatch(right));
    if (leftStage !== rightStage) return rightStage - leftStage;
    return formatDeadline(left, now).sortTime - formatDeadline(right, now).sortTime || left.name.localeCompare(right.name);
  });
  const opportunities = orderedPrograms.slice(0, 5).map((program) => {
    const application = latestByProgram.get(program.id);
    const deadline = formatDeadline(program, now);
    return {
      id: program.id,
      name: program.name,
      logoUrl: programLogoUrl(program.logo_url, program.website_url ?? sourceUrls(program.source_urls)[0]),
      type: formatProgramType(program.program_type),
      stage: program.stages.slice(0, 2).map(humanize).join(" / ") || "Stage not specified",
      geography: formatProgramLocation(program),
      deadline: program.deadline ? new Date(`${program.deadline}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : deadline.label ?? "Upcoming",
      relevance: isStageMatch(program) ? "Stage match" : null,
      status: application ? applicationLabel(application.status) : "Not started",
      href: `/introductions?program=${encodeURIComponent(program.id)}`,
    };
  });

  const knowledgeByCategory = new Map<Knowledge["category"], Knowledge>();
  for (const entry of [...input.knowledge].sort((a, b) => b.version - a.version)) {
    const current = knowledgeByCategory.get(entry.category);
    if (!current || (isFounderProtected(entry) && !isFounderProtected(current))) knowledgeByCategory.set(entry.category, entry);
  }
  const knowledge = categories.map((category) => {
    const entry = knowledgeByCategory.get(category);
    const status = entry?.status === "approved" && entry.content?.trim()
      ? "Ready" as const
      : entry?.content?.trim() && entry.status !== "missing"
        ? "Needs review" as const
        : "Missing" as const;
    return { category, label: humanize(category), status };
  });
  const readyKnowledge = knowledge.filter((item) => item.status === "Ready").length;
  const displayedEntryIds = new Set([...knowledgeByCategory.values()].map((entry) => entry.id));
  const knowledgeSourceCount = input.knowledgeSources.filter((source) => displayedEntryIds.has(source.knowledge_entry_id)).length;
  const profileReady = Boolean(input.firstName.trim() && input.lastName.trim() && input.linkedinUrl?.trim());
  const companyReady = Boolean(company?.name.trim() && company.stage !== "not_sure");
  const deckReady = input.assets.some((asset) => asset.type === "pitch_deck");
  const websiteHost = hostname(company?.website_url);
  const matchingSnapshots = input.snapshots.filter((snapshot) => hostname(snapshot.source_url) === websiteHost && websiteHost !== null);
  const latestFetch = matchingSnapshots.map((snapshot) => snapshot.fetched_at).sort().at(-1);
  const websitePages = new Set(matchingSnapshots.filter((snapshot) => snapshot.fetched_at === latestFetch).map((snapshot) => snapshot.source_url)).size;
  const websiteStatus = input.analysisState === "scraping" || input.analysisState === "generating"
    ? "Analyzing"
    : websitePages > 0 ? "Ready" : company?.website_url ? "Needs analysis" : "Missing";

  const activeApplications = applications.filter((application) => !["submitted", "failed"].includes(application.status));
  const preparing = applications.filter((application) => preparingStatuses.has(application.status) && application.status !== "agent_filled_pending_final_approval");
  const ready = applications.filter((application) => application.status === "agent_filled_pending_final_approval");
  const submitted = applications.filter((application) => application.status === "submitted");
  const confirmed = submitted.filter((application) => Boolean(application.submission_confirmation));
  const draftCount = preparing.filter((application) => application.status !== "submitting" && application.status !== "failed").length;
  const found = availablePrograms.filter((program) => !latestByProgram.has(program.id)).length;

  const programById = new Map(input.programs.map((program) => [program.id, program]));
  const appName = (application: Application) => application.program_name_snapshot || (application.accelerator_program_id ? programById.get(application.accelerator_program_id)?.name : null) || "Application";
  const appHref = (application: Application) => application.accelerator_program_id
    ? `/introductions?program=${encodeURIComponent(application.accelerator_program_id)}`
    : "/introductions";
  const actions: { title: string; description: string; href: string; tone: "amber" | "sky" | "violet" }[] = [];
  if (!profileReady) actions.push({ title: "Complete your founder profile", description: "Add your name and LinkedIn profile for application readiness.", href: "/profile", tone: "amber" });
  if (!companyReady) actions.push({ title: "Complete your company details", description: "Company name and stage help prepare relevant applications.", href: "/profile", tone: "amber" });
  if (!company?.website_url) actions.push({ title: "Connect your company website", description: "Add your website so Scouter can build company knowledge.", href: "/profile", tone: "amber" });
  for (const application of applications.filter((item) => item.status !== "submitted" && item.status !== "failed")) {
    const required = input.questions.filter((question) => question.application_id === application.id && question.required);
    const missing = required.filter((question) => !input.answers.some((answer) => answer.question_id === question.id && (answer.answer_text?.trim() || answer.answer_file_path)));
    if (missing.length > 0) actions.push({ title: `Complete ${appName(application)} application`, description: `${missing.length} required ${missing.length === 1 ? "answer needs" : "answers need"} your input.`, href: appHref(application), tone: "sky" });
  }
  for (const application of applications.filter((item) => item.status === "answers_review_pending")) {
    const reviewCount = input.answers.filter((answer) => answer.application_id === application.id && answer.status !== "approved" && (answer.answer_text || answer.answer_file_path)).length;
    actions.push({ title: `Review ${appName(application)} answers`, description: reviewCount ? `${reviewCount} answers are waiting for your review.` : "The draft is waiting for founder review.", href: appHref(application), tone: "violet" });
  }
  for (const application of ready) actions.push({ title: `Approve ${appName(application)} application`, description: "The filled application is waiting for final approval.", href: appHref(application), tone: "violet" });
  if (knowledge.find((item) => item.category === "traction")?.status === "Missing") actions.push({ title: "Add your traction", description: "Add MRR, ARR or other supported traction details.", href: "/knowledge-base?section=traction", tone: "sky" });
  if (websiteStatus === "Needs analysis") actions.push({ title: "Analyze your website", description: "Refresh sources to build company knowledge.", href: "/knowledge-base", tone: "sky" });
  if (!deckReady) actions.push({ title: "Add your pitch deck", description: "Your application materials do not include a pitch deck yet.", href: "/profile", tone: "sky" });

  const primaryApplication = ready[0]
    ?? applications.find((item) => item.status === "answers_review_pending")
    ?? activeApplications[0];
  const primaryAction = ready.length > 0 || applications.some((item) => item.status === "answers_review_pending")
    ? { label: "Review application", href: primaryApplication ? appHref(primaryApplication) : "/introductions", description: "An application is waiting for your review." }
    : activeApplications.length > 0
      ? { label: "Continue application", href: primaryApplication ? appHref(primaryApplication) : "/introductions", description: "Pick up the application already in progress." }
      : orderedPrograms.length > 0
        ? { label: "Start an application", href: opportunities[0]?.href ?? "/introductions", description: "Explore available programs and begin your first application." }
        : { label: "Find programs", href: "/introductions", description: "Browse accelerator and startup programs." };

  const applicationById = new Map(applications.map((application) => [application.id, application]));
  const activity = input.activity.flatMap((event) => {
    const mapped = activityLabel(event);
    if (!mapped) return [];
    const application = event.application_id ? applicationById.get(event.application_id) : undefined;
    return [{ title: mapped, subtitle: application ? appName(application) : company?.name ?? "Company profile", time: event.created_at, href: application ? appHref(application) : event.action.startsWith("knowledge_") || event.action === "company_analysis_status" ? "/knowledge-base" : "/profile" }];
  }).slice(0, 5);

  return {
    firstName: input.firstName.trim() || "Founder",
    companyName: company?.name ?? "Your company",
    summary: {
      applications: applications.length,
      active: activeApplications.length,
      drafts: draftCount,
      submitted: submitted.length,
      confirmed: confirmed.length,
      notifications: input.unreadNotifications,
    },
    pipeline: { found, preparing: preparing.length, ready: ready.length, submitted: submitted.length, completed: 0 },
    opportunities,
    actions: actions.slice(0, 5),
    sources: [
      { title: "Founder Profile", status: profileReady ? "Ready" : "Incomplete", detail: input.linkedinUrl ? "LinkedIn + onboarding information" : "Add your LinkedIn profile", href: "/profile" },
      { title: "Company", status: companyReady ? "Ready" : "Incomplete", detail: company ? `${company.name} · ${humanize(company.stage)}` : "Add company details", href: "/profile" },
      { title: "Company Website", status: websiteStatus, detail: websitePages ? `${websitePages} pages analyzed` : company?.website_url ?? "Add your website", href: company?.website_url ? "/knowledge-base" : "/profile" },
      { title: "Pitch Deck", status: deckReady ? "Ready" : "Not uploaded", detail: deckReady ? "Deck uploaded" : "Add your pitch deck", href: "/profile" },
    ],
    readiness: [
      { title: "Founder profile", value: profileReady ? "Complete" : "Incomplete", ready: profileReady },
      { title: "Company knowledge", value: `${readyKnowledge} / 9 approved`, ready: readyKnowledge === 9 },
      { title: "Application materials", value: deckReady ? "Pitch deck ready" : "Pitch deck missing", ready: deckReady },
      { title: "Application access", value: "Not tracked", ready: false },
    ],
    knowledge,
    readyKnowledge,
    knowledgeSourceCount,
    primaryAction,
    activity,
    needsCount: input.needsCount,
  };
}

function normalizeStage(stage: string) {
  return stage.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function hostname(url: string | null | undefined) {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

function isFounderProtected(entry: Knowledge) {
  return entry.status === "approved" || entry.status === "founder_edited";
}

function applicationLabel(status: Status) {
  if (status === "submitted") return "Submitted";
  if (status === "agent_filled_pending_final_approval") return "Ready for approval";
  if (status === "answers_review_pending") return "Needs review";
  if (status === "failed") return "Needs attention";
  if (status === "draft") return "Draft";
  return "Preparing";
}

function activityLabel(event: Pick<Audit, "action" | "metadata">) {
  if (event.action === "company_analysis_status") {
    const metadata = event.metadata;
    return metadata && typeof metadata === "object" && !Array.isArray(metadata) && metadata.state === "ready"
      ? "Company analysis completed"
      : null;
  }
  const labels: Record<string, string> = {
    onboarding_completed: "Founder onboarding completed",
    knowledge_edited: "Knowledge section updated",
    knowledge_approved: "Knowledge section approved",
    application_started: "Application draft created",
    answer_edited: "Application answer edited",
    answer_approved: "Application answer approved",
    application_submitted: "Application submitted",
    application_failed: "Application needs attention",
  };
  return labels[event.action] ?? null;
}
