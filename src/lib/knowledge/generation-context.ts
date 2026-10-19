import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CompanyContext, FounderContext } from "@/lib/gemini/types";
import type { Database } from "@/types/database";

export async function getKnowledgeGenerationContext(
  supabase: SupabaseClient<Database>,
  userId: string,
  companyId: string,
) {
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id,workspace_id,name,website_url,stage,short_description")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError || !company) return null;

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", company.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError || !membership) return null;

  const { data: founder, error: founderError } = await supabase
    .from("founder_profiles")
    .select("id,first_name,last_name,linkedin_url,anything_else_scouter_should_know")
    .eq("workspace_id", company.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (founderError || !founder) return null;
  const { data: needs, error: needsError } = await supabase
    .from("founder_needs")
    .select("need")
    .eq("workspace_id", company.workspace_id)
    .eq("founder_profile_id", founder.id);
  if (needsError) throw new Error("Founder context unavailable");

  const founderContext: FounderContext = {
    firstName: founder?.first_name,
    lastName: founder?.last_name,
    linkedinUrl: founder?.linkedin_url,
    selectedNeeds: (needs ?? []).map((item) => item.need),
    additionalContext: founder?.anything_else_scouter_should_know,
  };
  const companyContext: CompanyContext = {
    stage: company.stage,
    shortDescription: company.short_description,
  };
  return {
    workspaceId: company.workspace_id,
    companyId: company.id,
    companyName: company.name,
    companyUrl: company.website_url,
    founderContext,
    companyContext,
  };
}
