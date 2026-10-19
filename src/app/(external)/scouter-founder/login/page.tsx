"use client";

import { type FormEvent, useEffect, useState } from "react";

import Link from "next/link";

import { ArrowRight, Globe2, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

import { AuthShell, FieldLabel, ScouterLogo } from "../_components/scouter-ui";

export default function Page() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error === "session" || error === "callback") {
      setMessage("The email link could not sign you in automatically. Sign in with your password to continue.");
    }
  }, []);

  async function continueWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const next = new URLSearchParams(window.location.search).get("next");
      const response = await fetch("/api/auth/password-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, next }),
        cache: "no-store",
      });
      const result = (await response.json()) as { error?: string; next?: string };
      if (!response.ok || !result.next) {
        if (result.error === "email_not_confirmed") {
          setMessage("Please confirm your email, then sign in with your password.");
        } else if (result.error === "invalid_credentials") {
          setMessage("The email or password is incorrect. Check both fields and try again.");
        } else if (result.error === "configuration_error") {
          setMessage("Sign-in is temporarily unavailable. Please try again shortly.");
        } else {
          setMessage("We couldn't sign you in right now. Please try again.");
        }
        return;
      }
      window.location.assign(result.next);
    } catch {
      setMessage("The sign-in request could not complete. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  async function continueWithGoogle() {
    setPending(true);
    setMessage("");
    const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/dashboard/founder-dashboard")}`,
      },
    });
    if (error) {
      setMessage(error.message);
      setPending(false);
    }
  }

  return (
    <AuthShell mode="login">
      <div className="space-y-8">
        <ScouterLogo brand="Scramble" />
        <div>
          <h1 className="font-semibold text-3xl tracking-tight md:text-4xl">Welcome back.</h1>
          <p className="mt-2 text-muted-foreground">Sign in to continue with Scramble.</p>
        </div>
        <div className="space-y-5">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void continueWithGoogle()}
            className="h-12 w-full rounded-xl"
          >
            <Globe2 /> Continue with Google
          </Button>
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>
          <form onSubmit={continueWithEmail} className="space-y-4">
            <div className="grid gap-2">
              <FieldLabel htmlFor="scouter-login-email">Email address</FieldLabel>
              <Input
                id="scouter-login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                className="h-12 rounded-xl"
              />
            </div>
            <div className="grid gap-2">
              <FieldLabel htmlFor="scouter-login-password">Password</FieldLabel>
              <Input
                id="scouter-login-password"
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                className="h-12 rounded-xl"
              />
            </div>
            {message ? (
              <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
                {message}
              </p>
            ) : null}
            <Button type="submit" disabled={pending} className="h-12 w-full bg-orange-600 hover:bg-orange-700">
              <LockKeyhole /> {pending ? "Signing in..." : "Sign in"} <ArrowRight />
            </Button>
          </form>
          <p className="text-center text-muted-foreground text-sm">
            New to Scramble?{" "}
            <Link href="/scouter-founder/register" className="font-medium text-orange-600 hover:text-orange-700">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
