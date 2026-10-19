import { after, NextResponse } from "next/server";

import { z } from "zod";

import { claimAnalysis, readAnalysisStatus, writeAnalysisStatus } from "@/lib/knowledge/analysis-repository";
import { processSourceAnalysisJobs } from "@/lib/knowledge/source-jobs";
import { getKnowledgeGenerationContext } from "@/lib/knowledge/generation-context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;
type RouteContext = { params: Promise<{ id: string }> };

async function authorize(route: RouteContext) {
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return null;
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const context = await getKnowledgeGenerationContext(db, user.id, id);
  if (!context) return null;
  const { data: profile } = await db
    .from("founder_profiles")
    .select("onboarding_completed")
    .eq("workspace_id", context.workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.onboarding_completed) return null;
  return { db, user, context };
}

export async function GET(_request: Request, route: RouteContext) {
  const access = await authorize(route);
  if (!access) return NextResponse.json({ error: "Company unavailable." }, { status: 404 });
  try {
    return NextResponse.json(await readAnalysisStatus(access.db, access.context), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Analysis status unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request, route: RouteContext) {
  const origin = request.headers.get("origin");
  try {
    // Next may canonicalize request.url to its bind hostname; compare the browser's
    // origin to the actual Host header (which browser scripts cannot override).
    if (
      request.headers.get("sec-fetch-site") === "cross-site" ||
      (origin && new URL(origin).host !== request.headers.get("host"))
    ) {
      return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }
  const access = await authorize(route);
  if (!access)
    return NextResponse.json({ error: "Complete onboarding before analyzing this company." }, { status: 404 });
  try {
    const { data: deck, error: deckError } = await access.db
      .from("company_assets")
      .select("id")
      .eq("workspace_id", access.context.workspaceId)
      .eq("company_id", access.context.companyId)
      .eq("type", "pitch_deck")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (deckError) throw deckError;
    if (!access.context.companyUrl && !deck)
      return NextResponse.json(
        { error: "Add a website or pitch deck before starting automatic analysis." },
        { status: 400 },
      );
    // Privileged client is created only after RLS + explicit user/workspace/profile checks.
    const db = createSupabaseAdminClient();
    const { data: activeJob } = await db.from("source_analysis_jobs").select("id")
      .eq("workspace_id", access.context.workspaceId).eq("company_id", access.context.companyId)
      .eq("kind", "company").in("status", ["queued", "running"]).limit(1).maybeSingle();
    if (activeJob) return NextResponse.json({ ...await readAnalysisStatus(access.db, access.context), accepted: false });
    const sourceKey = `${access.context.companyUrl ?? ""}|${deck?.id ?? ""}`;
    const { claimed, status } = await claimAnalysis(
      db,
      access.context,
      access.user.id,
      !access.context.companyUrl,
      sourceKey,
    );
    if (claimed) {
      const { error: queueError } = await db.from("source_analysis_jobs").insert({
        workspace_id: access.context.workspaceId, company_id: access.context.companyId,
        requested_by: access.user.id, kind: "company", analysis_run_id: status.runId,
        idempotency_key: `company:${access.context.companyId}:${status.runId}`,
      });
      if (queueError) {
        await writeAnalysisStatus(db, access.context, { ...status, state: "failed", errorCode: "QUEUE_UNAVAILABLE" });
        throw new Error("Company analysis could not be queued");
      }
      after(async () => { try { await processSourceAnalysisJobs(); } catch { /* Cron recovers queued work. */ } });
    }
    return NextResponse.json({ ...status, accepted: claimed }, { status: claimed ? 202 : 200 });
  } catch {
    return NextResponse.json({ error: "Analysis could not start. Your onboarding is saved." }, { status: 503 });
  }
}
