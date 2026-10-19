import "server-only";

import { createClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const source = new URL(origin);
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.slice(0, -1);
    return source.host === host && source.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}

export async function getOnboardingWorkspace() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: member } = await supabase
    .from("workspace_members")
    .select("workspace_id,role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!member || member.role !== "owner") return null;
  const { data: company } = await supabase
    .from("companies")
    .select("id,workspace_id,name")
    .eq("workspace_id", member.workspace_id)
    .limit(1)
    .maybeSingle();
  return { supabase, user, workspaceId: member.workspace_id, company };
}

export function getPitchDeckAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Pitch deck server configuration is missing");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function isPdf(file: Blob, name: string) {
  return (
    file.type === "application/pdf" &&
    name.toLowerCase().endsWith(".pdf") &&
    file.size > 0 &&
    file.size <= MAX_PDF_BYTES
  );
}
