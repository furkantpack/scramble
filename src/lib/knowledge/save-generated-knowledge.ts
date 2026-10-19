import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { KnowledgeGenerationResponse, KnowledgeSection } from "@/lib/gemini/types";
import type { Database, Json, Tables } from "@/types/database";

type SavedSection = {
  category: KnowledgeSection["category"];
  entryId: string;
  version: number;
  disposition: "current" | "proposal";
};

export async function saveGeneratedKnowledge(
  supabase: SupabaseClient<Database>,
  context: { workspaceId: string; companyId: string },
  generation: KnowledgeGenerationResponse,
) {
  const { data: existing, error } = await supabase
    .from("knowledge_base_entries")
    .select("*")
    .eq("workspace_id", context.workspaceId)
    .eq("company_id", context.companyId)
    .order("version", { ascending: false });
  if (error) throw new Error("Existing Knowledge Base entries could not be loaded.");

  const saved: SavedSection[] = [];
  for (const section of generation.result.sections) {
    const plan = planKnowledgeSectionSave(existing ?? [], section);
    const { protectedEntry, version, disposition, status } = plan;
    const { data: entry, error: insertError } = await supabase
      .from("knowledge_base_entries")
      .insert({
        workspace_id: context.workspaceId,
        company_id: context.companyId,
        category: section.category,
        content: section.content,
        source_type: sectionSourceType(section),
        status,
        confidence: section.confidence,
        version,
        approved_by: null,
        approved_at: null,
      })
      .select("*")
      .single();
    if (insertError) throw new Error(`The ${section.category} Knowledge Base version could not be saved.`);

    const evidenceRows = section.evidence.length
      ? section.evidence
      : [
          {
            evidenceType: "inference" as const,
            sourceLabel: "Gemini knowledge analysis",
            sourceUrl: null,
            excerpt: section.notes[0] ?? "No supporting information was found in the supplied sources.",
          },
        ];
    const sourceRows = evidenceRows.map((evidence) => ({
      workspace_id: context.workspaceId,
      knowledge_entry_id: entry.id,
      source_type: evidenceSourceType(evidence.evidenceType),
      source_label: evidence.sourceLabel,
      source_url: evidence.sourceUrl,
      excerpt: evidence.excerpt.slice(0, 500),
      metadata: {
        evidenceType: evidence.evidenceType,
        missingInformation: section.missingInformation,
        notes: section.notes,
        generationModel: generation.model,
        proposalForEntryId: protectedEntry?.id ?? null,
      } satisfies Json,
    }));

    if (sourceRows.length > 0) {
      const { error: sourceError } = await supabase.from("knowledge_sources").insert(sourceRows);
      if (sourceError) {
        await supabase.from("knowledge_base_entries").delete().eq("id", entry.id);
        throw new Error(`Evidence for ${section.category} could not be saved.`);
      }
    }
    saved.push({ category: section.category, entryId: entry.id, version, disposition });
  }
  return saved;
}

export function planKnowledgeSectionSave(
  existing: Tables<"knowledge_base_entries">[],
  section: Pick<KnowledgeSection, "category" | "status">,
) {
  const categoryEntries = existing.filter((entry) => entry.category === section.category);
  const protectedEntry = categoryEntries.find(isFounderProtected);
  return {
    protectedEntry,
    version: Math.max(0, ...categoryEntries.map((entry) => entry.version)) + 1,
    disposition: (protectedEntry ? "proposal" : "current") as SavedSection["disposition"],
    status: protectedEntry ? ("needs_review" as const) : section.status,
  };
}

function isFounderProtected(entry: Tables<"knowledge_base_entries">) {
  return entry.status === "approved" || entry.status === "founder_edited";
}

function sectionSourceType(section: KnowledgeSection): Tables<"knowledge_base_entries">["source_type"] {
  if (section.evidence.some((item) => item.evidenceType === "founder_input")) return "founder";
  if (section.evidence.some((item) => item.evidenceType === "pitch_deck")) return "pitch_deck";
  if (section.evidence.some((item) => item.evidenceType === "direct")) return "website";
  return "ai_inferred";
}

function evidenceSourceType(evidenceType: KnowledgeSection["evidence"][number]["evidenceType"]) {
  return {
    direct: "website",
    pitch_deck: "pitch_deck",
    founder_input: "founder",
    inference: "ai_inferred",
  }[evidenceType] as Tables<"knowledge_sources">["source_type"];
}
