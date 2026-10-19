// Read-only PostgREST probes. Never create, update or delete remote data.
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envFile = process.argv[2] ?? ".env.local";
const fileEnv = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, "")]; }))
  : {};
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase server configuration is incomplete"); process.exit(2); }
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12_000) }) },
});

const probes = [
  ["workspaces", "id,owner_id"],
  ["workspace_members", "id,workspace_id,user_id,role"],
  ["companies base", "id,workspace_id", "companies"],
  ["companies unified profile", "canonical_profile,unified_analysis,profile_confirmed_at", "companies"],
  ["company_assets base", "id,company_id,storage_path,analysis_status", "company_assets"],
  ["company_assets extracted pages", "extracted_pages", "company_assets"],
  ["company_assets fingerprint", "content_sha256", "company_assets"],
  ["scrape_snapshots", "id,workspace_id,company_id,source_url"],
  ["knowledge_base_entries", "id,workspace_id,company_id,status"],
  ["accelerator_programs", "id,application_url"],
  ["accelerator_applications", "id,workspace_id,company_id,status"],
  ["application_questions", "id,application_id"],
  ["application_answers", "id,application_id"],
  ["browser_agent_runs", "id,workspace_id,application_id,idempotency_key"],
  ["application_submit_authorizations", "id,workspace_id,approved_fill_run_id"],
  ["application_dispatch_jobs", "id,workspace_id,status,lease_until"],
  ["source_analysis_jobs", "id,workspace_id,status,lease_until"],
];
let unavailable = 0;
let connectionFailed = false;
for (const [index, [label, columns, tableName]] of probes.entries()) {
  const table = tableName ?? label;
  try {
    const { error, status } = await db.from(table).select(columns, { head: true }).limit(1);
    if (error) {
      unavailable++;
      const reason = String(error.message ?? "unknown error").slice(0, 160)
        .replace(/https?:\/\/\S+/g, "[url]").replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]");
      console.log(`${label}: unavailable (HTTP ${status}; ${error.code || reason || "no details"})`);
      if (/fetch failed|aborted|timeout|network|ECONN/i.test(reason)) {
        unavailable += probes.length - index - 1 + 1;
        connectionFailed = true;
        console.log("Remaining probes skipped: remote connection unavailable.");
        break;
      }
    }
    else console.log(`${label}: readable; expected columns present`);
  } catch {
    unavailable += probes.length - index + 1;
    connectionFailed = true;
    console.log(`${label}: connection unavailable; remaining probes skipped.`);
    break;
  }
}
if (!connectionFailed) try {
  const { data, error } = await db.storage.getBucket("pitch-decks");
  if (error || !data || data.public) { unavailable++; console.log("pitch-decks bucket: missing, unreadable or not private"); }
  else console.log("pitch-decks bucket: private");
} catch { unavailable++; console.log("pitch-decks bucket: connection unavailable"); }
console.log(`Read-only schema probes: ${probes.length + 1 - unavailable}/${probes.length + 1} available.`);
if (unavailable) process.exitCode = 1;
