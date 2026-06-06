"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { lookup, DRAFT_FORMAT, HEALTH_STATUS } from "@/lib/labels";
import { stripMarkdown } from "@/lib/text";

interface HealthSummary {
  ok: boolean;
  creator: string;
  bindings: Record<string, "ok" | "missing" | "error">;
  oauth: { provider: string; status: "connected" | "expired" | "missing"; expires_at?: number | null }[];
}

interface DraftRow {
  id: string;
  format: string;
  status: string;
  caption: string;
  created_at: number;
}

interface TodaySummary {
  drafts: {
    pending_count: number;
    preview: Array<{ id: string; format: string; caption: string }>;
  };
}

export default function Dashboard() {
  const authed = useRequireAuth();

  const health = useQuery<HealthSummary>({
    queryKey: ["health-full"],
    queryFn: () => api.get("/api/health-full"),
    enabled: authed === true,
    refetchInterval: 5 * 60_000,
  });

  const recent = useQuery<{ drafts: DraftRow[] }>({
    queryKey: ["drafts", { status: "pending", limit: 5 }],
    queryFn: () => api.get("/api/drafts?status=pending&limit=5"),
    enabled: authed === true,
  });

  const today = useQuery<TodaySummary>({
    queryKey: ["today"],
    queryFn: () => api.get("/api/today"),
    enabled: authed === true,
    refetchInterval: 60_000,
  });

  if (!authed) return null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10">
        <p className="mb-1 text-xs uppercase tracking-widest text-gold">Skalers.io</p>
        <h1 className="font-display text-3xl">Content OS</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {health.data?.creator ? `Operating for ${health.data.creator}.` : "Signed in."}
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 font-display text-sm tracking-widest text-zinc-400">Today</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TodayCard
            href="/posting/drafts"
            label="📝 Drafts to approve"
            value={today.data?.drafts.pending_count ?? "–"}
            sub={today.data?.drafts.pending_count ? "tap to review" : "all caught up"}
            preview={today.data?.drafts.preview.map((d) => ({
              key: d.id,
              text: stripMarkdown(d.caption) || d.format,
            }))}
          />
          <ActionCard href="/posting/new" label="✍️ New brief" sub="Generate a draft from a prompt" />
          <ActionCard href="/posting/ideas" label="💡 Content ideas" sub="Your idea bank" />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 font-display text-sm tracking-widest text-zinc-400">Your content engine</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <PillarCard href="/posting/drafts" emoji="📣" name="Posting" blurb="Turn one idea into a week of belief-shifting content — reels, carousels, posts." />
          <PillarCard href="/posting/calendar" emoji="🗓️" name="Calendar" blurb="See what's queued and when it publishes across every platform." />
          <PillarCard href="/analytics" emoji="📊" name="Analytics" blurb="How your published content performs, account by account." />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 font-display text-sm tracking-widest text-zinc-400">Pending drafts</h2>
        {recent.isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
        {recent.error && (
          <p className="text-sm text-red-400">Couldn&apos;t load drafts: {String(recent.error)}</p>
        )}
        {recent.data?.drafts?.length === 0 && (
          <p className="text-sm text-zinc-500">No pending drafts. Trigger one via Telegram or the cron.</p>
        )}
        <ul className="space-y-2">
          {recent.data?.drafts?.map((d) => (
            <li key={d.id}>
              <Link
                href={`/posting/drafts/view?id=${d.id}`}
                className="block rounded-card border border-bg-graphite bg-bg-ink p-4 transition hover:border-gold/60"
              >
                <div className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
                  <span>
                    {lookup(DRAFT_FORMAT, d.format).emoji} {lookup(DRAFT_FORMAT, d.format).label}
                  </span>
                  <span className="text-gold">{d.id}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-zinc-200">{stripMarkdown(d.caption) || "(no caption)"}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm tracking-widest text-zinc-400">System health</h2>
        {health.data ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(health.data.bindings).map(([k, v]) => (
              <div key={k} className="rounded-card border border-bg-graphite bg-bg-ink px-3 py-2 text-xs">
                <div className="font-mono text-zinc-500">{k}</div>
                <div className={lookup(HEALTH_STATUS, v).cls}>
                  {lookup(HEALTH_STATUS, v).emoji} {lookup(HEALTH_STATUS, v).label}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Checking bindings…</p>
        )}
      </section>
    </main>
  );
}

function PillarCard({ href, emoji, name, blurb }: { href: string; emoji: string; name: string; blurb: string }) {
  return (
    <Link href={href} className="rounded-card border border-bg-graphite bg-bg-ink p-5 transition hover:border-gold/60">
      <div className="font-display text-lg text-white">
        <span aria-hidden>{emoji}</span> {name}
      </div>
      <p className="mt-2 text-xs leading-snug text-zinc-500">{blurb}</p>
    </Link>
  );
}

function TodayCard({
  href,
  label,
  value,
  sub,
  preview,
}: {
  href: string;
  label: string;
  value: number | string;
  sub: string;
  preview?: Array<{ key: string; text: string }>;
}) {
  const hasPreview = preview && preview.length > 0;
  return (
    <Link
      href={href}
      className="block rounded-card border border-bg-graphite bg-bg-ink p-4 transition hover:border-gold/60"
    >
      <div className="text-2xs uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="mt-2 font-display text-2xl text-white">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{sub}</div>
      {hasPreview && (
        <ul className="mt-3 space-y-1 border-t border-bg-graphite/60 pt-2">
          {preview!.map((p) => (
            <li
              key={p.key}
              className="line-clamp-1 text-2xs text-zinc-400 first:mt-0"
              title={p.text}
            >
              · {p.text || "(empty)"}
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}

function ActionCard({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="block rounded-card border border-bg-graphite bg-bg-ink p-4 transition hover:border-gold/60"
    >
      <div className="text-2xs uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="mt-2 text-sm text-zinc-300">{sub}</div>
    </Link>
  );
}
