import "server-only";

import type { BrowserAgentProvider, BrowserAgentRun, FillApplicationInput, SubmitApplicationInput } from "./types";
import { randomUUID } from "node:crypto";

type MockRunStore = Map<string, BrowserAgentRun>;
const storeKey = Symbol.for("accelerator-pilot.mock-browser-agent.runs");
const root = globalThis as typeof globalThis & { [storeKey]?: MockRunStore };
if (!root[storeKey]) root[storeKey] = new Map();
const runs = root[storeKey];

export class MockBrowserAgentProvider implements BrowserAgentProvider {
  readonly name = "mock" as const;

  async startFill(input: FillApplicationInput) {
    return this.createRun(input.applicationId, "fill", {
      ready_for_review: true,
      filledFieldCount: input.answers.length,
      fileCount: (input.files ?? []).length,
      finalUrl: input.formUrl,
    });
  }

  async submit(input: SubmitApplicationInput) {
    return this.createRun(input.applicationId, "submit", {
      submitted: true,
      confirmation_text: "Mock application submission confirmed.",
      final_url: "https://example.com/application/submitted",
    });
  }

  async getRun(run: BrowserAgentRun) {
    const stored = runs.get(run.externalRunId) ?? run;
    const elapsed = Date.now() - Date.parse(run.createdAt);
    let status: BrowserAgentRun["status"] = "completed";
    if (elapsed < 600) status = "queued";
    else if (elapsed < 1800) status = "running";
    const updated: BrowserAgentRun = {
      ...stored,
      id: run.id,
      applicationId: run.applicationId,
      mode: run.mode,
      status,
      updatedAt: new Date().toISOString(),
      submissionEvidence:
        stored.mode === "submit" && status === "completed"
          ? {
              confirmed: true,
              confirmationText: "Mock application submission confirmed.",
              finalUrl: "https://example.com/application/submitted",
              completedAt: new Date().toISOString(),
            }
          : undefined,
    };
    runs.set(run.externalRunId, updated);
    return structuredClone(updated);
  }

  private createRun(applicationId: string, mode: BrowserAgentRun["mode"], result: unknown) {
    const now = new Date().toISOString();
    const run: BrowserAgentRun = {
      id: randomUUID(),
      provider: "mock",
      externalRunId: `mock_${mode}_${randomUUID()}`,
      applicationId,
      mode,
      status: "queued",
      result,
      createdAt: now,
      updatedAt: now,
    };
    runs.set(run.externalRunId, run);
    return structuredClone(run);
  }
}
