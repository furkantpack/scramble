import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { getApplicationAgentRun, startApplicationFill } from "@/lib/application-agent/service";
import { getApplicationAgentRepository } from "@/lib/application-agent/repository";
import type { ApiActor } from "@/lib/signal-engine/auth";
import { getSkyvernClient } from "@/lib/skyvern/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

const TEST_URL = "https://www.selenium.dev/selenium/web/web-form.html";
const LOCAL_ORIGIN = process.env.CONTROLLED_TEST_ORIGIN?.trim() || "http://localhost:3002";

if (process.env.RUN_CONTROLLED_APPLICATION_TEST !== "true") {
  throw new Error("Set RUN_CONTROLLED_APPLICATION_TEST=true to run this paid-provider smoke test.");
}
if (process.env.CONTROLLED_APPLICATION_TEST_URL !== TEST_URL) {
  throw new Error(`CONTROLLED_APPLICATION_TEST_URL must be exactly ${TEST_URL}`);
}
if (process.env.SKYVERN_AUTO_SUBMIT_ENABLED === "true") {
  throw new Error("Refusing to run while SKYVERN_AUTO_SUBMIT_ENABLED=true.");
}
if (process.env.BROWSER_AGENT_PROVIDER !== "skyvern") {
  throw new Error("BROWSER_AGENT_PROVIDER must be skyvern for this controlled test.");
}

const admin = createSupabaseAdminClient();
const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `scramble-controlled-${suffix}@example.invalid`;
const password = `Sc!${randomBytes(24).toString("base64url")}`;
let authUserId: string | undefined;
let workspaceId: string | undefined;
let companyId: string | undefined;
let appUserId: string | undefined;
let programId: string | undefined;
let applicationId: string | undefined;
let browserSessionId: string | undefined;
const cleanupWarnings: string[] = [];

function phase(name: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ phase: name, ...details }));
}

function requireData<T>(
  result: { data: T; error: { code?: string; message?: string } | null },
  operation: string,
): NonNullable<T> {
  if (result.error || !result.data)
    throw new Error(`${operation} failed (${result.error?.code ?? "missing_data"})`);
  return result.data as NonNullable<T>;
}

async function main() {
  phase("configuration_verified", {
    firecrawl: Boolean(process.env.FIRECRAWL_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    skyvern: Boolean(process.env.SKYVERN_API_KEY),
    autopilot: false,
  });
  if (!process.env.FIRECRAWL_API_KEY || !process.env.GEMINI_API_KEY || !process.env.SKYVERN_API_KEY) {
    throw new Error("One or more paid-provider credentials are missing.");
  }

  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: "Controlled", last_name: "Automation Test" },
  });
  if (createUserError || !createdUser.user)
    throw new Error(`create disposable auth user failed (${createUserError?.code ?? "missing_data"})`);
  const currentAuthUserId = createdUser.user.id;
  authUserId = currentAuthUserId;

  const membership = await waitForMembership(currentAuthUserId);
  const currentWorkspaceId = membership.workspace_id;
  workspaceId = currentWorkspaceId;

  const profileFields = {
    company_name: "Scramble Controlled Automation Test",
    one_liner: "A disposable startup profile used only to verify safe browser automation.",
    product_description: "A temporary test profile for filling the Selenium example form without submitting it.",
    problem: "Application automation needs controlled end-to-end validation.",
    solution: "Use an isolated public sample form and stop before submission.",
    industry: "Software testing",
    market_category: "Developer tools",
    target_customers: "Software teams",
    business_model: "Test-only; no commercial activity",
    pricing: null,
    market_opportunity: null,
    competitors: null,
    differentiation: "Safety-gated Review Mode",
    traction: "Controlled internal test",
    metrics: null,
    founders_team: "Scramble test operator",
    funding_stage: "Not applicable",
    fundraising: null,
    geographic_focus: "Global",
    startup_maturity: "Test fixture",
    technologies: "Browser automation",
    other_relevant_information: "Never submit this form.",
  };
  const company = requireData(
    await admin
      .from("companies")
      .insert({
        workspace_id: currentWorkspaceId,
        name: profileFields.company_name,
        website_url: TEST_URL,
        stage: "idea",
        sector: "Software testing",
        short_description: profileFields.one_liner,
        canonical_profile: { fields: profileFields, analysisRunId: randomUUID() } as Json,
        profile_confirmed_at: new Date().toISOString(),
        profile_confirmed_by: currentAuthUserId,
      })
      .select("id")
      .single(),
    "create disposable company",
  );
  const currentCompanyId = company.id;
  companyId = currentCompanyId;

  const appUser = requireData(
    await admin
      .from("app_users")
      .insert({
        auth_user_id: currentAuthUserId,
        company_id: currentCompanyId,
        name: "Controlled Automation Test",
        email,
        role: "founder_admin",
        status: "active",
      })
      .select("id")
      .single(),
    "create disposable app user",
  );
  const currentAppUserId = appUser.id;
  appUserId = currentAppUserId;

  const program = requireData(
    await admin
      .from("accelerator_programs")
      .insert({
        slug: `controlled-selenium-${suffix}`,
        name: "Controlled Selenium Web Form",
        operator_name: "Selenium",
        program_type: "other",
        description: "Disposable Scramble Review Mode validation target.",
        website_url: TEST_URL,
        application_url: TEST_URL,
        format: "remote",
        stages: [],
        industries: ["Software testing"],
        business_models: [],
        geographies: [],
        benefits: {},
        eligibility: {},
        required_materials: {},
        rolling: true,
        application_open: true,
        source_urls: [TEST_URL],
        last_verified_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
    "create disposable program",
  );
  const currentProgramId = program.id;
  programId = currentProgramId;

  const application = requireData(
    await admin
      .from("accelerator_applications")
      .insert({
        workspace_id: currentWorkspaceId,
        company_id: currentCompanyId,
        accelerator_program_id: currentProgramId,
        program_name_snapshot: "Controlled Selenium Web Form",
        form_url: TEST_URL,
        status: "draft",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
    "create disposable application",
  );
  const currentApplicationId = application.id;
  applicationId = currentApplicationId;
  phase("disposable_fixture_created", { applicationId: currentApplicationId });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Supabase browser configuration is missing.");
  const authClient = createClient<Database>(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: loginData, error: loginError } = await authClient.auth.signInWithPassword({ email, password });
  if (loginError || !loginData.session) throw new Error(`disposable login failed (${loginError?.code ?? "no_session"})`);
  const accessToken = loginData.session.access_token;
  if (process.env.CONTROLLED_REUSE_VERIFIED_DISCOVERY === "true") {
    const extractionId = randomUUID();
    const { data: question, error: questionError } = await admin
      .from("application_questions")
      .insert({
        workspace_id: currentWorkspaceId,
        application_id: currentApplicationId,
        question_label: "Text input",
        field_type: "text",
        field_selector_hint: 'input[name="my-text"]',
        required: false,
        constraints: {
          extractionId,
          source: "controlled_reuse_after_verified_firecrawl_run",
          sourceUrl: TEST_URL,
          evidence: {
            pageUrl: TEST_URL,
            pageTitle: "Web form",
            labelText: "Text input",
            controlType: "text",
            selector: 'input[name="my-text"]',
            step: null,
          },
        },
        order_index: 0,
        external_field_id: "my-text",
      })
      .select("id")
      .single();
    if (questionError || !question) throw new Error(`Verified discovery reuse failed (${questionError?.code ?? "empty"})`);
    const completedAt = new Date().toISOString();
    const { error: auditError } = await admin.from("audit_logs").insert({
      workspace_id: currentWorkspaceId,
      actor_user_id: currentAuthUserId,
      application_id: currentApplicationId,
      action: "application_questions_extracted",
      from_status: "draft",
      to_status: "form_questions_ready",
      metadata: {
        extractionId,
        outcome: "questions",
        questionCount: 1,
        verifiedNoQuestions: false,
        sourceUrl: TEST_URL,
        completedAt,
        controlledReuse: true,
      },
    });
    const { error: readyError } = await admin
      .from("accelerator_applications")
      .update({ status: "form_questions_ready", status_error: null })
      .eq("id", currentApplicationId);
    const { error: answerError } = await admin.from("application_answers").insert({
      workspace_id: currentWorkspaceId,
      application_id: currentApplicationId,
      question_id: question.id,
      answer_text: "Scramble controlled Review Mode test",
      status: "approved",
      generated_from: ["verified Gemini preparation in the preceding controlled run"],
      generation_metadata: { controlledReuse: true },
      approved_by: currentAuthUserId,
      approved_at: completedAt,
    });
    if (auditError || readyError || answerError)
      throw new Error(`Verified preparation reuse failed (${auditError?.code ?? readyError?.code ?? answerError?.code})`);
    phase("verified_preparation_reused", { questionCount: 1, paidDiscoveryCalls: 0, paidGeminiCalls: 0 });
  } else {
    const discovery = await fetch(`${LOCAL_ORIGIN}/api/applications/${currentApplicationId}/questions/discover`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Origin: LOCAL_ORIGIN },
      signal: AbortSignal.timeout(130_000),
    });
    const discoveryBody = (await discovery.json()) as {
      extraction?: { ready?: boolean; questionCount?: number };
      error?: string;
      code?: string;
    };
    if (!discovery.ok || !discoveryBody.extraction?.ready) {
      throw new Error(
        `Firecrawl discovery failed (${discovery.status}:${discoveryBody.code ?? "unknown"}:${discoveryBody.error ?? "unknown"})`,
      );
    }
    phase("firecrawl_discovery_completed", { questionCount: discoveryBody.extraction.questionCount });

    const { data: questions, error: questionsError } = await admin
      .from("application_questions")
      .select("id,question_label,field_type,required,constraints")
      .eq("application_id", currentApplicationId)
      .eq("workspace_id", currentWorkspaceId)
      .order("order_index");
    if (questionsError || !questions?.length)
      throw new Error(`No persisted questions (${questionsError?.code ?? "empty"})`);
    const requiredFile = questions.find(
      (question) => question.required && question.field_type.toLowerCase().includes("file"),
    );
    if (requiredFile) throw new Error(`Controlled form unexpectedly requires a file: ${requiredFile.question_label}`);
    const candidates = questions.filter(
      (question) => !question.field_type.toLowerCase().includes("file") && !/password/i.test(question.question_label),
    );
    const primary =
      candidates.find((question) => /text input|textarea|email|url/i.test(question.question_label)) ?? candidates[0];
    if (!primary) throw new Error("No safe answerable question was extracted.");
    const targets = [primary, ...candidates.filter((question) => question.required && question.id !== primary.id)];

    const login = await fetch(`${LOCAL_ORIGIN}/api/auth/password-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: LOCAL_ORIGIN },
      body: JSON.stringify({ email, password, next: "/introductions" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!login.ok) throw new Error(`App login failed (${login.status})`);
    const cookieHeader = login.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    if (!cookieHeader) throw new Error("App login did not return a session cookie.");

    for (const question of targets) {
      const response = await fetch(
        `${LOCAL_ORIGIN}/api/applications/${currentApplicationId}/questions/${question.id}/suggest`,
        {
          method: "POST",
          headers: { Cookie: cookieHeader, Origin: LOCAL_ORIGIN },
          signal: AbortSignal.timeout(75_000),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(`Gemini answer preparation failed (${response.status}:${body.error ?? "unknown"})`);
      }
    }
    const { data: preparedAnswers, error: preparedError } = await admin
      .from("application_answers")
      .select("id,question_id,answer_text")
      .eq("application_id", currentApplicationId)
      .in(
        "question_id",
        targets.map((question) => question.id),
      );
    if (preparedError || !preparedAnswers?.length || preparedAnswers.some((answer) => !answer.answer_text?.trim())) {
      throw new Error(`Gemini did not persist usable answers (${preparedError?.code ?? "empty_answer"})`);
    }
    const { error: approvalError } = await admin
      .from("application_answers")
      .update({ status: "approved", approved_by: currentAuthUserId, approved_at: new Date().toISOString() })
      .in(
        "id",
        preparedAnswers.map((answer) => answer.id),
      );
    if (approvalError) throw new Error(`Answer approval failed (${approvalError.code})`);
    phase("gemini_answers_prepared", { generatedAndApprovedForTest: preparedAnswers.length });
  }

  const actor: ApiActor = {
    authUserId: currentAuthUserId,
    appUserId: currentAppUserId,
    workspaceId: currentWorkspaceId,
    companyId: currentCompanyId,
    role: "founder_admin",
  };
  const started = await startApplicationFill(actor, currentApplicationId, { formUrl: TEST_URL, version: 1, files: [] });
  const storedRun = await getApplicationAgentRepository().getRun(started.id);
  browserSessionId = storedRun?.browserSessionId;
  phase("skyvern_review_mode_started", {
    runId: started.id,
    status: started.status,
    liveViewUrlPresent: Boolean(started.liveViewUrl),
    runUrlPresent: Boolean(started.runUrl),
  });

  const publicRunResponse = await fetch(`${LOCAL_ORIGIN}/api/applications/${currentApplicationId}/agent-run`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const publicRunBody = (await publicRunResponse.json()) as { run?: { liveViewUrl?: string; runUrl?: string } };
  if (!publicRunResponse.ok || (!publicRunBody.run?.liveViewUrl && !publicRunBody.run?.runUrl)) {
    throw new Error(`Watch Agent Live URL was not exposed by the application API (${publicRunResponse.status})`);
  }
  const viewerUrl = publicRunBody.run.liveViewUrl ?? publicRunBody.run.runUrl;
  if (!viewerUrl) throw new Error("Skyvern viewer URL is missing.");
  const viewer = await fetch(viewerUrl, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  if (viewer.status >= 500) throw new Error(`Skyvern viewer URL returned ${viewer.status}`);
  phase("watch_agent_live_verified", {
    source: publicRunBody.run.liveViewUrl ? "browser_session" : "run_page",
    httpStatus: viewer.status,
    host: new URL(viewerUrl).host,
  });

  let finalRun = await getApplicationAgentRun(actor, currentApplicationId);
  let lastStatus = "";
  const deadline = Date.now() + 10 * 60_000;
  while (!["completed", "failed", "cancelled"].includes(finalRun.status) && Date.now() < deadline) {
    if (finalRun.status !== lastStatus) {
      phase("skyvern_status", {
        status: finalRun.status,
        action: finalRun.currentAction,
        stepCount: finalRun.stepCount,
        requiresHumanInput: finalRun.requiresHumanInput,
      });
      lastStatus = finalRun.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 8_000));
    finalRun = await getApplicationAgentRun(actor, currentApplicationId);
  }
  if (!["completed", "failed", "cancelled"].includes(finalRun.status)) {
    throw new Error("Skyvern Review Mode did not reach a terminal state within ten minutes.");
  }

  const [{ count: submitRuns }, { data: finalApplication }] = await Promise.all([
    admin.from("browser_agent_runs").select("id", { count: "exact", head: true }).eq("application_id", currentApplicationId).eq("mode", "submit"),
    admin.from("accelerator_applications").select("status,submitted_at").eq("id", currentApplicationId).single(),
  ]);
  if ((submitRuns ?? 0) !== 0 || finalApplication?.submitted_at || finalApplication?.status === "submitted") {
    throw new Error("Safety invariant violated: a submission operation was recorded.");
  }
  phase("controlled_test_finished", {
    status: finalRun.status,
    applicationState: finalRun.applicationState,
    errorCode: finalRun.errorCode,
    requiresHumanInput: finalRun.requiresHumanInput,
    submitRuns: submitRuns ?? 0,
    submitted: false,
  });
  if (finalRun.status !== "completed" || finalRun.applicationState !== "AGENT_FILLED_PENDING_FINAL_APPROVAL") {
    throw new Error(`Skyvern fill did not become review-ready (${finalRun.errorCode ?? finalRun.status})`);
  }
}

async function waitForMembership(userId: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await admin
      .from("workspace_members")
      .select("workspace_id,role")
      .eq("user_id", userId)
      .eq("role", "owner")
      .maybeSingle();
    if (data) return data;
    if (error) throw new Error(`read disposable workspace failed (${error.code})`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The auth trigger did not create the disposable workspace owner membership.");
}

async function cleanup() {
  if (browserSessionId) {
    try {
      await getSkyvernClient().closeBrowserSession(browserSessionId, { timeoutInSeconds: 20, maxRetries: 0 });
    } catch {
      cleanupWarnings.push("skyvern_session_close_failed");
    }
  }
  const remove = async (table: keyof Database["public"]["Tables"], column: string, value?: string) => {
    if (!value) return;
    const { error } = await admin.from(table).delete().eq(column, value);
    if (error) cleanupWarnings.push(`${table}:${error.code}`);
  };
  if (applicationId) {
    await remove("application_submit_authorizations", "application_id", applicationId);
    await remove("application_dispatch_jobs", "application_id", applicationId);
    await remove("browser_agent_runs", "application_id", applicationId);
    await remove("application_answers", "application_id", applicationId);
    await remove("application_questions", "application_id", applicationId);
    await remove("audit_logs", "application_id", applicationId);
    await remove("accelerator_applications", "id", applicationId);
  }
  await remove("accelerator_programs", "id", programId);
  await remove("app_users", "id", appUserId);
  await remove("companies", "id", companyId);
  if (workspaceId) {
    await remove("notifications", "workspace_id", workspaceId);
    await remove("source_analysis_jobs", "workspace_id", workspaceId);
    await remove("scrape_snapshots", "workspace_id", workspaceId);
    await remove("founder_needs", "workspace_id", workspaceId);
    await remove("founder_profiles", "workspace_id", workspaceId);
    await remove("usage_counters", "workspace_id", workspaceId);
    await remove("workspace_members", "workspace_id", workspaceId);
    await remove("workspaces", "id", workspaceId);
  }
  await remove("profiles", "id", authUserId);
  if (authUserId) {
    const { error } = await admin.auth.admin.deleteUser(authUserId);
    if (error) cleanupWarnings.push(`auth_user:${error.code ?? "unknown"}`);
  }
  phase("cleanup_finished", { clean: cleanupWarnings.length === 0, warnings: cleanupWarnings });
}

async function run() {
  let failed = false;
  try {
    await main();
  } catch (error) {
    failed = true;
    phase("controlled_test_failed", { error: error instanceof Error ? error.message : "unknown_error" });
  } finally {
    await cleanup();
  }
  if (failed) process.exitCode = 1;
}

void run();
