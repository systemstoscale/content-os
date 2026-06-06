"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";

interface SessionSummary {
  id: string;
  created_at: number;
  source: string;
  intent_preview: string;
  tool_calls: number;
  error: string | null;
  completed: boolean;
}

interface ListResponse {
  sessions: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
}

const SOURCES = ["all", "manual", "cron", "telegram", "upload", "email"] as const;
type SourceTab = (typeof SOURCES)[number];

export default function SessionsList() {
  const authed = useRequireAuth();
  const [source, setSource] = useState<SourceTab>("all");
  const [onlyErrors, setOnlyErrors] = useState(false);

  const list = useQuery<ListResponse>({
    queryKey: ["sessions-list", { source, onlyErrors }],
    queryFn: () => {
      const p = new URLSearchParams();
      if (source !== "all") p.set("source", source);
      if (onlyErrors) p.set("errors", "1");
      p.set("limit", "50");
      return api.get(`/api/sessions?${p.toString()}`);
    },
    enabled: authed === true,
  });

  if (!authed) return null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Settings", href: "/settings" }, { label: "Sessions" }]} />
      <Link href="/settings/health" className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold">
        ← Health
      </Link>

      <header className="mt-2 mb-6">
        <h1 className="font-display text-3xl">Settings · Sessions</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Every agent run, oldest at the bottom. Click into a session to see
          the full intent + outcome + error trace — useful when a draft didn't
          show up where you expected.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-card border border-bg-graphite bg-bg-ink p-1">
          {SOURCES.map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`min-h-9 rounded px-3 py-2 text-xs uppercase tracking-widest transition ${
                source === s ? "bg-gold text-black" : "text-zinc-400 hover:text-white"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-card border border-bg-graphite bg-bg-ink px-3 py-2 text-xs uppercase tracking-widest text-zinc-300">
          <input
            type="checkbox"
            checked={onlyErrors}
            onChange={(e) => setOnlyErrors(e.target.checked)}
            className="accent-gold"
          />
          Errors only
        </label>
        {list.data && (
          <span className="ml-auto text-xs text-zinc-500">
            {list.data.total} total
          </span>
        )}
      </div>

      {list.isLoading && <p className="text-sm text-zinc-500">Loading sessions…</p>}
      {list.error && (
        <Card className="bg-red-500/10 p-4 text-sm text-red-200">{String(list.error)}</Card>
      )}

      <ul className="space-y-2">
        {list.data?.sessions.map((s) => (
          <li key={s.id}>
            <Link
              href={`/settings/sessions/view?id=${s.id}`}
              className="block rounded-card border border-bg-graphite bg-bg-ink p-4 transition hover:border-gold/60"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-500">
                  <span className="font-mono text-gold">{s.id}</span>
                  <span>{s.source}</span>
                  <span>{s.tool_calls} tool calls</span>
                </div>
                {s.error ? (
                  <Badge tone="failed">❌ error</Badge>
                ) : s.completed ? (
                  <Badge tone="approved">✅ done</Badge>
                ) : (
                  <Badge tone="pending">⏳ pending</Badge>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-zinc-200">{s.intent_preview}</p>
              <p className="mt-1 text-xs text-zinc-600">{new Date(s.created_at).toLocaleString()}</p>
              {s.error && (
                <p className="mt-2 line-clamp-1 text-xs text-red-300">{s.error}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {list.data?.sessions.length === 0 && (
        <Card className="p-8 text-center text-sm text-zinc-500">
          No sessions matching this filter.
        </Card>
      )}
    </main>
  );
}
