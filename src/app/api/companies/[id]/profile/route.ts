import { NextResponse } from "next/server";

import { z } from "zod";

import { canConfirmCanonicalProfile } from "@/lib/knowledge/profile-authorization";
import { confirmedProfileSchema, PROFILE_FIELDS, storedUnifiedAnalysisSchema } from "@/lib/knowledge/unified-profile";
import { isSameOrigin } from "@/lib/pitch-deck/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

type RouteContext = { params: Promise<{ id: string }> };

const companyProfileEditSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    websiteUrl: z.url().nullable(),
    stage: z.enum(["idea", "pre_seed", "seed", "series_a", "later_stage", "not_sure"]),
    shortDescription: z.string().trim().max(4_000).nullable(),
    canonicalProfile: confirmedProfileSchema,
    expectedConfirmedAt: z.iso.datetime().nullable(),
  })
  .strict();

async function ownedCompany(route: RouteContext) {
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return null;
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data: company } = await db.from("companies").select("*").eq("id", id).maybeSingle();
  if (!company) return null;
  const { data: member } = await db
    .from("workspace_members")
    .select("id,role")
    .eq("workspace_id", company.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return null;
  return { db, user, company, member };
}

export async function GET(_request: Request, route: RouteContext) {
  const owned = await ownedCompany(route);
  if (!owned) return NextResponse.json({ error: "Company unavailable." }, { status: 404 });
  const analysis = storedUnifiedAnalysisSchema.safeParse(owned.company.unified_analysis);
  const confirmed = confirmedProfileSchema.safeParse(owned.company.canonical_profile);
  return NextResponse.json(
    {
      analysis: analysis.success ? analysis.data : null,
      confirmed: confirmed.success ? confirmed.data : null,
      confirmedAt: owned.company.profile_confirmed_at,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request, route: RouteContext) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const owned = await ownedCompany(route);
  if (!owned) return NextResponse.json({ error: "Company unavailable." }, { status: 404 });
  if (!canConfirmCanonicalProfile(owned.member.role))
    return NextResponse.json({ error: "Only the workspace owner can confirm the startup profile." }, { status: 403 });
  const payload = confirmedProfileSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: "Profile details are invalid." }, { status: 400 });
  const analysis = storedUnifiedAnalysisSchema.safeParse(owned.company.unified_analysis);
  if (!analysis.success || analysis.data.runId !== payload.data.analysisRunId)
    return NextResponse.json({ error: "Analysis changed. Refresh and review the latest suggestion." }, { status: 409 });
  const nextName = payload.data.fields.company_name?.trim() || owned.company.name;
  const nextDescription = payload.data.fields.one_liner?.trim() || owned.company.short_description;
  const stage = payload.data.fields.funding_stage
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const validStages = ["idea", "pre_seed", "seed", "series_a", "later_stage", "not_sure"] as const;
  const nextStage = validStages.find((item) => item === stage) ?? owned.company.stage;
  const provenance = Object.fromEntries(
    PROFILE_FIELDS.map((key) => {
      const proposed = analysis.data.fields[key];
      const corrected = payload.data.fields[key] !== proposed.value;
      return [
        key,
        corrected
          ? {
              source: "founder",
              confidence: 1,
              evidence: [
                { source: "founder", url: null, page: null, excerpt: "Founder reviewed and corrected this field." },
              ],
            }
          : { source: proposed.source, confidence: proposed.confidence, evidence: proposed.evidence },
      ];
    }),
  );
  const canonical = confirmedProfileSchema.parse({ ...payload.data, provenance });
  const { data, error } = await owned.db
    .from("companies")
    .update({
      canonical_profile: canonical as Json,
      profile_confirmed_at: new Date().toISOString(),
      profile_confirmed_by: owned.user.id,
      name: nextName,
      short_description: nextDescription,
      stage: nextStage as Database["public"]["Enums"]["company_stage"],
    })
    .eq("id", owned.company.id)
    .eq("workspace_id", owned.company.workspace_id)
    .eq("unified_analysis->>runId", payload.data.analysisRunId)
    .select("id")
    .maybeSingle();
  if (error || !data)
    return NextResponse.json({ error: "Profile could not be confirmed. Refresh and retry." }, { status: 409 });
  await owned.db.from("audit_logs").insert({
    workspace_id: owned.company.workspace_id,
    actor_user_id: owned.user.id,
    action: "canonical_profile_confirmed",
    metadata: { companyId: owned.company.id, analysisRunId: payload.data.analysisRunId },
  });
  return NextResponse.json({ confirmed: canonical });
}

export async function PATCH(request: Request, route: RouteContext) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const owned = await ownedCompany(route);
  if (!owned) return NextResponse.json({ error: "Company unavailable." }, { status: 404 });
  if (!canConfirmCanonicalProfile(owned.member.role))
    return NextResponse.json(
      { error: "Only the workspace owner can edit the confirmed startup profile." },
      { status: 403 },
    );

  const payload = companyProfileEditSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: "Profile details are invalid." }, { status: 400 });
  const current = confirmedProfileSchema.safeParse(owned.company.canonical_profile);
  if (!current.success)
    return NextResponse.json(
      { error: "Confirm the startup profile before editing its canonical fields." },
      { status: 409 },
    );
  if (
    current.data.analysisRunId !== payload.data.canonicalProfile.analysisRunId ||
    owned.company.profile_confirmed_at !== payload.data.expectedConfirmedAt
  )
    return NextResponse.json({ error: "Profile changed. Refresh and retry your edits." }, { status: 409 });

  const confirmedAt = new Date().toISOString();
  let update = owned.db
    .from("companies")
    .update({
      name: payload.data.name,
      website_url: payload.data.websiteUrl,
      stage: payload.data.stage,
      short_description: payload.data.shortDescription,
      canonical_profile: payload.data.canonicalProfile as Json,
      profile_confirmed_at: confirmedAt,
      profile_confirmed_by: owned.user.id,
    })
    .eq("id", owned.company.id)
    .eq("workspace_id", owned.company.workspace_id);
  update = payload.data.expectedConfirmedAt
    ? update.eq("profile_confirmed_at", payload.data.expectedConfirmedAt)
    : update.is("profile_confirmed_at", null);
  const { data, error } = await update.select("id").maybeSingle();
  if (error || !data)
    return NextResponse.json({ error: "Profile changed. Refresh and retry your edits." }, { status: 409 });

  await owned.db.from("audit_logs").insert({
    workspace_id: owned.company.workspace_id,
    actor_user_id: owned.user.id,
    action: "canonical_profile_updated",
    metadata: { companyId: owned.company.id, analysisRunId: payload.data.canonicalProfile.analysisRunId },
  });
  return NextResponse.json({ confirmed: payload.data.canonicalProfile, confirmedAt });
}
