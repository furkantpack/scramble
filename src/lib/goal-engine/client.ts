"use client";

import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

import type { GoalCollection } from "./types";

export async function goalRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().auth.getSession();
  if (error || !data.session)
    throw new Error("A verified workspace session is required. The preview login does not create one.");
  const response = await fetch(`/api/goals${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
      Authorization: `Bearer ${data.session.access_token}`,
    },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Unable to load goals.");
  return payload as T;
}

export function useGoals(active = false) {
  const [data, setData] = useState<GoalCollection | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await goalRequest<GoalCollection>(active ? "?active=true" : ""));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Unable to load goals.");
    } finally {
      setLoading(false);
    }
  }, [active]);
  useEffect(() => {
    void reload();
    let subscription: { unsubscribe: () => void } | undefined;
    try {
      subscription = getSupabaseBrowserClient().auth.onAuthStateChange(() => {
        // Run outside the auth callback to avoid re-entering the session lock.
        window.setTimeout(() => void reload(), 0);
      }).data.subscription;
    } catch {
      /* Configuration errors are surfaced by reload. */
    }
    return () => subscription?.unsubscribe();
  }, [reload]);
  return { data, error, loading, reload };
}
