import { GET as applicationCron } from "../../../app/api/cron/application-agent/route";
import { resetSkyvernClientForTests } from "../../skyvern/client";
import { buildFillPrompt } from "../../skyvern/fill-application";
import { normalizeSkyvernRun } from "../../skyvern/get-run";
import { MockBrowserAgentProvider } from "../mock-provider";
import { getBrowserAgentProvider } from "../provider";
import { applicationAgentRepository, createPendingRun } from "../repository";
import { isActiveRunExpired } from "../service";
import { assertSafePublicHttpUrl } from "../url-safety";
import assert from "node:assert/strict";
import test from "node:test";

test("mock fill and submit remain separate runs", async () => {
  const provider = new MockBrowserAgentProvider();
  const fill = await provider.startFill({
    applicationId: "yc",
    formUrl: "https://example.com/apply",
    answers: [{ question: "What do you build?", value: "A safe application agent." }],
  });
  const completedFill = await provider.getRun({ ...fill, createdAt: new Date(Date.now() - 5_000).toISOString() });

  assert.equal(completedFill.mode, "fill");
  assert.equal(completedFill.status, "completed");
  assert.equal(completedFill.submissionEvidence, undefined);

  const submit = await provider.submit({ applicationId: "yc", previousRunId: fill.externalRunId });
  const completedSubmit = await provider.getRun({ ...submit, createdAt: new Date(Date.now() - 5_000).toISOString() });
  assert.equal(completedSubmit.mode, "submit");
  assert.equal(completedSubmit.submissionEvidence?.confirmed, true);
  assert.notEqual(completedSubmit.externalRunId, completedFill.externalRunId);
});

test("idempotency claims only one operation", async () => {
  const key = `submit:test:${Date.now()}`;
  const first = await applicationAgentRepository.claimRun(createPendingRun("yc", "submit"), key);
  const second = await applicationAgentRepository.claimRun(createPendingRun("yc", "submit"), key);
  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(second.run.id, first.run.id);
});

test("mock applications are isolated per workspace", async () => {
  const workspaceA = await applicationAgentRepository.getOwnedApplication("yc", "workspace-a");
  const workspaceB = await applicationAgentRepository.getOwnedApplication("yc", "workspace-b");
  assert.ok(workspaceA);
  assert.ok(workspaceB);
  assert.equal(workspaceA.workspaceId, "workspace-a");
  assert.equal(workspaceB.workspaceId, "workspace-b");
});

test("live provider is explicit and missing credentials never fall back to mock", () => {
  const prior = process.env.SKYVERN_API_KEY;
  delete process.env.SKYVERN_API_KEY;
  resetSkyvernClientForTests();
  assert.throws(() => getBrowserAgentProvider(""), /BROWSER_AGENT_PROVIDER/);
  assert.throws(() => getBrowserAgentProvider("skyvern"), /SKYVERN_API_KEY/);
  assert.equal(getBrowserAgentProvider("mock").name, "mock");
  if (prior) process.env.SKYVERN_API_KEY = prior;
  resetSkyvernClientForTests();
});

test("URL guard rejects localhost and private addresses", async () => {
  await assert.rejects(() => assertSafePublicHttpUrl("http://localhost/form"));
  await assert.rejects(() => assertSafePublicHttpUrl("http://127.0.0.1/form"));
  await assert.rejects(() => assertSafePublicHttpUrl("http://169.254.169.254/latest/meta-data"));
});

test("Skyvern Review Mode leaves unapproved optional fields unchanged", () => {
  const prompt = buildFillPrompt({
    applicationId: "controlled-test",
    formUrl: "https://www.selenium.dev/selenium/web/web-form.html",
    answers: [{ question: "Text input", value: "Controlled test", fieldType: "text" }],
    files: [],
  });
  assert.match(prompt, /Leave optional fields without approved data unchanged/);
  assert.match(prompt, /An unapproved optional field is not a blocker/);
  assert.match(prompt, /Do not submit the application/);
  assert.match(prompt, /Never submit/);
});

test("Skyvern completion without confirmation evidence is not a verified submission", () => {
  const run = { ...createPendingRun("yc", "submit"), externalRunId: "tsk_safe_test", provider: "skyvern" as const };
  const base = { run_id: "tsk_safe_test", status: "completed", screenshot_urls: [], output: { submitted: true } };
  assert.equal(normalizeSkyvernRun(base, run).submissionEvidence?.confirmed, false);
  assert.equal(
    normalizeSkyvernRun(
      {
        ...base,
        output: {
          submitted: true,
          confirmation_text: "Application received",
          final_url: "https://example.com/confirmation",
        },
      },
      run,
    ).submissionEvidence?.confirmed,
    true,
  );
});

test("Skyvern run normalization exposes only real provider viewer and recording URLs", () => {
  const run = {
    ...createPendingRun("yc", "fill"),
    externalRunId: "tsk_live",
    provider: "skyvern" as const,
    browserSessionId: "pbs_live",
    liveViewUrl: "https://app.skyvern.com/browser/pbs_live",
  };
  const result = normalizeSkyvernRun(
    {
      run_id: "tsk_live",
      status: "running",
      app_url: "https://app.skyvern.com/runs/tsk_live",
      recording_url: "https://recordings.skyvern.com/tsk_live.mp4",
      step_count: 4,
    },
    run,
    {
      app_url: "https://app.skyvern.com/browser/pbs_live",
    },
  );
  assert.equal(result.liveViewUrl, "https://app.skyvern.com/browser/pbs_live");
  assert.equal(result.runUrl, "https://app.skyvern.com/runs/tsk_live");
  assert.equal(result.recordingUrl, "https://recordings.skyvern.com/tsk_live.mp4");
  assert.equal(result.stepCount, 4);
  assert.match(result.currentAction ?? "", /4 browser steps/);
});

test("Skyvern failure text is not returned to the founder or persisted as a raw provider error", () => {
  const run = { ...createPendingRun("yc", "fill"), externalRunId: "tsk_failed", provider: "skyvern" as const };
  const result = normalizeSkyvernRun(
    {
      run_id: "tsk_failed",
      status: "failed",
      output: null,
      failure_reason: "portal private token: example-sensitive-value",
    },
    run,
  );
  assert.equal(result.status, "failed");
  assert.ok(result.error);
  assert.equal(result.error?.includes("example-sensitive-value"), false);
});

test("background reconciliation reports a missing scheduler configuration", async () => {
  const response = await applicationCron(new Request("http://localhost/api/cron/application-agent"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "APPLICATION_CRON_SECRET_INVALID");
});

test("expired active runs need reconciliation but historical successful runs stay final", () => {
  const old = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
  const pending = { ...createPendingRun("yc", "fill"), createdAt: old };
  assert.equal(isActiveRunExpired(pending), true);
  assert.equal(isActiveRunExpired({ ...pending, status: "completed" }), false);
  assert.equal(isActiveRunExpired({ ...pending, status: "failed" }), false);
  assert.equal(isActiveRunExpired({ ...pending, status: "cancelled" }), false);
});
