import "server-only";

import { z } from "zod";

import { getSkyvernEnvironment } from "@/lib/skyvern/client";
import { SkyvernBrowserAgentProvider } from "@/lib/skyvern/provider";

import { MockBrowserAgentProvider } from "./mock-provider";
import type { BrowserAgentProvider } from "./types";

const providerSchema = z.enum(["mock", "skyvern"]);

export function getBrowserAgentProvider(
  name = process.env.BROWSER_AGENT_PROVIDER,
): BrowserAgentProvider {
  const parsed = providerSchema.safeParse(name);
  if (!parsed.success) throw new Error("Set BROWSER_AGENT_PROVIDER=skyvern for live execution or mock for tests.");
  if (parsed.data === "mock") {
    if (process.env.NODE_ENV === "production") throw new Error("Mock browser execution is disabled in production.");
    return new MockBrowserAgentProvider();
  }
  getSkyvernEnvironment();
  return new SkyvernBrowserAgentProvider();
}
