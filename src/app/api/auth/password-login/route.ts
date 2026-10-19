import { type NextRequest, NextResponse } from "next/server";

import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "invalid_request" }, { status: 403 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { email, password, next } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "configuration_error" }, { status: 503 });
  }

  const cookieWrites: Array<(response: NextResponse) => void> = [];
  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        cookieWrites.push((response) => {
          for (const { name, value, options } of values) response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return NextResponse.json(
      { error: error?.code ?? "login_failed" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { data: profile } = await supabase
    .from("founder_profiles")
    .select("onboarding_completed")
    .eq("user_id", data.user.id)
    .limit(1)
    .maybeSingle();
  let destination = profile?.onboarding_completed ? "/dashboard/founder-dashboard" : "/onboarding";
  if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) {
    destination = next;
  }

  const response = NextResponse.json({ next: destination }, { headers: { "Cache-Control": "no-store" } });
  for (const writeCookies of cookieWrites) writeCookies(response);
  return response;
}
