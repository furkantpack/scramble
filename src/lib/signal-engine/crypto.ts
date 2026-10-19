import "server-only";

import { getSignalEngineEnv } from "./env";
import type { JiraCredentials } from "./types";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const AAD = Buffer.from("rising:signal-engine:credentials:v1", "utf8");

function encryptionKey() {
  return Buffer.from(getSignalEngineEnv().SIGNAL_ENGINE_ENCRYPTION_KEY, "base64");
}

export function encryptCredentials(credentials: JiraCredentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptCredentials(encrypted: string): JiraCredentials {
  const parts = encrypted.split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted credential envelope");

  const [ivPart, tagPart, ciphertextPart] = parts;
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error("Invalid encrypted credential envelope");
  }

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed: unknown = JSON.parse(plaintext);
  if (!isJiraCredentials(parsed)) throw new Error("Decrypted credentials have an invalid shape");

  return parsed;
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeStringEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function generateWebhookSecret() {
  return randomBytes(32).toString("base64url");
}

function isJiraCredentials(value: unknown): value is JiraCredentials {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.baseUrl === "string" && typeof record.email === "string" && typeof record.apiToken === "string";
}
