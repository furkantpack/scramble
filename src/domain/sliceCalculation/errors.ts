import type { CalculationBlockedResponse } from "./types";

export class CalculationBlockedError extends Error {
  constructor(
    readonly state: CalculationBlockedResponse["status"],
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CalculationBlockedError";
  }
}

export class CalculationInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculationInvariantError";
  }
}
