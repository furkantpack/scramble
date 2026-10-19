import "server-only";

import { z } from "zod";

import type { JiraCredentials, NormalizedEvent } from "./types";

const jiraCredentialsSchema = z.object({
  baseUrl: z.string().min(1),
  email: z.email(),
  apiToken: z.string().min(16).max(2048),
});

interface JiraIssue {
  id: string;
  key: string;
  self?: string;
  fields?: {
    summary?: string;
    created?: string;
    updated?: string;
    labels?: string[];
    project?: { key?: string; name?: string };
    issuetype?: { name?: string };
    status?: { name?: string };
    assignee?: { accountId?: string; displayName?: string } | null;
  };
}

interface JiraSearchResponse {
  issues?: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

export class JiraRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "JiraRequestError";
  }
}

export function parseJiraCredentials(input: unknown): JiraCredentials {
  const parsed = jiraCredentialsSchema.parse(input);
  return { ...parsed, baseUrl: normalizeJiraBaseUrl(parsed.baseUrl) };
}

export function normalizeJiraBaseUrl(input: string) {
  const candidate = input.trim();
  const withProtocol = candidate.startsWith("https://") ? candidate : `https://${candidate}`;
  let url: URL;

  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("Enter a valid Jira Cloud URL");
  }

  const hostParts = url.hostname.toLowerCase().split(".");
  const isAtlassianCloud = hostParts.length >= 3 && hostParts.at(-2) === "atlassian" && hostParts.at(-1) === "net";
  if (
    url.protocol !== "https:" ||
    !isAtlassianCloud ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("Only root https://*.atlassian.net Jira Cloud URLs are allowed");
  }

  return url.origin;
}

export async function testJiraConnection(credentials: JiraCredentials) {
  const safeCredentials = parseJiraCredentials(credentials);
  const response = await jiraFetch(safeCredentials, "/rest/api/3/myself");
  const body = (await response.json()) as { accountId?: string; displayName?: string };
  return {
    accountId: body.accountId ?? null,
    displayName: body.displayName ?? "Jira user",
    baseUrl: safeCredentials.baseUrl,
  };
}

export async function fetchUpdatedIssuesSince(
  credentials: JiraCredentials,
  since: Date,
  options: { maxIssues?: number } = {},
) {
  const safeCredentials = parseJiraCredentials(credentials);
  const maxIssues = Math.min(Math.max(options.maxIssues ?? 500, 1), 1000);
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;

  do {
    const body: Record<string, unknown> = {
      jql: `updated >= "${toJiraDate(since)}" ORDER BY updated ASC`,
      fields: ["summary", "created", "updated", "labels", "project", "issuetype", "status", "assignee"],
      maxResults: Math.min(100, maxIssues - issues.length),
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const response = await jiraFetch(safeCredentials, "/rest/api/3/search/jql", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const page = (await response.json()) as JiraSearchResponse;
    issues.push(...(page.issues ?? []));
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
  } while (nextPageToken && issues.length < maxIssues);

  return issues.slice(0, maxIssues).map((issue) => normalizeJiraIssue(issue, safeCredentials.baseUrl));
}

export function normalizeJiraWebhook(payload: unknown, baseUrl: string): NormalizedEvent {
  if (!payload || typeof payload !== "object") throw new Error("Invalid Jira webhook payload");
  const record = payload as Record<string, unknown>;
  const issue = record.issue as JiraIssue | undefined;
  if (!issue?.id || !issue.key) throw new Error("Jira webhook payload does not contain an issue");
  const event = typeof record.webhookEvent === "string" ? record.webhookEvent : "jira:issue_updated";

  return normalizeJiraIssue(issue, normalizeJiraBaseUrl(baseUrl), event.includes("created") ? "created" : "updated");
}

export function normalizeJiraIssue(
  issue: JiraIssue,
  baseUrl: string,
  eventType: "created" | "updated" = "updated",
): NormalizedEvent {
  const fields = issue.fields ?? {};
  const occurredAt = fields.updated ?? fields.created;
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error(`Issue ${issue.key} has no valid timestamp`);

  const summary = cleanText(fields.summary ?? "Untitled Jira issue", 500);
  const projectKey = cleanText(fields.project?.key ?? "UNKNOWN", 64).toUpperCase();
  const issueType = cleanText(fields.issuetype?.name ?? "Issue", 100);
  const status = cleanText(fields.status?.name ?? "Unknown", 100);
  const labels = (fields.labels ?? []).filter((label): label is string => typeof label === "string").slice(0, 50);

  return {
    sourceTool: "jira",
    externalId: issue.id,
    externalKey: issue.key,
    externalUrl: `${normalizeJiraBaseUrl(baseUrl)}/browse/${encodeURIComponent(issue.key)}`,
    actorExternalId: fields.assignee?.accountId ?? null,
    summary,
    eventType,
    occurredAt: new Date(occurredAt).toISOString(),
    projectKey,
    issueType,
    status,
    labels,
    rawPayload: {
      issueId: issue.id,
      issueKey: issue.key,
      summary,
      projectKey,
      projectName: cleanText(fields.project?.name ?? "", 160),
      issueType,
      status,
      labels,
      assigneeAccountId: fields.assignee?.accountId ?? null,
      occurredAt: new Date(occurredAt).toISOString(),
    },
  };
}

async function jiraFetch(credentials: JiraCredentials, path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${credentials.baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString("base64")}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new JiraRequestError("Jira rejected the supplied credentials or scope", response.status);
      }
      if (response.status === 429) throw new JiraRequestError("Jira rate limit reached", response.status);
      throw new JiraRequestError("Jira request failed", response.status);
    }
    return response;
  } catch (error) {
    if (error instanceof JiraRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new JiraRequestError("Jira request timed out", 504);
    }
    throw new JiraRequestError("Jira could not be reached", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function toJiraDate(date: Date) {
  if (Number.isNaN(date.getTime())) throw new Error("Invalid sync cursor date");
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function cleanText(value: string, maxLength: number) {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
