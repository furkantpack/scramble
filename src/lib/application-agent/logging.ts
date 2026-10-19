import "server-only";

import type { BrowserAgentRun } from "./types";

export function logAgentTransition(
  run: BrowserAgentRun,
  previousStatus?: BrowserAgentRun["status"],
  startedAt?: number,
) {
  console.info("browser_agent_transition", {
    applicationId: run.applicationId,
    provider: run.provider,
    runId: run.externalRunId,
    operation: run.mode,
    from: previousStatus,
    to: run.status,
    durationMs: startedAt ? Date.now() - startedAt : undefined,
    errorCode: run.errorCode,
  });
}
