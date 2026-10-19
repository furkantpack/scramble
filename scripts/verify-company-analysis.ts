// Live integration check. Creates only a disposable test account/workspace and removes it.
// Run: node --conditions=react-server --import tsx scripts/verify-company-analysis.ts

import { createServerClient } from "@supabase/ssr";

import { KNOWLEDGE_CATEGORIES } from "../src/lib/gemini/types";
import { saveGeneratedKnowledge } from "../src/lib/knowledge/save-generated-knowledge";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

async function main() {
  process.loadEnvFile(".env.local");
  const admin = createSupabaseAdminClient();
  let userId: string | undefined;
  let workspaceId: string | undefined;
  const jar = new Map<string, string>();
  const base = process.env.APP_BASE_URL || "http://127.0.0.1:3000";
  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (items) => {
          for (const item of items) jar.set(item.name, item.value);
        },
      },
    },
  );
  const headers = () => ({ Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "), Origin: base });
  const check = (error: { code?: string } | null, step: string) => {
    if (error) throw new Error(`${step} failed (${error.code ?? "unknown"})`);
  };
  try {
    const email = `codex-firecrawl-${Date.now()}@example.com`;
    const password = `Test-${randomUUID()}-Aa1!`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: "Integration", last_name: "Test", product: "scouter-founder" },
    });
    check(created.error, "test registration");
    userId = created.data.user!.id;
    check((await client.auth.signInWithPassword({ email, password })).error, "test login");
    const membership = await client.from("workspace_members").select("workspace_id").eq("user_id", userId).single();
    check(membership.error, "workspace");
    workspaceId = membership.data!.workspace_id;
    const profile = await client
      .from("founder_profiles")
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        first_name: "Integration",
        last_name: "Test",
        linkedin_url: "https://www.linkedin.com/in/integration-test",
      })
      .select("id")
      .single();
    check(profile.error, "founder profile");
    const company = await client
      .from("companies")
      .insert({
        workspace_id: workspaceId,
        name: "Firecrawl integration verification",
        website_url: "https://www.firecrawl.dev",
        stage: "pre_seed",
      })
      .select("id")
      .single();
    check(company.error, "company");
    const companyId = company.data!.id;
    check(
      (
        await client
          .from("founder_needs")
          .insert({ workspace_id: workspaceId, founder_profile_id: profile.data!.id, need: "just_exploring" })
      ).error,
      "founder needs",
    );
    check(
      (await client.rpc("complete_founder_onboarding", { target_workspace_id: workspaceId })).error,
      "onboarding completion",
    );
    console.log("PASS: authenticated test account, founder/company/needs saved, onboarding completion validated");
    const forbidden = await fetch(`${base}/api/companies/${randomUUID()}/analyze`, {
      method: "POST",
      headers: headers(),
    });
    assert.equal(forbidden.status, 404);
    const anonymous = await fetch(`${base}/api/companies/${companyId}/analyze`, { method: "POST" });
    assert.ok([401, 404].includes(anonymous.status));
    console.log("PASS: unauthorized and unknown-company analysis rejected");
    const endpoint = `${base}/api/companies/${companyId}/analyze`;
    const start = await fetch(endpoint, { method: "POST", headers: headers() });
    assert.equal(start.status, 202, `analysis start returned ${start.status}`);
    const started = await start.json();
    const duplicate = await fetch(endpoint, { method: "POST", headers: headers() });
    const duplicateBody = await duplicate.json();
    assert.equal(duplicateBody.runId, started.runId);
    assert.equal(duplicateBody.accepted, false);
    console.log("PASS: 202 background dispatch; duplicate run suppressed");
    let state = started;
    const deadline = Date.now() + 290_000;
    while (["scraping", "generating"].includes(state.state) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const response = await fetch(endpoint, { headers: headers() });
      assert.equal(response.status, 200);
      state = await response.json();
    }
    const snapshots = await client
      .from("scrape_snapshots")
      .select("source_url,raw_markdown,raw_json")
      .eq("company_id", companyId);
    check(snapshots.error, "snapshots read");
    assert.ok(snapshots.data!.length > 0, `no snapshots; state ${state.state}, safe code ${state.errorCode}`);
    assert.ok(snapshots.data!.length <= 10);
    const usage = await admin
      .from("usage_counters")
      .select("firecrawl_calls_this_month")
      .eq("workspace_id", workspaceId)
      .single();
    assert.ok(usage.data!.firecrawl_calls_this_month > 0);
    console.log(
      `PASS: real Firecrawl website acquisition; ${snapshots.data!.length} snapshots stored; ${usage.data!.firecrawl_calls_this_month} API calls counted`,
    );
    if (!process.env.GEMINI_API_KEY) {
      assert.equal(state.state, "failed");
      assert.equal(state.errorCode, "GEMINI_AUTH_ERROR");
      console.log("EXPECTED BLOCKER: live Gemini unavailable (GEMINI_API_KEY missing); onboarding/evidence preserved");
    } else {
      assert.equal(state.state, "ready", `generation failed (${state.errorCode})`);
      const generated = await client
        .from("knowledge_base_entries")
        .select("id,category,content")
        .eq("company_id", companyId);
      check(generated.error, "generated knowledge read");
      assert.deepEqual(
        new Set(generated.data!.map((entry) => entry.category)),
        new Set(KNOWLEDGE_CATEGORIES),
      );
      assert.ok(generated.data!.some((entry) => entry.content?.trim()));
      const generatedSources = await client
        .from("knowledge_sources")
        .select("knowledge_entry_id")
        .in(
          "knowledge_entry_id",
          generated.data!.map((entry) => entry.id),
        );
      check(generatedSources.error, "generated evidence read");
      assert.ok(generatedSources.data!.length > 0);
      console.log(
        `PASS: live Gemini produced ${generated.data!.length} Knowledge sections with ${generatedSources.data!.length} evidence links`,
      );
    }
    const afterProfile = await client
      .from("founder_profiles")
      .select("onboarding_completed")
      .eq("id", profile.data!.id)
      .single();
    assert.equal(afterProfile.data!.onboarding_completed, true);
    const source = snapshots.data![0];
    // Persistence contract test with an explicitly synthetic Gemini result, not a live LLM claim.
    const protectedEntry = await admin
      .from("knowledge_base_entries")
      .insert({
        workspace_id: workspaceId,
        company_id: companyId,
        category: "problem",
        source_type: "manual",
        content: "Founder-approved content",
        status: "approved",
        version: 100,
        approved_by: userId,
        approved_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    check(protectedEntry.error, "protected fixture");
    const saved = await saveGeneratedKnowledge(
      admin,
      { workspaceId, companyId },
      {
        model: "integration-fixture-not-live-gemini",
        usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
        result: {
          companySummary: "Test fixture",
          sections: KNOWLEDGE_CATEGORIES.map((category) => ({
            category,
            status: "needs_review",
            content: `Integration fixture: ${category}`,
            confidence: 0.5,
            evidence: [
              {
                sourceUrl: source.source_url,
                sourceLabel: "Website test evidence",
                evidenceType: "direct",
                excerpt: source.raw_markdown!.slice(0, 100),
              },
            ],
            missingInformation: [],
            notes: [],
          })),
        },
      },
    );
    assert.equal(saved.length, 9);
    assert.equal(saved.find((section) => section.category === "problem")?.disposition, "proposal");
    const original = await client
      .from("knowledge_base_entries")
      .select("content,status")
      .eq("id", protectedEntry.data!.id)
      .single();
    assert.equal(original.data!.content, "Founder-approved content");
    assert.equal(original.data!.status, "approved");
    const sources = await client
      .from("knowledge_sources")
      .select("knowledge_entry_id")
      .in(
        "knowledge_entry_id",
        saved.map((section) => section.entryId),
      );
    assert.equal(sources.data?.length, 9);
    console.log(
      "PASS: synthetic generation persists all nine sections with linked evidence; approved content remains unchanged",
    );
  } finally {
    if (workspaceId)
      check((await admin.from("workspaces").delete().eq("id", workspaceId)).error, "test workspace cleanup");
    if (userId) check((await admin.auth.admin.deleteUser(userId)).error, "test user cleanup");
    console.log("Disposable test records removed.");
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Integration check failed (provider payload withheld)");
  process.exitCode = 1;
});
