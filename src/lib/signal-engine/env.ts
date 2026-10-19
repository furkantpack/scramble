import "server-only";

import { z } from "zod";

export class SignalEngineConfigurationError extends Error {
  constructor(public readonly variables: readonly string[]) {
    super(`Signal Engine configuration is missing or invalid: ${variables.join(", ")}`);
    this.name = "SignalEngineConfigurationError";
  }
}

const envSchema = z.object({
  SUPABASE_URL: z.url().refine((value) => value.startsWith("https://"), "Supabase URL must use HTTPS"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(24),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(24),
  SIGNAL_ENGINE_ENCRYPTION_KEY: z.string().refine((value) => {
    try {
      return Buffer.from(value, "base64").length === 32;
    } catch {
      return false;
    }
  }, "SIGNAL_ENGINE_ENCRYPTION_KEY must decode to exactly 32 bytes"),
  SIGNAL_ENGINE_CRON_SECRET: z.string().min(32),
  SIGNAL_ENGINE_WEBHOOK_BASE_URL: z.url().optional(),
});

export type SignalEngineEnv = z.infer<typeof envSchema>;

let cachedEnv: SignalEngineEnv | undefined;

export function getSignalEngineEnv(): SignalEngineEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SIGNAL_ENGINE_ENCRYPTION_KEY: process.env.SIGNAL_ENGINE_ENCRYPTION_KEY,
    SIGNAL_ENGINE_CRON_SECRET: process.env.SIGNAL_ENGINE_CRON_SECRET,
    SIGNAL_ENGINE_WEBHOOK_BASE_URL: process.env.SIGNAL_ENGINE_WEBHOOK_BASE_URL,
  });
  if (!parsed.success) {
    const variables = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "SIGNAL_ENGINE_CONFIG")))];
    throw new SignalEngineConfigurationError(variables);
  }

  cachedEnv = parsed.data;
  return parsed.data;
}

export function resetSignalEngineEnvForTests() {
  cachedEnv = undefined;
}
