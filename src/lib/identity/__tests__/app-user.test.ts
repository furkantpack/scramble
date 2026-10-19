import {
  type AppUserIdentity,
  type AppUserIdentityRepository,
  type CompanyIdentity,
  type IdentityProfile,
  IdentityResolutionError,
  type NewAppUser,
  resolveAppUserIdentity,
  type WorkspaceMembership,
} from "../app-user";
import assert from "node:assert/strict";
import test from "node:test";

class MemoryIdentityRepository implements AppUserIdentityRepository {
  memberships: WorkspaceMembership[] = [];
  companies: CompanyIdentity[] = [];
  appUsers: AppUserIdentity[] = [];
  profile: IdentityProfile = { email: "founder@example.com", name: "Ada Founder" };
  inserts = 0;

  async listMemberships() {
    return this.memberships;
  }

  async listCompanies(workspaceId: string) {
    return this.companies.filter((company) => company.workspaceId === workspaceId);
  }

  async getCompany(companyId: string) {
    return this.companies.find((company) => company.id === companyId) ?? null;
  }

  async getAppUser(authUserId: string) {
    return this.appUsers.find((appUser) => appUser.authUserId === authUserId) ?? null;
  }

  async getIdentityProfile() {
    return this.profile;
  }

  async insertAppUser(input: NewAppUser) {
    this.inserts += 1;
    if (this.appUsers.some((appUser) => appUser.authUserId === input.authUserId)) return null;
    const appUser: AppUserIdentity = {
      id: `app-user-${this.appUsers.length + 1}`,
      authUserId: input.authUserId,
      companyId: input.companyId,
      role: input.role,
      status: "active",
    };
    this.appUsers.push(appUser);
    return appUser;
  }
}

function repositoryWithMembership() {
  const repository = new MemoryIdentityRepository();
  repository.memberships = [{ workspaceId: "workspace-a", role: "owner" }];
  return repository;
}

test("new signup is not provisioned before a company exists", async () => {
  const repository = repositoryWithMembership();
  await assert.rejects(resolveAppUserIdentity(repository, "auth-a"), errorWithCode("company_required"));
  assert.equal(repository.inserts, 0);
  assert.deepEqual(repository.appUsers, []);
});

test("company onboarding provisions the authenticated workspace owner", async () => {
  const repository = repositoryWithMembership();
  repository.companies = [{ id: "company-a", workspaceId: "workspace-a" }];

  const identity = await resolveAppUserIdentity(repository, "auth-a", "company-a");

  assert.equal(identity.id, "app-user-1");
  assert.equal(identity.companyId, "company-a");
  assert.equal(identity.role, "founder_admin");
  assert.equal(repository.inserts, 1);
});

test("existing user is reused without changing its identity or role", async () => {
  const repository = repositoryWithMembership();
  repository.companies = [{ id: "company-a", workspaceId: "workspace-a" }];
  repository.appUsers = [
    { id: "existing-app-user", authUserId: "auth-a", companyId: "company-a", role: "team_lead", status: "active" },
  ];

  const identity = await resolveAppUserIdentity(repository, "auth-a");

  assert.equal(identity.id, "existing-app-user");
  assert.equal(identity.role, "team_lead");
  assert.equal(repository.inserts, 0);
});

test("repeated provisioning is idempotent", async () => {
  const repository = repositoryWithMembership();
  repository.companies = [{ id: "company-a", workspaceId: "workspace-a" }];

  const first = await resolveAppUserIdentity(repository, "auth-a", "company-a");
  const second = await resolveAppUserIdentity(repository, "auth-a", "company-a");

  assert.equal(first.id, second.id);
  assert.equal(repository.inserts, 1);
  assert.equal(repository.appUsers.length, 1);
});

test("an explicit missing company never provisions a user", async () => {
  const repository = repositoryWithMembership();
  await assert.rejects(
    resolveAppUserIdentity(repository, "auth-a", "missing-company"),
    errorWithCode("company_required"),
  );
  assert.equal(repository.inserts, 0);
});

test("cross-company access and reassignment are rejected", async () => {
  const repository = repositoryWithMembership();
  repository.companies = [
    { id: "company-a", workspaceId: "workspace-a" },
    { id: "company-b", workspaceId: "workspace-b" },
  ];
  repository.appUsers = [
    { id: "existing-app-user", authUserId: "auth-a", companyId: "company-a", role: "founder_admin", status: "active" },
  ];

  await assert.rejects(
    resolveAppUserIdentity(repository, "auth-a", "company-b"),
    errorWithCode("company_access_denied"),
  );

  repository.memberships.push({ workspaceId: "workspace-b", role: "owner" });
  await assert.rejects(
    resolveAppUserIdentity(repository, "auth-a", "company-b"),
    errorWithCode("app_user_company_conflict"),
  );
  assert.equal(repository.appUsers[0].companyId, "company-a");
  assert.equal(repository.inserts, 0);
});

function errorWithCode(code: string) {
  return (error: unknown) => error instanceof IdentityResolutionError && error.code === code;
}
