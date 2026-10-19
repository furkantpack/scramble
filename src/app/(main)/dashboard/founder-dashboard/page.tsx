import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/supabase/context";

import { FounderDashboard } from "../_components/founder/founder-dashboard";
import { buildFounderDashboardModel } from "../_components/founder/founder-dashboard-model";

export const metadata: Metadata = {
  title: "Scramble - Founder Dashboard",
  description: "Your accelerator opportunities, applications, company knowledge, and next steps.",
};

export default async function Page() {
  const { supabase, user, workspaceId, founderProfile, company } = await getWorkspaceContext({ requireOnboarding: true });
  const companyId = company?.id ?? "00000000-0000-0000-0000-000000000000";
  const [applications, programs, knowledge, sources, snapshots, assets, notifications, activity, analysis, needs] = await Promise.all([
    supabase.from("accelerator_applications").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
    supabase.from("accelerator_programs").select("*"),
    supabase.from("knowledge_base_entries").select("*").eq("workspace_id", workspaceId).eq("company_id", companyId),
    supabase.from("knowledge_sources").select("knowledge_entry_id").eq("workspace_id", workspaceId),
    supabase.from("scrape_snapshots").select("source_url,fetched_at").eq("workspace_id", workspaceId).eq("company_id", companyId),
    supabase.from("company_assets").select("type").eq("workspace_id", workspaceId).eq("company_id", companyId),
    supabase.from("notifications").select("read_at").eq("workspace_id", workspaceId).eq("user_id", user.id),
    supabase.from("audit_logs").select("action,application_id,metadata,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(40),
    supabase.from("audit_logs").select("metadata").eq("workspace_id", workspaceId).eq("id", companyId).eq("action", "company_analysis_status").maybeSingle(),
    supabase.from("founder_needs").select("id").eq("workspace_id", workspaceId),
  ]);
  for (const result of [applications, programs, knowledge, sources, snapshots, assets, notifications, activity, analysis, needs]) {
    if (result.error) throw new Error("Founder dashboard data could not be loaded");
  }
  const applicationIds = (applications.data ?? []).map((application) => application.id);
  const [questions, answers] = applicationIds.length > 0
    ? await Promise.all([
      supabase.from("application_questions").select("id,application_id,required").eq("workspace_id", workspaceId).in("application_id", applicationIds),
      supabase.from("application_answers").select("question_id,application_id,answer_text,answer_file_path,status").eq("workspace_id", workspaceId).in("application_id", applicationIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (questions.error || answers.error) throw new Error("Application readiness could not be loaded");
  const metadataValue = analysis.data?.metadata;
  const analysisState = metadataValue && typeof metadataValue === "object" && !Array.isArray(metadataValue) && typeof metadataValue.state === "string"
    ? metadataValue.state : undefined;
  const analysisUpdatedAt = metadataValue && typeof metadataValue === "object" && !Array.isArray(metadataValue) && typeof metadataValue.updatedAt === "string"
    ? metadataValue.updatedAt : undefined;
  const recentActivity = (activity.data ?? []).filter((event) => event.action !== "company_analysis_status");
  if (analysisState === "ready" && analysisUpdatedAt) {
    recentActivity.push({ action: "company_analysis_status", application_id: null, metadata: metadataValue ?? null, created_at: analysisUpdatedAt });
  }
  recentActivity.sort((left, right) => right.created_at.localeCompare(left.created_at));
  const dashboard = buildFounderDashboardModel({
    firstName: founderProfile?.first_name ?? "",
    lastName: founderProfile?.last_name ?? "",
    linkedinUrl: founderProfile?.linkedin_url ?? null,
    company,
    needsCount: needs.data?.length ?? 0,
    applications: applications.data ?? [],
    programs: programs.data ?? [],
    questions: questions.data ?? [],
    answers: answers.data ?? [],
    knowledge: knowledge.data ?? [],
    knowledgeSources: sources.data ?? [],
    snapshots: snapshots.data ?? [],
    assets: assets.data ?? [],
    unreadNotifications: (notifications.data ?? []).filter((notification) => !notification.read_at).length,
    activity: recentActivity,
    analysisState,
  });
  return <FounderDashboard data={dashboard} />;
}
