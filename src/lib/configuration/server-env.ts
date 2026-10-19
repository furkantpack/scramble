import "server-only";

import { timingSafeEqual } from "node:crypto";

export class ServerConfigurationError extends Error {
  constructor(
    public readonly code: string,
    public readonly variables: readonly string[],
  ) {
    super(`Server configuration is missing or invalid: ${variables.join(" or ")}`);
    this.name = "ServerConfigurationError";
  }
}

export function getApplicationCronSecret() {
  const secret = process.env.CRON_SECRET ?? process.env.APPLICATION_AGENT_CRON_SECRET;
  if (!secret || secret.length < 32) {
    throw new ServerConfigurationError("APPLICATION_CRON_SECRET_INVALID", [
      "CRON_SECRET",
      "APPLICATION_AGENT_CRON_SECRET",
    ]);
  }
  return secret;
}

export function verifyApplicationCronRequest(request: Request) {
  const secret = getApplicationCronSecret();
  const candidate = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!candidate) return false;
  const expected = Buffer.from(secret);
  const supplied = Buffer.from(candidate);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
