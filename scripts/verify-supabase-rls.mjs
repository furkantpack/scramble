import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")];
    }),
);
const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !publicKey || !secretKey) throw new Error("Supabase environment is incomplete");

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now();
const password = `Rls-${crypto.randomUUID()}-Aa1!`;
const createdUsers = [];
let workspaceA;
let companyA;
let applicationA;
let knowledgeA;
let storagePath;

try {
  const userA = await createUser(`codex-rls-a-${stamp}@example.com`);
  const userB = await createUser(`codex-rls-b-${stamp}@example.com`);
  createdUsers.push(userA.id, userB.id);
  const clientA = await userClient(userA.email, password);
  const clientB = await userClient(userB.email, password);

  const { data: memberA, error: memberError } = await clientA
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userA.id)
    .single();
  if (memberError) throw memberError;
  workspaceA = memberA.workspace_id;

  const { data: company, error: companyError } = await clientA
    .from("companies")
    .insert({ workspace_id: workspaceA, name: "RLS verification company", stage: "idea" })
    .select("id")
    .single();
  if (companyError) throw companyError;
  companyA = company.id;

  const { data: application, error: applicationError } = await clientA
    .from("accelerator_applications")
    .insert({ workspace_id: workspaceA, company_id: companyA, form_url: "https://example.com/apply", status: "draft" })
    .select("id")
    .single();
  if (applicationError) throw applicationError;
  applicationA = application.id;

  const { data: knowledge, error: knowledgeError } = await clientA
    .from("knowledge_base_entries")
    .insert({ workspace_id: workspaceA, company_id: companyA, category: "problem", source_type: "manual", status: "founder_edited", content: "RLS test", version: 1 })
    .select("id")
    .single();
  if (knowledgeError) throw knowledgeError;
  knowledgeA = knowledge.id;

  storagePath = `${workspaceA}/${companyA}/rls-test.txt`;
  const { error: uploadError } = await clientA.storage.from("pitch-decks").upload(storagePath, new Blob(["private"]), { contentType: "text/plain" });
  if (uploadError) throw uploadError;

  await assertHidden(clientB, "workspaces", workspaceA);
  await assertHidden(clientB, "companies", companyA);
  await assertHidden(clientB, "accelerator_applications", applicationA);
  await assertHidden(clientB, "knowledge_base_entries", knowledgeA);
  const { data: privateFile, error: privateFileError } = await clientB.storage.from("pitch-decks").download(storagePath);
  if (!privateFileError || privateFile) throw new Error("User B could access User A's private Storage object");
  console.log("RLS verification passed: workspace, company, application, Knowledge Base and private Storage are isolated.");
} finally {
  if (storagePath) await admin.storage.from("pitch-decks").remove([storagePath]);
  if (applicationA) await admin.from("accelerator_applications").delete().eq("id", applicationA);
  if (knowledgeA) await admin.from("knowledge_base_entries").delete().eq("id", knowledgeA);
  if (companyA) await admin.from("companies").delete().eq("id", companyA);
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
}

async function createUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: "RLS", last_name: "Test", product: "scouter-founder" } });
  if (error || !data.user) throw error ?? new Error("Test user was not created");
  return data.user;
}

async function userClient(email, userPassword) {
  const client = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: userPassword });
  if (error) throw error;
  return client;
}

async function assertHidden(client, table, id) {
  const { data, error } = await client.from(table).select("id").eq("id", id);
  if (error) throw error;
  if (data.length !== 0) throw new Error(`User B could access User A's ${table} record`);
}
