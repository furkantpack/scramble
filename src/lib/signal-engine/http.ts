import "server-only";

import { NextResponse } from "next/server";

import { ZodError } from "zod";

import { ServerConfigurationError } from "@/lib/configuration/server-env";
import { SignalEngineConfigurationError } from "@/lib/signal-engine/env";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function readJsonBody(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "Content-Type must be application/json", "unsupported_media_type");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new ApiError(413, "Request body is too large", "payload_too_large");

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new ApiError(413, "Request body is too large", "payload_too_large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "Request body must be valid JSON", "invalid_json");
  }
}

export function handleApiError(error: unknown) {
  if (error instanceof SignalEngineConfigurationError || error instanceof ServerConfigurationError) {
    return NextResponse.json(
      { error: "Server configuration error", code: "server_configuration_error", variables: error.variables },
      { status: 503 },
    );
  }
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Some fields are invalid",
        code: "validation_error",
        fields: error.issues.map((issue) => issue.path.join(".")),
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: "The request could not be completed", code: "internal_error" }, { status: 500 });
}

export function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
