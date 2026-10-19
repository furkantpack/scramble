import { NextResponse } from "next/server";

import { IdentityResolutionError } from "@/lib/identity/app-user";
import { resolveAppUserWithAdmin } from "@/lib/identity/supabase-app-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "invalid_request" }, { status: 403 });
  }
  const body: unknown = await request.json().catch(() => null);
  const companyId = body && typeof body === "object" && "companyId" in body ? body.companyId : null;
  if (typeof companyId !== "string" || !companyId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const identity = await resolveAppUserWithAdmin(user.id, companyId);
    if (identity.role !== "founder_admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ appUserId: identity.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof IdentityResolutionError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "app_user_provisioning_failed" }, { status: 500 });
  }
}
