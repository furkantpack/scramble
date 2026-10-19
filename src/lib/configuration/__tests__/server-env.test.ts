import assert from "node:assert/strict";
import test from "node:test";

import { getApplicationCronSecret, ServerConfigurationError } from "../server-env";
import { getSignalEngineEnv, resetSignalEngineEnvForTests, SignalEngineConfigurationError } from "../../signal-engine/env";

test("missing application cron secret produces a named configuration error", () => {
  const priorCron = process.env.CRON_SECRET;
  const priorAgent = process.env.APPLICATION_AGENT_CRON_SECRET;
  delete process.env.CRON_SECRET;
  delete process.env.APPLICATION_AGENT_CRON_SECRET;
  try {
    assert.throws(() => getApplicationCronSecret(), (error) =>
      error instanceof ServerConfigurationError &&
      error.variables.includes("CRON_SECRET") &&
      error.variables.includes("APPLICATION_AGENT_CRON_SECRET"));
  } finally {
    if (priorCron) process.env.CRON_SECRET = priorCron;
    if (priorAgent) process.env.APPLICATION_AGENT_CRON_SECRET = priorAgent;
  }
});

test("Signal Engine errors identify missing secret variables without values", () => {
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY",
    "SIGNAL_ENGINE_ENCRYPTION_KEY", "SIGNAL_ENGINE_CRON_SECRET"] as const;
  const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests-only";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key-for-tests-only";
  delete process.env.SIGNAL_ENGINE_ENCRYPTION_KEY;
  delete process.env.SIGNAL_ENGINE_CRON_SECRET;
  resetSignalEngineEnvForTests();
  try {
    assert.throws(() => getSignalEngineEnv(), (error) =>
      error instanceof SignalEngineConfigurationError &&
      error.variables.includes("SIGNAL_ENGINE_ENCRYPTION_KEY") &&
      error.variables.includes("SIGNAL_ENGINE_CRON_SECRET") &&
      !error.message.includes("service-role-key-for-tests-only"));
  } finally {
    for (const name of names) {
      const value = prior[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetSignalEngineEnvForTests();
  }
});
