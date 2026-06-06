"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { lookup, DRAFT_FORMAT, DRAFT_STATUS } from "@/lib/labels";
import { stripMarkdown } from "@/lib/text";
import { Breadcrumb } from "@/components/ui/breadcrumb";

interface DraftSummary {
  id: string;
  created_at: number;
  source: string;
  status: "pending" | "approved" | "published" | "rejected" | "failed";
  format: string;
  caption: string;
  pillar: string | null;
  published_at: number | null;
}

interface DraftListResponse {
  drafts: DraftSummary[];
  total: number;
  limit: number;
  offset: number;
}

const STATUS_TABS = ["all", "pending", "approved", "published", "rejected"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

export default function DraftsList() {
  const authed = useRequireAuth();
  const [tab, setTab] = useState<StatusTab>("pending");
  const [format, setFormat] = useState<string>("");

  const query = useQuery<DraftListResponse>({
    queryKey: ["drafts", { tab, format }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (tab !== "all") params.set("status", tab);
      if (format) params.set("format", format);
      params.set("limit", "100");
      return api.get(`/api/drafts?${params.toString()}`);
    },
    enabled: authed === true,
  });

  if (!authed) return null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Posting" }]} />
      <header className="mb-8">
        <Link href="/" className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold">
          ← Dashboard
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">Posting · Drafts</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Approve, reject, or open a draft to publish. Drafts come from the daily cron, Telegram bot, and the New-brief form below.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/posting/calendar"
              className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold"
            >
              📅 Calendar
            </Link>
            <Link
              href="/posting/review"
              className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold"
            >
              📊 What's working
            </Link>
            <Link
              href="/posting/ideas"
              className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold"
            >
              💡 Ideas
            </Link>
            <Link
              href="/settings/brand"
              className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold"
            >
              🎨 Brand
            </Link>
            <Link href="/posting/new">
              <Button>+ New brief</Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-card border border-bg-graphite bg-bg-ink p-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`min-h-9 rounded px-3 py-2 text-xs uppercase tracking-widest transition ${
                tab === t ? "bg-gold text-black" : "text-zinc-400 hover:text-white"
              }`}
            >
              {t === "all" ? "📋" : lookup(DRAFT_STATUS, t).emoji} {t}
            </button>
          ))}
        </div>

        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="min-h-10 rounded-card border border-bg-graphite bg-bg-ink px-3 py-2 text-xs uppercase tracking-widest text-zinc-300 focus:border-gold focus:outline-none"
        >
          <option value="">All formats</option>
          <option value="carousel">🎠 Carousel</option>
          <option value="quote_post">💬 Quote post</option>
          <option value="single_image">🖼️ Single image</option>
          <option value="reel">🎬 Reel</option>
          <option value="youtube">📺 YouTube</option>
          <option value="meta_ads">📣 Meta Ads</option>
          <option value="thumbnail">🖼️ Thumbnail</option>
          <option value="text_post">📝 Text post</option>
        </select>

        {query.data && (
          <span className="ml-auto text-xs text-zinc-500">{query.data.total} total</span>
        )}
      </div>

      {query.isLoading && <p className="text-sm text-zinc-500">Loading drafts…</p>}
      {query.error && (
        <Card className="bg-red-500/10 p-5 text-sm text-red-200">
          {String(query.error)}
        </Card>
      )}
      {query.data?.drafts.length === 0 && (
        <Card className="p-8 text-center text-sm text-zinc-500">
          No drafts match this filter.
        </Card>
      )}

      <ul className="space-y-2">
        {query.data?.drafts.map((d) => (
          <li key={d.id}>
            <Link
              href={`/posting/drafts/view?id=${d.id}`}
              className="block rounded-card border border-bg-graphite bg-bg-ink p-4 transition hover:border-gold/60"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-widest text-zinc-500">
                  <span className="font-mono text-gold">{d.id}</span>
                  <span>
                    {lookup(DRAFT_FORMAT, d.format).emoji} {lookup(DRAFT_FORMAT, d.format).label}
                  </span>
                  <span>{d.source}</span>
                </div>
                <Badge tone={d.status}>
                  {lookup(DRAFT_STATUS, d.status).emoji} {d.status}
                </Badge>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-zinc-200">{stripMarkdown(d.caption) || "(no caption)"}</p>
              <p className="mt-1 text-xs text-zinc-600">
                {new Date(d.created_at).toLocaleString()}
                {d.pillar && ` · ${d.pillar}`}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
