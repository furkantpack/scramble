import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { analyzePitchDeck } from "./analyze";
import { pitchDeckPageSchema, pitchDeckProfileSchema } from "./schema";
import { MAX_PDF_BYTES } from "./server";

export async function loadLatestPitchDeckEvidence(
  db: SupabaseClient<Database>,
  workspaceId: string,
  companyId: string,
) {
  const { data: asset, error } = await db
    .from("company_assets")
    .select("id,storage_path,mime_type,file_size_bytes,analysis_status,extracted_text,extracted_json,extracted_pages")
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .eq("type", "pitch_deck")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Pitch deck evidence unavailable");
  if (!asset) return null;
  const expectedPrefix = `${workspaceId}/${companyId}/`;
  if (!asset.storage_path.startsWith(expectedPrefix)) throw new Error("Pitch deck path is outside company scope");
  const profile = pitchDeckProfileSchema.safeParse(asset.extracted_json);
  const pages = pitchDeckPageSchema.array().safeParse(asset.extracted_pages);
  if (asset.analysis_status === "processed" && profile.success && pages.success) {
    return { assetId: asset.id, profile: profile.data, pages: pages.data, extractedText: asset.extracted_text ?? "" };
  }
  if (asset.mime_type !== "application/pdf" || !asset.file_size_bytes || asset.file_size_bytes > MAX_PDF_BYTES)
    throw new Error("Only PDF decks up to 20 MB can be analyzed");
  const { error: processingError } = await db
    .from("company_assets")
    .update({ analysis_status: "processing", analysis_error: null })
    .eq("id", asset.id)
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId);
  if (processingError) throw new Error("Pitch deck analysis could not start");
  try {
    const { data: file, error: downloadError } = await db.storage.from("pitch-decks").download(asset.storage_path);
    if (downloadError || !file || file.size > MAX_PDF_BYTES) throw new Error("Pitch deck could not be downloaded");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Invalid PDF");
    const result = await analyzePitchDeck(bytes);
    const { error: saveError } = await db
      .from("company_assets")
      .update({
        analysis_status: "processed",
        extracted_text: result.extractedText,
        extracted_json: result.profile,
        extracted_pages: result.pages,
        analysis_error: null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", asset.id)
      .eq("workspace_id", workspaceId)
      .eq("company_id", companyId);
    if (saveError) throw new Error("Pitch deck extraction could not be saved");
    return { assetId: asset.id, ...result };
  } catch {
    await db
      .from("company_assets")
      .update({ analysis_status: "failed", analysis_error: "Deck analysis failed. Please retry." })
      .eq("id", asset.id)
      .eq("workspace_id", workspaceId)
      .eq("company_id", companyId);
    throw new Error("Pitch deck analysis failed");
  }
}
