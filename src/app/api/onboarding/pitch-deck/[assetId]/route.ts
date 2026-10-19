import { after } from "next/server";
import { NextResponse } from "next/server";

import { processSourceAnalysisJobs } from "@/lib/knowledge/source-jobs";
import { pitchDeckProfileSchema } from "@/lib/pitch-deck/schema";
import { getOnboardingWorkspace, getPitchDeckAdmin, isSameOrigin, MAX_PDF_BYTES } from "@/lib/pitch-deck/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ assetId: string }> };

async function ownedAsset(assetId: string) {
  const context = await getOnboardingWorkspace();
  if (!context?.company) return null;
  const { data: asset } = await context.supabase
    .from("company_assets")
    .select("id,storage_path,mime_type,file_size_bytes,content_sha256,analysis_status,extracted_json,updated_at")
    .eq("id", assetId)
    .eq("workspace_id", context.workspaceId)
    .eq("company_id", context.company.id)
    .eq("type", "pitch_deck")
    .maybeSingle();
  if (!asset) return null;
  const expectedPrefix = `${context.workspaceId}/${context.company.id}/`;
  if (!asset.storage_path.startsWith(expectedPrefix)) return null;
  return { context: { ...context, company: context.company }, asset };
}

export async function GET(request: Request, { params }: Params) {
  const { assetId } = await params;
  const owned = await ownedAsset(assetId);
  if (!owned) return NextResponse.json({ error: "Pitch deck not found." }, { status: 404 });
  if (new URL(request.url).searchParams.has("status")) {
    const parsed = pitchDeckProfileSchema.safeParse(owned.asset.extracted_json);
    return NextResponse.json({ status: owned.asset.analysis_status,
      profile: owned.asset.analysis_status === "processed" && parsed.success ? parsed.data : null },
    { headers: { "Cache-Control": "no-store" } });
  }
  const { data, error } = await owned.context.supabase.storage
    .from("pitch-decks")
    .createSignedUrl(owned.asset.storage_path, 60);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Deck preview is unavailable." }, { status: 503 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: Params) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const { assetId } = await params;
  const owned = await ownedAsset(assetId);
  if (!owned) return NextResponse.json({ error: "Pitch deck not found." }, { status: 404 });
  if (owned.asset.analysis_status === "processed") {
    const previous = pitchDeckProfileSchema.safeParse(owned.asset.extracted_json);
    if (previous.success) return NextResponse.json({ profile: previous.data });
  }
  if (
    owned.asset.mime_type !== "application/pdf" ||
    !owned.asset.file_size_bytes ||
    owned.asset.file_size_bytes > MAX_PDF_BYTES
  ) {
    return NextResponse.json({ error: "Only PDF decks up to 20 MB can be analyzed." }, { status: 400 });
  }

  const admin = getPitchDeckAdmin();
  if (owned.asset.content_sha256) {
    const { data: duplicate } = await admin.from("company_assets")
      .select("extracted_text,extracted_json,extracted_pages")
      .eq("workspace_id", owned.context.workspaceId).eq("company_id", owned.context.company.id)
      .eq("type", "pitch_deck").eq("content_sha256", owned.asset.content_sha256)
      .eq("analysis_status", "processed").neq("id", assetId).limit(1).maybeSingle();
    const parsed = pitchDeckProfileSchema.safeParse(duplicate?.extracted_json);
    if (duplicate && parsed.success) {
      const { error: reuseError } = await admin.from("company_assets").update({
        analysis_status: "processed", extracted_text: duplicate.extracted_text,
        extracted_json: duplicate.extracted_json, extracted_pages: duplicate.extracted_pages,
        analysis_error: null, processed_at: new Date().toISOString(),
      }).eq("id", assetId).eq("workspace_id", owned.context.workspaceId).eq("company_id", owned.context.company.id);
      if (!reuseError) return NextResponse.json({ profile: parsed.data, reused: true });
    }
  }
  const { data: active } = await admin.from("source_analysis_jobs").select("id")
    .eq("workspace_id", owned.context.workspaceId).eq("company_id", owned.context.company.id)
    .eq("asset_id", assetId).in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (active) return NextResponse.json({ status: "processing", accepted: false }, { status: 202 });
  const { error } = await admin.from("source_analysis_jobs").insert({
    workspace_id: owned.context.workspaceId, company_id: owned.context.company.id,
    asset_id: assetId, requested_by: owned.context.user.id, kind: "pitch_deck",
    idempotency_key: `deck:${assetId}:${owned.asset.updated_at}`,
  });
  if (error) return NextResponse.json({ error: "Deck analysis could not be queued. Please retry." }, { status: 503 });
  after(async () => { try { await processSourceAnalysisJobs(); } catch { /* Cron recovers queued work. */ } });
  return NextResponse.json({ status: "processing", accepted: true }, { status: 202 });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const { assetId } = await params;
  const owned = await ownedAsset(assetId);
  if (!owned) return NextResponse.json({ error: "Pitch deck not found." }, { status: 404 });
  if (owned.asset.analysis_status === "processing")
    return NextResponse.json({ error: "Wait for analysis to finish before removing the deck." }, { status: 409 });
  const admin = getPitchDeckAdmin();
  const { data: activeJob, error: activeError } = await admin.from("source_analysis_jobs").select("id")
    .eq("workspace_id", owned.context.workspaceId).eq("company_id", owned.context.company.id)
    .eq("asset_id", assetId).in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (activeError) return NextResponse.json({ error: "Deck status is unavailable." }, { status: 503 });
  if (activeJob) return NextResponse.json({ error: "Wait for analysis to finish before removing the deck." }, { status: 409 });
  const { error: storageError } = await admin.storage.from("pitch-decks").remove([owned.asset.storage_path]);
  if (storageError) return NextResponse.json({ error: "Could not remove the deck file." }, { status: 502 });
  const { error: rowError } = await admin.from("company_assets").delete().eq("id", assetId);
  if (rowError) return NextResponse.json({ error: "Could not remove the deck record." }, { status: 502 });
  return NextResponse.json({ removed: true });
}
