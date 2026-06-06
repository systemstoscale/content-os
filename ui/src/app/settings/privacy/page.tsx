"use client";

import { useRequireAuth } from "@/lib/use-require-auth";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function PrivacySettings() {
  const authed = useRequireAuth();
  if (!authed) return null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Settings", href: "/settings" }, { label: "Privacy" }]} />
      <header className="mb-8">
        <p className="mb-1 text-xs uppercase tracking-widest text-gold">Settings</p>
        <h1 className="font-display text-3xl">Privacy & data</h1>
        <p className="mt-2 text-sm text-zinc-400">Where your data lives and how to remove it.</p>
      </header>

      <section className="mb-6 rounded-card border border-bg-graphite bg-bg-ink p-5">
        <h2 className="mb-3 font-display text-lg">Your data stays in your account</h2>
        <p className="text-sm text-zinc-400">
          Content OS runs entirely inside your own Cloudflare account. Drafts, content ideas, reel projects, and
          generated assets are stored in your D1 database and R2 bucket — nobody else can read them. API keys are
          held as Worker secrets and are never written to disk or logged.
        </p>
      </section>

      <section className="rounded-card border border-bg-graphite bg-bg-ink p-5">
        <h2 className="mb-3 font-display text-lg">Export or erase</h2>
        <p className="text-sm text-zinc-400">
          Because everything lives in your own account, you have full control. Export or delete any record directly
          from your D1 database, and clear generated media from your R2 bucket via Wrangler or the Cloudflare
          dashboard. Deleting the Worker removes the whole install.
        </p>
      </section>
    </main>
  );
}
