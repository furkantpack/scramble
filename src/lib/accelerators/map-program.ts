import type { Accelerator } from "@/app/(external)/(scouter-founder-routes)/introductions/interview-library";
import type { Tables } from "@/types/database";

import {
  formatDeadline,
  formatFunding,
  formatProgramLocation,
  formatProgramType,
  humanize,
  jsonToEligibility,
  jsonToStrings,
  sourceUrls,
} from "./formatting";
import { programLogoUrl } from "./logo";

type Program = Tables<"accelerator_programs">;
type Application = Pick<Tables<"accelerator_applications">, "id" | "status"> & { questionCount?: number };

export type MappedProgram = { accelerator: Accelerator; sortGroup: number; sortTime: number };

export function mapProgram(program: Program, application?: Application): MappedProgram {
  const deadline = formatDeadline(program);
  const urls = sourceUrls(program.source_urls);
  const websiteUrl = program.website_url ?? urls[0] ?? "";
  const funding = formatFunding(program);
  const equity =
    program.equity_percent == null || (program.program_type === "grant" && program.equity_percent === 0)
      ? undefined
      : `${program.equity_percent}% equity`;
  const operator = program.operator_name?.trim();
  const organization = operator && operator.toLowerCase() !== program.name.toLowerCase() ? operator : undefined;
  const questionCount = application?.questionCount ?? 0;

  const terms = [
    funding ? { label: "Funding", value: funding } : null,
    equity ? { label: "Equity", value: equity } : null,
    program.funding_terms ? { label: "Published terms", value: program.funding_terms } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  const criteria = [
    program.stages.length ? { label: "Stages", value: program.stages.map(humanize).join(" · ") } : null,
    program.industries.length ? { label: "Industries", value: program.industries.map(humanize).join(" · ") } : null,
    program.business_models.length ? { label: "Business models", value: program.business_models.join(" · ") } : null,
    program.geographies.length ? { label: "Geography", value: program.geographies.join(" · ") } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  return {
    sortGroup: deadline.sortGroup,
    sortTime: deadline.sortTime,
    accelerator: {
      id: program.id,
      initials: program.name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase(),
      logoUrl: programLogoUrl(program.logo_url, websiteUrl),
      name: program.name,
      organization,
      description: program.description ?? undefined,
      location: formatProgramLocation(program),
      type: formatProgramType(program.program_type),
      accent: "bg-orange-100 text-orange-700",
      matchReasons: [],
      gaps: [],
      tags: [...program.stages.slice(0, 2).map(humanize), ...program.industries.map(humanize)],
      deadline: deadline.label,
      deadlineDate: program.deadline ?? undefined,
      deadlineState: deadline.state,
      offer: funding,
      equity,
      effort: questionCount ? `${questionCount} questions detected` : "Application details not analyzed",
      applicationStatus: applicationStatus(application?.status),
      rawApplicationStatus: application?.status,
      applicationRecordId: application?.id,
      website: displayUrl(websiteUrl),
      websiteUrl,
      sourceUrls: urls,
      applicationUrl: program.application_url ?? "",
      program: {
        location: program.location ?? "",
        format: program.format === "unknown" ? "" : humanize(program.format),
        duration: program.duration_text ?? "",
        cohort: program.cohort_name ?? "",
        starts: program.program_start_date
          ? new Date(`${program.program_start_date}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" })
          : "",
      },
      terms,
      criteria,
      thesis: program.description ? [program.description] : [],
      eligibility: jsonToEligibility(program.eligibility),
      benefits: jsonToStrings(program.benefits),
      application: {
        questions: questionCount,
        ready: 0,
        estimate: questionCount ? "Answers not generated yet" : "Not analyzed yet",
        format: "External application",
        materials: jsonToStrings(program.required_materials),
        missing: [],
      },
      alumni: [],
      verified: program.last_verified_at
        ? new Date(program.last_verified_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "Not yet verified",
    },
  };
}

function applicationStatus(status?: Tables<"accelerator_applications">["status"]): Accelerator["applicationStatus"] {
  if (!status) return "Not started";
  if (status === "agent_filling") return "Agent working";
  if (status === "agent_filled_pending_final_approval" || status === "answers_review_pending") return "Review";
  if (status === "submitting") return "Submitting";
  if (status === "submitted") return "Submitted";
  if (status === "submission_unverified") return "Needs verification";
  if (status === "failed") return "Failed";
  return "Draft";
}

function displayUrl(value: string) {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
