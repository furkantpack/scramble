import { type NextRequest, NextResponse } from "next/server";

import { createServerClient } from "@supabase/ssr";

const protectedPrefixes = [
  "/dashboard",
  "/onboarding",
  "/introductions",
  "/knowledge-base",
  "/matches/",
  "/activity",
  "/profile",
  "/settings",
  "/scouter-founder/onboarding",
];

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === "/scouter-founder/register" &&
    request.nextUrl.searchParams.get("role") === "investor"
  ) {
    const founderRegistration = request.nextUrl.clone();
    founderRegistration.searchParams.delete("role");
    return NextResponse.redirect(founderRegistration);
  }

  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        for (const cookie of cookies) request.cookies.set(cookie.name, cookie.value);
        response = NextResponse.next({ request });
        for (const cookie of cookies) response.cookies.set(cookie.name, cookie.value, cookie.options);
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && protectedPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix))) {
    const login = request.nextUrl.clone();
    login.pathname = "/scouter-founder/login";
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
