"use client";

import Link from "next/link";
import { useRequireAuth } from "@/lib/use-require-auth";
import { Breadcrumb } from "@/components/ui/breadcrumb";

/** Settings hub. Every configuration surface for Content OS. */

const CONFIG: Array<{ href: string; label: string; blurb: string }> = [
  { href: "/settings/brand", label: "Brand", blurb: "Voice + visual guidelines" },
  { href: "/settings/telegram", label: "Telegram", blurb: "Connect your bot + webhook" },
  { href: "/settings/model", label: "Model", blurb: "LLM selection" },
  { href: "/settings/config", label: "Config", blurb: "Platform settings" },
  { href: "/settings/health", label: "Health", blurb: "System diagnostics" },
  { href: "/settings/account", label: "Account", blurb: "Account + billing" },
  { href: "/settings/sessions", label: "Sessions", blurb: "Agent run log" },
  { href: "/settings/privacy", label: "Privacy", blurb: "Export + erasure (GDPR)" },
];

export default function SettingsHub() {
  const authed = useRequireAuth();
  if (!authed) return null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Settings" }]} />
      <header className="mt-4 mb-8">
        <h1 className="font-display text-3xl">Settings</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Every configuration surface for your Content OS — brand, model, platform settings, and diagnostics.
        </p>
      </header>

      {/* Configuration */}
      <section>
        <h2 className="mb-3 font-display text-sm tracking-widest text-zinc-400">Configuration</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CONFIG.map((c) => (
            <Link key={c.href} href={c.href} className="rounded-card border border-bg-graphite bg-bg-ink p-4 transition hover:border-gold/60">
              <div className="font-display text-sm text-white">{c.label}</div>
              <p className="mt-1 text-xs text-zinc-500">{c.blurb}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
