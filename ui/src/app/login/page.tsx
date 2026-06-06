"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAuthCache } from "@/lib/auth";
import { fetchSetupStatus } from "@/lib/setup";

interface LoginResponse {
  ok: boolean;
  email?: string;
  must_change_password?: boolean;
}

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Setup-first routing: a fresh Deploy-button install has no users yet,
  // so the login form is useless. Send the visitor to /setup. Otherwise,
  // if they're already signed in, send them to the dashboard.
  useEffect(() => {
    (async () => {
      const setup = await fetchSetupStatus();
      if (setup && !setup.setup_complete) {
        router.replace("/setup");
        return;
      }
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) router.replace("/");
    })();
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Sign-in failed (HTTP ${res.status}).`);
        return;
      }
      const data = (await res.json()) as LoginResponse;
      clearAuthCache();
      if (data.must_change_password) {
        router.replace("/settings/account?first=1");
      } else {
        router.replace("/");
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <p className="mb-2 text-xs uppercase tracking-widest text-gold">Skalers.io</p>
      <h1 className="mb-2 font-display text-2xl">Content OS</h1>
      <p className="mb-8 text-sm text-zinc-400">
        Sign in with the email and initial password your Skalers installer sent you. You can change the password once you're in.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-widest text-zinc-400">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourbusiness.com"
            className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 text-sm focus:border-gold focus:outline-none"
            autoFocus
            autoComplete="email"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-widest text-zinc-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="initial password from your installer"
            className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 text-sm focus:border-gold focus:outline-none"
            autoComplete="current-password"
          />
        </label>
        {error && (
          <div className="rounded-card border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !email.trim() || !password}
          className="w-full rounded-card bg-gold py-2 font-display text-black disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-8 text-xs text-zinc-600">
        Forgot your password? Send <code className="text-gold">/resetpassword</code> to your Telegram bot — it DMs you a fresh one instantly.
      </p>
    </main>
  );
}
