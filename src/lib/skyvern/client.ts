import "server-only";

import { SkyvernClient } from "@skyvern/client";
import { z } from "zod";

const envSchema = z.object({
  SKYVERN_API_KEY: z.string().min(32),
  SKYVERN_BASE_URL: z.url().default("https://api.skyvern.com"),
});

export type SkyvernEnvironment = z.infer<typeof envSchema>;

let cachedEnvironment: SkyvernEnvironment | undefined;
let cachedClient: SkyvernClient | undefined;

export function getSkyvernEnvironment() {
  if (cachedEnvironment) return cachedEnvironment;
  const parsed = envSchema.safeParse({
    SKYVERN_API_KEY: process.env.SKYVERN_API_KEY,
    SKYVERN_BASE_URL: process.env.SKYVERN_BASE_URL || "https://api.skyvern.com",
  });
  if (!parsed.success) throw new Error("Skyvern is not configured. Set a valid server-only SKYVERN_API_KEY.");
  cachedEnvironment = parsed.data;
  return cachedEnvironment;
}

export function getSkyvernClient() {
  if (cachedClient) return cachedClient;
  const environment = getSkyvernEnvironment();
  cachedClient = new SkyvernClient({
    apiKey: environment.SKYVERN_API_KEY,
    baseUrl: environment.SKYVERN_BASE_URL,
    timeoutInSeconds: 45,
    maxRetries: 2,
  });
  return cachedClient;
}

export function resetSkyvernClientForTests() {
  cachedEnvironment = undefined;
  cachedClient = undefined;
}
