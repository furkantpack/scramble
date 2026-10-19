import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requested = url.searchParams.get("next");
  const safeNext = requested?.startsWith("/") && !requested.startsWith("//") ? requested : null;
  const loginUrl = new URL("/scouter-founder/login", url.origin);
  if (safeNext) loginUrl.searchParams.set("next", safeNext);
  if (!code) {
    loginUrl.searchParams.set("error", "callback");
    return NextResponse.redirect(loginUrl);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    loginUrl.searchParams.set("error", "session");
    return NextResponse.redirect(loginUrl);
  }
  if (safeNext) return NextResponse.redirect(new URL(safeNext, url.origin));

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/scouter-founder/login", url.origin));
  const { data: profile } = await supabase
    .from("founder_profiles")
    .select("onboarding_completed")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  return NextResponse.redirect(
    new URL(profile?.onboarding_completed ? "/dashboard/founder-dashboard" : "/onboarding", url.origin),
  );
}
