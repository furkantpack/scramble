import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSignalEngineEnv } from "./env";

export function createSignalEngineAdminClient() {
  const env = getSignalEngineEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "rising-signal-engine/1.0" } },
  });
}

export function createSignalEngineAuthClient(accessToken: string) {
  const env = getSignalEngineEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
