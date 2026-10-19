"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export const getSupabaseBrowserClient = createSupabaseBrowserClient;

export async function signalEngineFetch(path: string, init: RequestInit = {}) {
  const client = getSupabaseBrowserClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Sign in with your Rising workspace account to use live workspace data.");
  }
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The workspace request failed");
  return payload;
}
