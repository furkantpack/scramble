import "server-only";

import { ApiError } from "@/lib/signal-engine/http";

import { promises as dns } from "node:dns";
import { isIP } from "node:net";

const blockedHostnames = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.aws.internal",
  "instance-data",
]);

export async function assertSafePublicHttpUrl(value: string, label = "URL") {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, `${label} is invalid`, "unsafe_url");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, `${label} must use HTTP or HTTPS`, "unsafe_url");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (url.username || url.password || blockedHostnames.has(hostname) || hostname.endsWith(".localhost")) {
    throw new ApiError(400, `${label} is not allowed`, "unsafe_url");
  }

  if (isBlockedIp(hostname)) throw new ApiError(400, `${label} must resolve to a public address`, "unsafe_url");

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ApiError(400, `${label} could not be resolved`, "unsafe_url");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedIp(address))) {
    throw new ApiError(400, `${label} must resolve only to public addresses`, "unsafe_url");
  }
  return url.toString();
}

export function isBlockedIp(value: string) {
  const version = isIP(value);
  if (version === 4) {
    const octets = value.split(".").map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (version === 6) {
    const normalized = value.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      // Block mapped/transition IPv6 ranges rather than allowing private IPv4 via hex notation.
      normalized.startsWith("::ffff:") ||
      normalized.startsWith("64:ff9b:") ||
      normalized.startsWith("2002:") ||
      normalized.startsWith("ff") ||
      normalized === "fd00:ec2::254"
    );
  }
  return false;
}
