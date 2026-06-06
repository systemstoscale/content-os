"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchMe, clearAuthCache, logout } from "@/lib/auth";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function AccountSettings() {
  return (
    <Suspense fallback={<p className="mx-auto max-w-2xl px-6 py-10 text-sm text-zinc-500">Loading…</p>}>
      <AccountInner />
    </Suspense>
  );
}

function AccountInner() {
  const router = useRouter();
  const search = useSearchParams();
  const isFirstLogin = search.get("first") === "1";

  const [email, setEmail] = useState<string | null>(null);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetchMe().then((me) => {
      if (!me) router.replace("/login");
      else setEmail(me.email);
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 12) {
      setError("New password must be at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(true);
      clearAuthCache();
      // On the FIRST-LOGIN change, send them through /welcome for the
      // 60-second product orientation. Routine changes stay here with the
      // success toast.
      if (isFirstLogin) setTimeout(() => router.replace("/welcome"), 800);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  if (email === null) return null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Settings", href: "/settings" }, { label: "Account" }]} />
      {!isFirstLogin && (
        <Link href="/" className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold">
          ← Dashboard
        </Link>
      )}

      <header className="mt-2 mb-8">
        <h1 className="font-display text-2xl">
          {isFirstLogin ? "Set your password" : "Account · Change password"}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {isFirstLogin
            ? "Your installer issued a temporary password. Pick something only you know — minimum 12 characters."
            : "Pick a new password. Minimum 12 characters."}
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="text-xs uppercase tracking-widest text-zinc-400">
            Signed in as <span className="text-gold">{email}</span>
          </div>
        </CardHeader>
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            <Field label={isFirstLogin ? "Initial password from installer" : "Current password"}>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 text-sm focus:border-gold focus:outline-none"
                autoComplete="current-password"
                autoFocus
              />
            </Field>
            <Field label="New password" hint="At least 12 characters">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 text-sm focus:border-gold focus:outline-none"
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm new password">
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 text-sm focus:border-gold focus:outline-none"
                autoComplete="new-password"
              />
            </Field>

            {error && (
              <div className="rounded-card border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-card border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                Password updated ✓ {isFirstLogin && "Redirecting…"}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  router.replace("/login");
                }}
                className="text-xs uppercase tracking-widest text-zinc-500 hover:text-red-400"
              >
                Sign out
              </button>
              <Button type="submit" disabled={busy || !oldPassword || !newPassword}>
                {busy ? "Saving…" : "Save new password"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-semibold text-white">{label}</div>
      {hint && <div className="mb-2 text-xs text-zinc-500">{hint}</div>}
      {children}
    </label>
  );
}
