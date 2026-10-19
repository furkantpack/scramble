import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

import {
  type AppUserIdentity,
  type AppUserIdentityRepository,
  type IdentityProfile,
  type NewAppUser,
  type ResolvedAppUserIdentity,
  resolveAppUserIdentity,
  type WorkspaceMembership,
} from "./app-user";

type AdminClient = SupabaseClient<Database>;

export function createAppUserIdentityRepository(db: AdminClient): AppUserIdentityRepository {
  return {
    async listMemberships(authUserId) {
      const { data, error } = await db
        .from("workspace_members")
        .select("workspace_id,role")
        .eq("user_id", authUserId)
        .limit(3);
      if (error) throw error;
      return (data ?? []).map((row) => ({ workspaceId: row.workspace_id, role: row.role })) as WorkspaceMembership[];
    },
    async listCompanies(workspaceId) {
      const { data, error } = await db
        .from("companies")
        .select("id,workspace_id")
        .eq("workspace_id", workspaceId)
        .limit(3);
      if (error) throw error;
      return (data ?? []).map((row) => ({ id: row.id, workspaceId: row.workspace_id }));
    },
    async getCompany(companyId) {
      const { data, error } = await db.from("companies").select("id,workspace_id").eq("id", companyId).maybeSingle();
      if (error) throw error;
      return data ? { id: data.id, workspaceId: data.workspace_id } : null;
    },
    async getAppUser(authUserId) {
      const { data, error } = await db
        .from("app_users")
        .select("id,auth_user_id,company_id,role,status")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
      if (error) throw error;
      return data?.auth_user_id ? mapAppUser(data) : null;
    },
    async getIdentityProfile(authUserId, workspaceId) {
      const [{ data: profile }, { data: founder }, authResult] = await Promise.all([
        db.from("profiles").select("email").eq("id", authUserId).maybeSingle(),
        db
          .from("founder_profiles")
          .select("first_name,last_name")
          .eq("workspace_id", workspaceId)
          .eq("user_id", authUserId)
          .maybeSingle(),
        db.auth.admin.getUserById(authUserId),
      ]);
      const metadata = authResult.data.user?.user_metadata;
      const metadataName = [metadata?.first_name, metadata?.last_name]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" ");
      const founderName = founder ? `${founder.first_name} ${founder.last_name}`.trim() : "";
      return {
        email: profile?.email ?? authResult.data.user?.email ?? null,
        name: founderName || metadataName || null,
      } satisfies IdentityProfile;
    },
    async insertAppUser(input) {
      const { data, error } = await db
        .from("app_users")
        .insert({
          auth_user_id: input.authUserId,
          company_id: input.companyId,
          email: input.email,
          name: input.name,
          role: input.role,
          status: "active",
        })
        .select("id,auth_user_id,company_id,role,status")
        .single();
      if (error?.code === "23505") return null;
      if (error) throw error;
      return data.auth_user_id ? mapAppUser(data) : null;
    },
  };
}

export async function resolveAppUserWithAdmin(
  authUserId: string,
  targetCompanyId?: string,
  db = createSupabaseAdminClient(),
): Promise<ResolvedAppUserIdentity> {
  return resolveAppUserIdentity(createAppUserIdentityRepository(db), authUserId, targetCompanyId);
}

function mapAppUser(row: {
  id: string;
  auth_user_id: string | null;
  company_id: string;
  role: NewAppUser["role"];
  status: string;
}): AppUserIdentity {
  if (!row.auth_user_id) throw new Error("An authenticated app user must have auth_user_id");
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    companyId: row.company_id,
    role: row.role,
    status: row.status,
  };
}
