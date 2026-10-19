import type { Metadata } from "next";

import { confirmedProfileSchema, storedUnifiedAnalysisSchema } from "@/lib/knowledge/unified-profile";
import { getWorkspaceContext } from "@/lib/supabase/context";

import { ProfileEditor } from "./profile-editor";
import { UnifiedProfileReview } from "./unified-profile-review";

export const metadata: Metadata = {
  title: "Company Profile - Scramble",
  description: "Manage the founder and company details Scramble uses across your applications.",
};

export default async function Page() {
  const { supabase, workspaceId, membership, founderProfile, company } = await getWorkspaceContext({
    requireOnboarding: true,
  });
  if (!founderProfile || !company) throw new Error("Founder profile is unavailable");
  const { data: deck, error } = await supabase
    .from("company_assets")
    .select("file_name,created_at,file_size_bytes")
    .eq("workspace_id", workspaceId)
    .eq("company_id", company.id)
    .eq("type", "pitch_deck")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Pitch deck status is unavailable");
  const analysis = storedUnifiedAnalysisSchema.safeParse(company.unified_analysis);
  const confirmed = confirmedProfileSchema.safeParse(company.canonical_profile);
  return (
    <div className="space-y-6">
      <UnifiedProfileReview
        companyId={company.id}
        initialAnalysis={analysis.success ? analysis.data : null}
        initialConfirmed={confirmed.success ? confirmed.data : null}
      />
      <ProfileEditor
        workspaceId={workspaceId}
        membershipRole={membership.role}
        founder={founderProfile}
        company={company}
        deck={deck}
      />
    </div>
  );
}
