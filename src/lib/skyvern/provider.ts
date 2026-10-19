import "server-only";

import type {
  BrowserAgentProvider,
  BrowserAgentRun,
  FillApplicationInput,
  SubmitApplicationInput,
} from "@/lib/application-agent/types";

import { fillApplication } from "./fill-application";
import { getSkyvernRun } from "./get-run";
import { submitApplication } from "./submit-application";

export class SkyvernBrowserAgentProvider implements BrowserAgentProvider {
  readonly name = "skyvern" as const;
  startFill(input: FillApplicationInput) {
    return fillApplication(input);
  }
  submit(input: SubmitApplicationInput) {
    return submitApplication(input);
  }
  getRun(run: BrowserAgentRun) {
    return getSkyvernRun(run);
  }
}
