"use client";

import { type FormEvent, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowRight, Globe2, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

import { AuthShell, FieldLabel, ScouterLogo } from "../_components/scouter-ui";

export default function Page() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const { data, error } = await getSupabaseBrowserClient().auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/onboarding")}`,
          data: {
            first_name: form.firstName,
            last_name: form.lastName,
            product: "scouter-founder",
          },
        },
      });
      if (error) throw error;
      if (data.session) router.push("/onboarding");
      else setMessage("Check your email to confirm your account, then sign in to continue onboarding.");
    } catch {
      setMessage("Your account could not be created. Check the form and try again.");
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
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/onboarding")}`,
      },
    });
    if (error) {
      setMessage(error.message);
      setPending(false);
    }
  }

  return (
    <AuthShell mode="register">
      <div className="space-y-8">
        <ScouterLogo brand="Scramble" />
        <div>
          <h1 className="font-semibold text-3xl tracking-tight md:text-4xl">Meet Scramble.</h1>
          <p className="mt-2 text-muted-foreground">
            Create your founder profile and let Scramble learn what you are building.
          </p>
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
          <form onSubmit={createAccount} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <AuthField
                id="scouter-first-name"
                label="First name"
                autoComplete="given-name"
                placeholder="Furkan"
                value={form.firstName}
                onChange={(firstName) => setForm({ ...form, firstName })}
              />
              <AuthField
                id="scouter-last-name"
                label="Last name"
                autoComplete="family-name"
                placeholder="Topcuoglu"
                value={form.lastName}
                onChange={(lastName) => setForm({ ...form, lastName })}
              />
            </div>
            <AuthField
              id="scouter-work-email"
              label="Work email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={form.email}
              onChange={(email) => setForm({ ...form, email })}
            />
            <AuthField
              id="scouter-password"
              label="Password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={form.password}
              onChange={(password) => setForm({ ...form, password })}
            />
            {message ? (
              <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
                {message}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={pending || form.password.length < 8}
              className="h-12 w-full bg-orange-600 hover:bg-orange-700"
            >
              <LockKeyhole /> {pending ? "Creating account..." : "Create account"} <ArrowRight />
            </Button>
          </form>
          <p className="text-center text-muted-foreground text-sm">
            Already have an account?{" "}
            <Link href="/scouter-founder/login" className="font-medium text-orange-600 hover:text-orange-700">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}

function AuthField({
  id,
  label,
  value,
  placeholder,
  autoComplete,
  type = "text",
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  autoComplete: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        required
        type={type}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 rounded-xl"
      />
    </div>
  );
}
