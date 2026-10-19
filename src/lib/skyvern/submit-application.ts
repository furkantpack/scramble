import "server-only";

import type { BrowserAgentRun, SubmitApplicationInput } from "@/lib/application-agent/types";

import { getSkyvernClient } from "./client";
import { BrowserAgentError, normalizeSkyvernError } from "./errors";
import { randomUUID } from "node:crypto";

export async function submitApplication(input: SubmitApplicationInput): Promise<BrowserAgentRun> {
  if (!input.browserSessionId) {
    throw new BrowserAgentError("SKYVERN_RUN_FAILED", "The prepared browser session is no longer available");
  }

  const client = getSkyvernClient();
  try {
    const session = await client.getBrowserSession(input.browserSessionId, { timeoutInSeconds: 20, maxRetries: 1 });
    const response = await client.runTask(
      {
        "x-user-agent": "AcceleratorPilot/1.0",
        body: {
          title: `Submit reviewed application ${input.applicationId}`,
          engine: "skyvern-2.0",
          browser_session_id: input.browserSessionId,
          webhook_url: input.webhookUrl,
          max_steps: 20,
          max_screenshot_scrolls: 4,
          data_extraction_schema: {
            type: "object",
            properties: {
              submitted: { type: "boolean" },
              confirmation_text: { type: "string" },
              final_url: { type: "string" },
              requires_human_input: { type: "boolean" },
              human_input_reason: { type: "string" },
            },
            required: ["submitted"],
          },
          prompt: `Continue in the existing browser session for application ${input.applicationId}.

Verify that the prepared application is open and that its fields are still populated. This operation has separate, explicit founder approval to submit. If a new legal declaration, paid commitment, inaccurate statement, unexpected consent, login, OTP, or CAPTCHA appears, stop and request human input; do not agree or bypass it. Otherwise click the actual final Submit, Apply, Send, Confirm Application, Finish Application, or equivalent final action exactly once. Wait for a clear success confirmation.

Return submitted=true only when the website visibly confirms successful submission. Include confirmation_text and final_url when available. If the expected application is not open, the form changed, or confirmation is ambiguous, do not attempt another submission; stop and report the issue.`,
        },
      },
      { timeoutInSeconds: 45, maxRetries: 0 },
    );
    return {
      id: randomUUID(),
      provider: "skyvern",
      externalRunId: response.run_id,
      browserSessionId: response.browser_session_id ?? input.browserSessionId,
      liveViewUrl: safeProviderUrl(session.app_url),
      runUrl: safeProviderUrl(response.app_url),
      recordingUrl: safeProviderUrl(response.recording_url),
      currentAction: "Submitting the founder-reviewed application",
      stepCount: response.step_count,
      mode: "submit",
      status: response.status === "running" ? "running" : "queued",
      applicationId: input.applicationId,
      screenshots: response.screenshot_urls,
      result: response.output,
      createdAt: response.created_at,
      updatedAt: response.modified_at,
    };
  } catch (error) {
    throw normalizeSkyvernError(error);
  }
}

function safeProviderUrl(value?: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
