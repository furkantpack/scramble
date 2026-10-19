import { NextResponse } from "next/server";

import { getWorkspaceContext } from "@/lib/supabase/context";

export async function GET() {
  const { supabase, workspaceId, company } = await getWorkspaceContext({ requireOnboarding: true });
  if (!company) return new NextResponse("Company not found", { status: 404 });

  const { data: deck, error } = await supabase
    .from("company_assets")
    .select("storage_path")
    .eq("workspace_id", workspaceId)
    .eq("company_id", company.id)
    .eq("type", "pitch_deck")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !deck) return new NextResponse("Pitch deck not found", { status: 404 });

  const { data: signed, error: signingError } = await supabase.storage
    .from("pitch-decks")
    .createSignedUrl(deck.storage_path, 60);
  if (signingError || !signed?.signedUrl) {
    return new NextResponse("Pitch deck is temporarily unavailable", { status: 503 });
  }

  return NextResponse.redirect(signed.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
