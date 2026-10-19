import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/supabase/context";
import type { Tables } from "@/types/database";

import { KnowledgeBaseWorkspace } from "./knowledge-base-workspace";

export const metadata: Metadata = {
  title: "Knowledge Base - AcceleratorPilot",
  description: "The verified company context AcceleratorPilot uses to write your applications.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { supabase, user, workspaceId, company } = await getWorkspaceContext({ requireOnboarding: true });
  if (!company) throw new Error("Complete founder onboarding before opening the Knowledge Base");
  const [{ data: entries, error }, { data: sources }] = await Promise.all([
    supabase
      .from("knowledge_base_entries")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("company_id", company.id)
      .order("version", { ascending: false }),
    supabase.from("knowledge_sources").select("*").eq("workspace_id", workspaceId),
  ]);
  if (error) throw new Error("Knowledge Base could not be loaded");
  const displayEntries = selectDisplayEntries(entries ?? []);
  const displayEntryIds = new Set(displayEntries.map((entry) => entry.id));
  const { section } = await searchParams;
  return (
    <KnowledgeBaseWorkspace
      key={displayEntries.map((entry) => `${entry.id}:${entry.updated_at}`).join("|")}
      workspaceId={workspaceId}
      companyId={company.id}
      userId={user.id}
      initialEntries={displayEntries}
      initialSources={(sources ?? []).filter((source) => displayEntryIds.has(source.knowledge_entry_id))}
      initialSection={section}
    />
  );
}

function selectDisplayEntries(entries: Tables<"knowledge_base_entries">[]) {
  const byCategory = new Map<Tables<"knowledge_base_entries">["category"], Tables<"knowledge_base_entries">[]>();
  for (const entry of entries) byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), entry]);
  return [...byCategory.values()].flatMap((versions) => {
    const founderProtected = versions.find((entry) => entry.status === "approved" || entry.status === "founder_edited");
    return [founderProtected ?? versions[0]];
  });
}
