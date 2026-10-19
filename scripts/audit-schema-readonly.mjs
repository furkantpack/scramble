// Read-only PostgREST schema probe for the checked-in Database type.
// Never invokes RPCs or reads rows; sends GET/SELECT with limit(0) only.
// This project returns HTTP 204 for HEAD even on nonexistent tables, so HEAD is unsafe for schema verification.
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const source = readFileSync("src/types/database.ts", "utf8");
const tablesBody = source.split("    Tables: {")[1]?.split("    Views:")[0];
if (!tablesBody) throw new Error("Unable to locate typed tables");
const tables = [...tablesBody.matchAll(/^      ([a-z_]+): Table<\{([\s\S]*?)^      \}>;/gm)]
  .map((match) => ({ table: match[1], columns: [...match[2].matchAll(/(?:^|;)\s*([a-z_]+):/gm)].map((field) => field[1]) }));
if (!tables.length) throw new Error("No typed tables found");

const envPath = process.argv[2] ?? ".env.local";
const fileEnv = existsSync(envPath)
  ? Object.fromEntries(readFileSync(envPath, "utf8").split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, "")]; }))
  : {};
const url = process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase read-only probe configuration missing");
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12_000) }) },
});

let missing = 0;
for (const { table, columns } of tables) {
  const { error } = await db.from(table).select(columns.join(",")).limit(0);
  if (!error) { console.log(`${table}: ${columns.length}/${columns.length} typed columns available`); continue; }
  const unavailable = [];
  for (const column of columns) {
    const result = await db.from(table).select(column).limit(0);
    if (result.error) unavailable.push(column);
  }
  missing += unavailable.length || 1;
  console.log(`${table}: ${unavailable.length ? `missing/unavailable ${unavailable.join(", ")}` : "table unavailable or combined projection failed"}`);
}
console.log(`Checked ${tables.length} typed tables; ${missing} missing/unavailable column or table checks.`);
if (missing) process.exitCode = 1;
