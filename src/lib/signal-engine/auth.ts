import "server-only";

import { createClient } from "@supabase/supabase-js";

import { type AppRole, IdentityResolutionError, type ResolvedAppUserIdentity } from "@/lib/identity/app-user";
import { resolveAppUserWithAdmin } from "@/lib/identity/supabase-app-user";
import type { Database } from "@/types/database";

import { ApiError } from "./http";

export type { AppRole } from "@/lib/identity/app-user";

export interface ApiActor {
  authUserId: string;
  appUserId: string;
  workspaceId: string;
  companyId: string;
  role: AppRole;
}

export async function requireApiActor(request: Request, allowedRoles?: AppRole[]): Promise<ApiActor> {
  const accessToken = bearerToken(request);
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError(500, "Authentication is not configured", "auth_configuration_missing");
  const authClient = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) throw new ApiError(401, "Sign in is required", "unauthorized");

  let identity: ResolvedAppUserIdentity;
  try {
    identity = await resolveAppUserWithAdmin(authData.user.id);
  } catch (error) {
    if (error instanceof IdentityResolutionError) throw new ApiError(error.status, error.message, error.code);
    throw error;
  }
  if (allowedRoles && !allowedRoles.includes(identity.role)) {
    throw new ApiError(403, "Your role cannot perform this action", "forbidden");
  }

  return {
    authUserId: authData.user.id,
    appUserId: identity.id,
    workspaceId: identity.workspaceId,
    companyId: identity.companyId,
    role: identity.role,
  };
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (!match?.[1] || match[1].length > 8192) {
    throw new ApiError(401, "Sign in is required", "unauthorized");
  }
  return match[1];
}
