export const appRoles = ["founder_admin", "team_lead", "contributor", "viewer_investor"] as const;
export type AppRole = (typeof appRoles)[number];

export type WorkspaceMembership = {
  workspaceId: string;
  role: "owner" | "member";
};

export type CompanyIdentity = {
  id: string;
  workspaceId: string;
};

export type AppUserIdentity = {
  id: string;
  authUserId: string;
  companyId: string;
  role: AppRole;
  status: string;
};

export type IdentityProfile = {
  email: string | null;
  name: string | null;
};

export type NewAppUser = {
  authUserId: string;
  companyId: string;
  email: string;
  name: string;
  role: AppRole;
};

export interface AppUserIdentityRepository {
  listMemberships(authUserId: string): Promise<WorkspaceMembership[]>;
  listCompanies(workspaceId: string): Promise<CompanyIdentity[]>;
  getCompany(companyId: string): Promise<CompanyIdentity | null>;
  getAppUser(authUserId: string): Promise<AppUserIdentity | null>;
  getIdentityProfile(authUserId: string, workspaceId: string): Promise<IdentityProfile>;
  insertAppUser(input: NewAppUser): Promise<AppUserIdentity | null>;
}

export class IdentityResolutionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IdentityResolutionError";
  }
}

export type ResolvedAppUserIdentity = AppUserIdentity & {
  workspaceId: string;
};

export async function resolveAppUserIdentity(
  repository: AppUserIdentityRepository,
  authUserId: string,
  targetCompanyId?: string,
): Promise<ResolvedAppUserIdentity> {
  const memberships = await repository.listMemberships(authUserId);
  if (memberships.length === 0) {
    throw new IdentityResolutionError(403, "workspace_required", "This account is not part of a workspace");
  }

  const context = targetCompanyId
    ? await resolveExplicitCompany(repository, memberships, targetCompanyId)
    : await resolveImplicitCompany(repository, memberships);

  let appUser = await repository.getAppUser(authUserId);
  if (appUser && appUser.companyId !== context.company.id) {
    throw new IdentityResolutionError(
      409,
      "app_user_company_conflict",
      "This account is already linked to a different company",
    );
  }

  if (!appUser) {
    const profile = await repository.getIdentityProfile(authUserId, context.membership.workspaceId);
    const email = profile.email?.trim();
    if (!email) {
      throw new IdentityResolutionError(
        409,
        "app_user_profile_incomplete",
        "An email is required to create an app user",
      );
    }
    const name = profile.name?.trim() || email.split("@")[0];
    const role = membershipRole(context.membership.role);
    appUser = await repository.insertAppUser({ authUserId, companyId: context.company.id, email, name, role });
    if (!appUser) appUser = await repository.getAppUser(authUserId);
  }

  if (!appUser || appUser.companyId !== context.company.id) {
    throw new IdentityResolutionError(
      409,
      "app_user_company_conflict",
      "The app user could not be linked to this company",
    );
  }
  if (appUser.status !== "active") {
    throw new IdentityResolutionError(403, "app_user_inactive", "This app user is not active");
  }

  return { ...appUser, workspaceId: context.membership.workspaceId };
}

async function resolveExplicitCompany(
  repository: AppUserIdentityRepository,
  memberships: WorkspaceMembership[],
  companyId: string,
) {
  const company = await repository.getCompany(companyId);
  if (!company) throw new IdentityResolutionError(409, "company_required", "Complete founder onboarding first");
  const matching = memberships.filter((membership) => membership.workspaceId === company.workspaceId);
  if (matching.length !== 1) {
    throw new IdentityResolutionError(403, "company_access_denied", "This account cannot access the company");
  }
  return { membership: matching[0], company };
}

async function resolveImplicitCompany(repository: AppUserIdentityRepository, memberships: WorkspaceMembership[]) {
  if (memberships.length !== 1) {
    throw new IdentityResolutionError(409, "identity_context_ambiguous", "Select a company before using this feature");
  }
  const membership = memberships[0];
  const companies = await repository.listCompanies(membership.workspaceId);
  if (companies.length === 0) {
    throw new IdentityResolutionError(409, "company_required", "Complete founder onboarding first");
  }
  if (companies.length !== 1) {
    throw new IdentityResolutionError(409, "identity_context_ambiguous", "Select a company before using this feature");
  }
  return { membership, company: companies[0] };
}

function membershipRole(role: WorkspaceMembership["role"]): AppRole {
  return role === "owner" ? "founder_admin" : "contributor";
}
