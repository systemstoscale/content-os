"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { lookup, DRAFT_FORMAT, DRAFT_STATUS } from "@/lib/labels";
import { stripMarkdown } from "@/lib/text";
import { Breadcrumb } from "@/components/ui/breadcrumb";

interface DraftSummary {
  id: string;
  created_at: number;
  status: string;
  format: string;
  caption: string;
  pillar: string | null;
  published_at: number | null;
  scheduled_for: string | null;
}

interface DraftListResponse {
  drafts: DraftSummary[];
}

interface CalItem {
  id: string;
  caption: string;
  format: string;
  status: string;
  kind: "published" | "scheduled";
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ContentCalendar() {
  const authed = useRequireAuth();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState<string>(dateKey(today));

  const query = useQuery<DraftListResponse>({
    queryKey: ["drafts-calendar"],
    queryFn: () => api.get("/api/drafts?limit=200"),
    enabled: authed === true,
  });

  if (!authed) return null;

  // Bucket each draft onto the day it (will) go live.
  const byDay = new Map<string, CalItem[]>();
  for (const d of query.data?.drafts ?? []) {
    let when: Date | null = null;
    let kind: CalItem["kind"] = "scheduled";
    if (d.status === "published" && d.published_at) {
      when = new Date(d.published_at);
      kind = "published";
    } else if (d.scheduled_for) {
      when = new Date(d.scheduled_for);
      kind = "scheduled";
    }
    if (!when || Number.isNaN(when.getTime())) continue;
    const key = dateKey(when);
    const arr = byDay.get(key);
    const item: CalItem = { id: d.id, caption: d.caption, format: d.format, status: d.status, kind };
    if (arr) arr.push(item);
    else byDay.set(key, [item]);
  }

  // Approved but unscheduled — they publish on the next cron, so there's no
  // calendar slot. Surface them separately so nothing hides.
  const queued = (query.data?.drafts ?? []).filter(
    (d) => d.status === "approved" && !d.scheduled_for && !d.published_at,
  );

  // Build the month grid (Monday-first).
  const firstOfMonth = new Date(cursor.y, cursor.m, 1);
  const monthLabel = firstOfMonth.toLocaleString(undefined, { month: "long", year: "numeric" });
  const leadBlanks = (firstOfMonth.getDay() + 6) % 7; // convert Sun=0 → Mon=0
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: leadBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = dateKey(today);
  const selectedItems = byDay.get(selected) ?? [];

  function shiftMonth(delta: number) {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Posting", href: "/posting/drafts" }, { label: "Calendar" }]} />
      <Link href="/posting/drafts" className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold">
        ← Drafts
      </Link>

      <header className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">📅 Content Calendar</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Published 🟢 and scheduled 🔵 posts. Tap a day to see what's going out.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="rounded-card border border-bg-graphite px-3 py-1.5 text-xs text-zinc-400 hover:text-gold">
            ‹
          </button>
          <button
            onClick={() => {
              setCursor({ y: today.getFullYear(), m: today.getMonth() });
              setSelected(todayKey);
            }}
            className="rounded-card border border-bg-graphite px-3 py-1.5 text-xs uppercase tracking-widest text-zinc-400 hover:text-gold"
          >
            Today
          </button>
          <button onClick={() => shiftMonth(1)} className="rounded-card border border-bg-graphite px-3 py-1.5 text-xs text-zinc-400 hover:text-gold">
            ›
          </button>
        </div>
      </header>

      {query.isLoading && <p className="text-sm text-zinc-500">Loading calendar…</p>}

      <Card className="mb-6 p-3 sm:p-5">
        <div className="mb-3 text-center font-display text-lg">{monthLabel}</div>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-1 text-center text-2xs uppercase tracking-widest text-zinc-600">
              {w}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day == null) return <div key={`b${i}`} />;
            const key = `${cursor.y}-${pad(cursor.m + 1)}-${pad(day)}`;
            const items = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            const isSelected = key === selected;
            return (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={`flex min-h-[3.5rem] flex-col rounded border p-1 text-left transition ${
                  isSelected
                    ? "border-gold bg-gold/10"
                    : isToday
                      ? "border-gold/40 bg-bg-ink"
                      : "border-bg-graphite/60 bg-bg-ink hover:border-bg-graphite"
                }`}
              >
                <span className={`text-2xs ${isToday ? "font-bold text-gold" : "text-zinc-400"}`}>{day}</span>
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {items.slice(0, 4).map((it) => (
                    <span key={it.id} title={`${it.kind}: ${stripMarkdown(it.caption).slice(0, 60)}`} className="text-2xs leading-none">
                      {it.kind === "published" ? "🟢" : "🔵"}
                    </span>
                  ))}
                  {items.length > 4 && <span className="text-[9px] text-zinc-500">+{items.length - 4}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* ── Selected-day detail ── */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs uppercase tracking-widest text-zinc-500">
          {new Date(`${selected}T00:00:00`).toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </h2>
        {selectedItems.length === 0 ? (
          <Card className="p-5 text-sm text-zinc-500">
            Nothing scheduled this day.{" "}
            <Link href="/posting/new" className="text-gold underline">
              Draft a post →
            </Link>
          </Card>
        ) : (
          <ul className="space-y-2">
            {selectedItems.map((it) => (
              <li key={it.id}>
                <Link
                  href={`/posting/drafts/view?id=${it.id}`}
                  className="block rounded-card border border-bg-graphite bg-bg-ink p-3 hover:border-gold/40"
                >
                  <div className="flex items-center gap-2 text-2xs uppercase tracking-widest text-zinc-500">
                    <span>{it.kind === "published" ? "🟢 Published" : "🔵 Scheduled"}</span>
                    <span>· {lookup(DRAFT_FORMAT, it.format).emoji} {lookup(DRAFT_FORMAT, it.format).label}</span>
                    <span>· {lookup(DRAFT_STATUS, it.status).emoji} {it.status}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-zinc-200">{stripMarkdown(it.caption)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Queued (no fixed slot) ── */}
      {queued.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-widest text-zinc-500">
            ⏳ Approved · publishing next cron ({queued.length})
          </h2>
          <ul className="space-y-2">
            {queued.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/posting/drafts/view?id=${d.id}`}
                  className="block rounded-card border border-bg-graphite/60 bg-bg-ink/60 p-3 hover:border-gold/40"
                >
                  <div className="text-2xs uppercase tracking-widest text-zinc-500">
                    {lookup(DRAFT_FORMAT, d.format).emoji} {lookup(DRAFT_FORMAT, d.format).label}
                  </div>
                  <p className="mt-1 line-clamp-1 text-sm text-zinc-300">{stripMarkdown(d.caption)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
