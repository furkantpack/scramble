import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { getOnboardingWorkspace, isPdf, isSameOrigin } from "@/lib/pitch-deck/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > 21 * 1024 * 1024) {
    return NextResponse.json({ error: "Choose a PDF file smaller than 20 MB." }, { status: 413 });
  }
  const context = await getOnboardingWorkspace();
  if (!context) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!context.company)
    return NextResponse.json({ error: "Save your company details before uploading a deck." }, { status: 409 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !isPdf(file, file.name)) {
    return NextResponse.json({ error: "Choose a PDF file smaller than 20 MB." }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    return NextResponse.json({ error: "The selected file is not a valid PDF." }, { status: 400 });
  }

  const storagePath = `${context.workspaceId}/${context.company.id}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await context.supabase.storage
    .from("pitch-decks")
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError)
    return NextResponse.json({ error: "The private deck upload failed. Please try again." }, { status: 502 });

  const { data: asset, error: insertError } = await context.supabase
    .from("company_assets")
    .insert({
      workspace_id: context.workspaceId,
      company_id: context.company.id,
      type: "pitch_deck",
      file_name: file.name.slice(0, 255),
      storage_path: storagePath,
      mime_type: "application/pdf",
      file_size_bytes: file.size,
      content_sha256: createHash("sha256").update(bytes).digest("hex"),
      analysis_status: "uploaded",
    })
    .select("id")
    .single();
  if (insertError || !asset) {
    await context.supabase.storage.from("pitch-decks").remove([storagePath]);
    return NextResponse.json(
      { error: "The deck record could not be saved. Apply the pitch deck migration and retry." },
      { status: 503 },
    );
  }
  return NextResponse.json({ assetId: asset.id }, { status: 201 });
}
