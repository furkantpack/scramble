// Live smoke test: creates a disposable founder workspace and removes it.
// Run: node --conditions=react-server --import tsx scripts/verify-founder-dashboard.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createServerClient } from "@supabase/ssr";

import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

async function main() {
  process.loadEnvFile(".env.local");
  const admin = createSupabaseAdminClient();
  const jar = new Map<string, string>();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase public configuration missing");
  const client = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (items) => { for (const item of items) jar.set(item.name, item.value); },
    },
  });
  let userId: string | undefined;
  let workspaceId: string | undefined;
  try {
    const email = `codex-dashboard-${Date.now()}@example.com`;
    const password = `Test-${randomUUID()}-Aa1!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Test account creation failed");
    userId = created.data.user.id;
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error("Test login failed");
    const membership = await client.from("workspace_members").select("workspace_id").eq("user_id", userId).single();
    if (membership.error || !membership.data) throw new Error("Test workspace unavailable");
    workspaceId = membership.data.workspace_id;
    const founder = await client.from("founder_profiles").insert({ workspace_id: workspaceId, user_id: userId, first_name: "Ada", last_name: "Example", linkedin_url: null }).select("id").single();
    if (founder.error || !founder.data) throw new Error("Test founder creation failed");
    const company = await client.from("companies").insert({ workspace_id: workspaceId, name: "Dashboard Test Company", stage: "pre_seed" });
    if (company.error) throw new Error("Test company creation failed");
    const need = await client.from("founder_needs").insert({ workspace_id: workspaceId, founder_profile_id: founder.data.id, need: "just_exploring" });
    if (need.error) throw new Error("Test need creation failed");
    const complete = await client.rpc("complete_founder_onboarding", { target_workspace_id: workspaceId });
    if (complete.error) throw new Error("Test onboarding completion failed");
    const base = process.env.APP_BASE_URL || "http://127.0.0.1:3000";
    const response = await fetch(`${base}/dashboard/founder-dashboard`, {
      headers: { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") },
      redirect: "manual",
    });
    assert.equal(response.status, 200, `dashboard returned ${response.status}`);
    const html = await response.text();
    assert.match(html, /Welcome back, Ada/);
    assert.match(html, /Your application workspace/);
    assert.match(html, /Let&#x27;s find your first opportunities|Let.s find your first opportunities/);
    assert.doesNotMatch(html, /Investor fit by focus|My fundraising summary/);
    console.log("PASS: authenticated empty-state dashboard uses real Supabase data and application positioning");
    const profileResponse = await fetch(`${base}/profile`, {
      headers: { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") },
      redirect: "manual",
    });
    assert.equal(profileResponse.status, 200, `profile returned ${profileResponse.status}`);
    assert.match(await profileResponse.text(), /Your application profile/);
    console.log("PASS: founder profile action opens the editable application profile");
  } finally {
    if (workspaceId) {
      const removed = await admin.from("workspaces").delete().eq("id", workspaceId);
      if (removed.error) { console.error("Test workspace cleanup failed"); process.exitCode = 1; }
    }
    if (userId) {
      const removed = await admin.auth.admin.deleteUser(userId);
      if (removed.error) { console.error("Test account cleanup failed"); process.exitCode = 1; }
    }
    console.log("Disposable dashboard test records removed.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Dashboard verification failed");
  process.exitCode = 1;
});
