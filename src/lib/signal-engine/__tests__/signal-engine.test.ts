import { linkSignalToGoal } from "../goal-linker";
import { tagSignal } from "../tagging-engine";
import type { GoalCandidate, GoalLinkRule, NormalizedEvent, TagMappingRule } from "../types";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

const event: NormalizedEvent = {
  sourceTool: "jira",
  externalId: "10001",
  externalKey: "ENG-42",
  externalUrl: "https://rising.atlassian.net/browse/ENG-42",
  actorExternalId: "acct-1",
  summary: "Ship billing retry state",
  eventType: "updated",
  occurredAt: "2026-09-01T12:00:00.000Z",
  projectKey: "ENG",
  issueType: "Story",
  status: "Done",
  labels: ["core", "billing"],
  rawPayload: {},
};

test("Jira URL validation blocks SSRF and deceptive hosts", async () => {
  const { normalizeJiraBaseUrl } = await import("../jira-client");
  assert.equal(normalizeJiraBaseUrl("rising.atlassian.net"), "https://rising.atlassian.net");
  for (const unsafe of [
    "http://rising.atlassian.net",
    "https://localhost",
    "https://atlassian.net.evil.test",
    "https://user:pass@rising.atlassian.net",
    "https://rising.atlassian.net/rest/api",
    "https://rising.atlassian.net?redirect=evil",
  ]) {
    assert.throws(() => normalizeJiraBaseUrl(unsafe));
  }
});

test("Jira normalization keeps only the minimum signal payload", async () => {
  const { normalizeJiraWebhook } = await import("../jira-client");
  const normalized = normalizeJiraWebhook(
    {
      webhookEvent: "jira:issue_updated",
      issue: {
        id: "10001",
        key: "ENG-42",
        fields: {
          summary: "Ship billing retry state",
          description: "secret customer context",
          comment: { comments: [{ body: "private comment" }] },
          updated: "2026-09-01T12:00:00.000Z",
          labels: ["core"],
          project: { key: "ENG", name: "Engineering" },
          issuetype: { name: "Story" },
          status: { name: "Done" },
          assignee: { accountId: "acct-1", emailAddress: "private@example.com" },
        },
      },
    },
    "https://rising.atlassian.net",
  );
  const serialized = JSON.stringify(normalized.rawPayload);
  assert.equal(normalized.externalUrl, "https://rising.atlassian.net/browse/ENG-42");
  assert.equal(serialized.includes("private@example.com"), false);
  assert.equal(serialized.includes("private comment"), false);
  assert.equal(serialized.includes("secret customer context"), false);
});

test("AES-GCM credentials round-trip and reject tampering or a different key", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests-only";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key-for-tests-only";
  process.env.SIGNAL_ENGINE_CRON_SECRET = "cron-secret-for-tests-that-is-at-least-thirty-two-characters";
  process.env.SIGNAL_ENGINE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const { resetSignalEngineEnvForTests } = await import("../env");
  resetSignalEngineEnvForTests();
  const { decryptCredentials, encryptCredentials, safeStringEqual } = await import("../crypto");
  const credentials = {
    baseUrl: "https://rising.atlassian.net",
    email: "owner@example.com",
    apiToken: "jira-secret-token-value",
  };
  const encrypted = encryptCredentials(credentials);
  assert.deepEqual(decryptCredentials(encrypted), credentials);
  assert.equal(encrypted.includes(credentials.apiToken), false);
  assert.equal(safeStringEqual("same", "same"), true);
  assert.equal(safeStringEqual("same", "different"), false);

  const parts = encrypted.split(".");
  const tamperedCiphertext = Buffer.from(parts[2], "base64url");
  tamperedCiphertext[0] ^= 1;
  parts[2] = tamperedCiphertext.toString("base64url");
  assert.throws(() => decryptCredentials(parts.join(".")));

  process.env.SIGNAL_ENGINE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  resetSignalEngineEnvForTests();
  assert.throws(() => decryptCredentials(encrypted));
});

test("tagging uses highest priority rules and transparent defaults", () => {
  const rules: TagMappingRule[] = [
    {
      id: "label",
      integrationId: "integration",
      sourceField: "label",
      sourceValue: "core",
      contributionType: null,
      domainTag: null,
      weightClass: "CORE",
      priority: 200,
      isActive: true,
    },
    {
      id: "project",
      integrationId: "integration",
      sourceField: "project_key",
      sourceValue: "ENG",
      contributionType: "IP",
      domainTag: "ENG",
      weightClass: "SUPPORTING",
      priority: 100,
      isActive: true,
    },
  ];
  const result = tagSignal(event, rules);
  assert.equal(result.contributionType, "IP");
  assert.equal(result.domainTag, "ENG");
  assert.equal(result.weightClass, "SUPPORTING");
  assert.equal(result.confidence, 0.95);
  assert.deepEqual(result.appliedRuleIds, ["project"]);

  const defaults = tagSignal(event, []);
  assert.deepEqual(
    [defaults.contributionType, defaults.domainTag, defaults.weightClass, defaults.confidence],
    ["TIME", "OPS", "SUPPORTING", 0.35],
  );
});

test("goal linking never forces an ambiguous match", () => {
  const goals: GoalCandidate[] = [
    { id: "goal-a", title: "Launch" },
    { id: "goal-b", title: "Revenue" },
  ];
  const rules: GoalLinkRule[] = [
    {
      id: "rule-a",
      integrationId: "integration",
      sourceProjectKey: "ENG",
      sourceLabel: null,
      sourceKeyword: null,
      goalId: "goal-a",
      priority: 100,
      isActive: true,
    },
    {
      id: "rule-b",
      integrationId: "integration",
      sourceProjectKey: "ENG",
      sourceLabel: null,
      sourceKeyword: null,
      goalId: "goal-b",
      priority: 100,
      isActive: true,
    },
  ];
  assert.deepEqual(linkSignalToGoal(event, rules, goals), {
    goalId: null,
    confidence: 0,
    reason: "ambiguous",
    appliedRuleId: null,
  });
  rules[1].priority = 101;
  assert.equal(linkSignalToGoal(event, rules, goals).goalId, "goal-a");
});

test("webhook limiter accepts the budget and blocks the next request", async () => {
  const { consumeWebhookRateLimit, resetWebhookRateLimitsForTests } = await import("../webhook-security");
  resetWebhookRateLimitsForTests();
  for (let index = 0; index < 120; index += 1) {
    assert.equal(consumeWebhookRateLimit("integration", 1_000).allowed, true);
  }
  const blocked = consumeWebhookRateLimit("integration", 1_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(consumeWebhookRateLimit("integration", 61_001).allowed, true);
});

test("signal fingerprints are deterministic and event-sensitive", async () => {
  process.env.SIGNAL_ENGINE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const { resetSignalEngineEnvForTests } = await import("../env");
  resetSignalEngineEnvForTests();
  const { signalFingerprint } = await import("../ingestion-service");
  const first = signalFingerprint("integration", event);
  const second = signalFingerprint("integration", event);
  const changed = signalFingerprint("integration", { ...event, occurredAt: "2026-09-01T12:01:00.000Z" });
  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/);
});
