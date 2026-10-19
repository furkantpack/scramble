import "server-only";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "./server";

export async function getWorkspaceContext(options: { requireOnboarding?: boolean } = {}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/scouter-founder/login");

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("id, workspace_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (membershipError || !membership) redirect("/scouter-founder/login?error=workspace");

  const [{ data: founderProfile }, { data: company }] = await Promise.all([
    supabase.from("founder_profiles").select("*").eq("workspace_id", membership.workspace_id).eq("user_id", user.id).maybeSingle(),
    supabase.from("companies").select("*").eq("workspace_id", membership.workspace_id).limit(1).maybeSingle(),
  ]);

  if (options.requireOnboarding && !founderProfile?.onboarding_completed) redirect("/onboarding");
  return { supabase, user, membership, workspaceId: membership.workspace_id, founderProfile, company };
}

export function safeSupabaseMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") return fallback;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  if (code === "42501" || code === "PGRST301") return "You do not have permission to perform this action.";
  if (code === "23505") return "This record already exists.";
  return fallback;
}
