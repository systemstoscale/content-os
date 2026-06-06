"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { stripMarkdown } from "@/lib/text";

interface PostAnalytics {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  views?: number;
  engagementRate?: number;
}

interface PlatformEntry {
  platform: string;
  account: string | null;
  status: string | null;
  platform_post_id: string | null;
  analytics: PostAnalytics | null;
}

interface AnalyticsPost {
  id: string;
  content: string;
  published_at: string | null;
  status: string;
  analytics: PostAnalytics;
  platforms: PlatformEntry[];
}

interface AnalyticsAccount {
  id: string;
  platform: string;
  username: string;
  display_name: string | null;
  profile_picture: string | null;
  followers: number | null;
  followers_updated_at: string | null;
}

interface BestTimeSlot {
  day_of_week: number;
  hour: number;
  avg_engagement: number;
  post_count: number;
}

interface DailyPoint {
  date: string;
  post_count: number;
  impressions: number;
  reach: number;
  engagements: number;
  views: number;
  clicks: number;
  platforms: Record<string, number>;
}

interface AnalyticsResponse {
  ok: boolean;
  overview: {
    totalPosts?: number;
    publishedPosts?: number;
    scheduledPosts?: number;
    lastSync?: string;
  } | null;
  has_access: boolean | null;
  posts: AnalyticsPost[];
  accounts: AnalyticsAccount[];
  best_times: BestTimeSlot[];
  daily_metrics: DailyPoint[];
}

export default function Analytics() {
  const authed = useRequireAuth();
  const [limit, setLimit] = useState(20);

  const q = useQuery<AnalyticsResponse>({
    queryKey: ["analytics", limit],
    queryFn: () => api.get(`/api/analytics?limit=${limit}`),
    enabled: authed === true,
  });

  if (!authed) return null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Analytics" }]} />

      <header className="mt-2 mb-8">
        <h1 className="font-display text-3xl">Analytics</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Cross-platform performance for your most recent posts. Pulled from Zernio's analytics API.
        </p>
      </header>

      {q.isLoading && <p className="text-sm text-zinc-500">Loading analytics…</p>}
      {q.error && (
        <Card className="bg-red-500/10 p-4 text-sm text-red-200">{String(q.error)}</Card>
      )}

      {q.data && (
        <>
          {q.data.overview && (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total posts" value={q.data.overview.totalPosts ?? 0} />
              <Stat label="Published" value={q.data.overview.publishedPosts ?? 0} />
              <Stat label="Scheduled" value={q.data.overview.scheduledPosts ?? 0} />
              <Stat
                label="Last sync"
                value={
                  q.data.overview.lastSync
                    ? relativeTime(q.data.overview.lastSync)
                    : "—"
                }
              />
            </div>
          )}

          {q.data.daily_metrics.length > 1 && (
            <Card className="mb-6">
              <CardHeader>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  Daily performance
                </h2>
              </CardHeader>
              <CardBody>
                <DailyMetricsChart points={q.data.daily_metrics} />
              </CardBody>
            </Card>
          )}

          {q.data.best_times.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  Best times to post (UTC)
                </h2>
              </CardHeader>
              <CardBody>
                <BestTimesHeatmap slots={q.data.best_times} />
              </CardBody>
            </Card>
          )}

          {q.data.accounts.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  Connected accounts ({q.data.accounts.length})
                </h2>
              </CardHeader>
              <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {q.data.accounts.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 rounded-card border border-bg-graphite bg-bg-charcoal px-2 py-2 text-xs"
                  >
                    {a.profile_picture ? (
                      <img
                        src={a.profile_picture}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-8 w-8 shrink-0 rounded-full bg-bg-graphite" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-zinc-200">{a.username}</div>
                      <div className="text-zinc-500">
                        {a.platform} · {a.followers != null ? abbrev(a.followers) : "—"} followers
                      </div>
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  Recent posts ({q.data.posts.length})
                </h2>
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="rounded-card border border-bg-graphite bg-bg-charcoal px-2 py-1 text-xs text-zinc-300"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </CardHeader>
            <CardBody>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead>
                    <tr className="text-zinc-500 [&_th]:py-2 [&_th]:pr-3 [&_th]:font-normal [&_th]:uppercase [&_th]:tracking-widest">
                      <th>Posted</th>
                      <th className="w-1/3">Content</th>
                      <th>Platforms</th>
                      <th className="text-right">Imp.</th>
                      <th className="text-right">Reach</th>
                      <th className="text-right">Likes</th>
                      <th className="text-right">Comm.</th>
                      <th className="text-right">Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.posts.map((p) => (
                      <tr
                        key={p.id}
                        className="border-t border-bg-graphite [&_td]:py-3 [&_td]:pr-3"
                      >
                        <td className="text-zinc-500">
                          {p.published_at
                            ? new Date(p.published_at).toLocaleDateString()
                            : "—"}
                        </td>
                        <td>
                          <p className="line-clamp-2 text-zinc-200">{p.content || "(no caption)"}</p>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {p.platforms.map((pl) => (
                              <Badge
                                key={`${pl.platform}-${pl.platform_post_id ?? pl.account ?? ""}`}
                                tone={pl.status === "published" ? "approved" : "neutral"}
                              >
                                {pl.platform}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="text-right text-zinc-300">{abbrev(p.analytics.impressions ?? 0)}</td>
                        <td className="text-right text-zinc-300">{abbrev(p.analytics.reach ?? 0)}</td>
                        <td className="text-right text-zinc-300">{abbrev(p.analytics.likes ?? 0)}</td>
                        <td className="text-right text-zinc-300">{abbrev(p.analytics.comments ?? 0)}</td>
                        <td className="text-right text-zinc-300">{abbrev(p.analytics.clicks ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="space-y-3 md:hidden">
                {q.data.posts.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-card border border-bg-graphite bg-bg-charcoal p-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-2xs uppercase tracking-widest text-zinc-500">
                      <span>
                        {p.published_at ? new Date(p.published_at).toLocaleDateString() : "—"}
                      </span>
                      <div className="flex flex-wrap justify-end gap-1">
                        {p.platforms.map((pl) => (
                          <Badge
                            key={`${pl.platform}-${pl.platform_post_id ?? pl.account ?? ""}`}
                            tone={pl.status === "published" ? "approved" : "neutral"}
                          >
                            {pl.platform}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm text-zinc-200">
                      {stripMarkdown(p.content) || "(no caption)"}
                    </p>
                    <div className="mt-2 grid grid-cols-5 gap-1 border-t border-bg-graphite/60 pt-2 text-center text-2xs">
                      {(
                        [
                          ["Imp", p.analytics.impressions],
                          ["Reach", p.analytics.reach],
                          ["Likes", p.analytics.likes],
                          ["Comm", p.analytics.comments],
                          ["Clicks", p.analytics.clicks],
                        ] as const
                      ).map(([label, v]) => (
                        <div key={label}>
                          <div className="text-[9px] uppercase tracking-widest text-zinc-600">
                            {label}
                          </div>
                          <div className="text-zinc-200">{abbrev(v ?? 0)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-card border border-bg-graphite bg-bg-ink px-3 py-3">
      <div className="text-xs uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="mt-1 font-display text-xl text-white">
        {typeof value === "number" ? abbrev(value) : value}
      </div>
    </div>
  );
}

function abbrev(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Inline SVG line chart of impressions + post count over time. No
 *  external charting library — the data shape is small enough (~30-200
 *  points) that a hand-rolled polyline with manual scaling does the job
 *  and avoids 50kB of recharts/visx. */
function DailyMetricsChart({ points }: { points: DailyPoint[] }) {
  const W = 720;
  const H = 220;
  const PAD = { top: 12, right: 20, bottom: 28, left: 44 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // Time domain: oldest → newest. Linear x by index since dates may have gaps.
  const n = points.length;
  const maxImpr = Math.max(1, ...points.map((p) => p.impressions));
  const maxPosts = Math.max(1, ...points.map((p) => p.post_count));

  const xAt = (i: number) => PAD.left + (innerW * i) / Math.max(1, n - 1);
  const yImprAt = (v: number) => PAD.top + innerH - (innerH * v) / maxImpr;
  const yPostsAt = (v: number) => PAD.top + innerH - (innerH * v) / maxPosts;

  const impressionsPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yImprAt(p.impressions).toFixed(1)}`)
    .join(" ");

  // X-axis labels: 5 evenly-spaced dates.
  const labelIndices = n <= 5 ? points.map((_, i) => i) : [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1];

  const totalImpressions = points.reduce((s, p) => s + p.impressions, 0);
  const totalPosts = points.reduce((s, p) => s + p.post_count, 0);
  const totalEngagements = points.reduce((s, p) => s + p.engagements, 0);

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <KPI label="Days tracked" value={n.toString()} />
        <KPI label="Total posts" value={totalPosts.toString()} />
        <KPI label="Total impressions" value={abbrev(totalImpressions)} />
        <KPI label="Total engagements" value={abbrev(totalEngagements)} />
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" preserveAspectRatio="none">
          {/* Y-grid */}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={PAD.left}
              y1={PAD.top + innerH * (1 - f)}
              x2={W - PAD.right}
              y2={PAD.top + innerH * (1 - f)}
              stroke="#222"
              strokeDasharray="2 4"
            />
          ))}
          {/* Y axis ticks */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text
              key={f}
              x={PAD.left - 6}
              y={PAD.top + innerH * (1 - f) + 4}
              textAnchor="end"
              className="fill-zinc-500"
              style={{ fontSize: 10 }}
            >
              {abbrev(Math.round(maxImpr * f))}
            </text>
          ))}
          {/* Post-count bars (gold, low opacity, behind line) */}
          {points.map((p, i) => {
            const y = yPostsAt(p.post_count);
            const x = xAt(i);
            const barW = Math.max(2, (innerW / n) * 0.6);
            return (
              <rect
                key={p.date}
                x={x - barW / 2}
                y={y}
                width={barW}
                height={PAD.top + innerH - y}
                fill="#f8d380"
                opacity={0.18}
              />
            );
          })}
          {/* Impressions line */}
          <path d={impressionsPath} fill="none" stroke="#f8d380" strokeWidth={2} />
          {/* Point dots with tooltips */}
          {points.map((p, i) => (
            <g key={p.date}>
              <circle cx={xAt(i)} cy={yImprAt(p.impressions)} r={3} fill="#f8d380" />
              <title>
                {p.date}: {p.impressions.toLocaleString()} impressions across {p.post_count} post
                {p.post_count === 1 ? "" : "s"} ({Object.keys(p.platforms).join(", ")})
              </title>
            </g>
          ))}
          {/* X-axis labels */}
          {labelIndices.map((i) => (
            <text
              key={i}
              x={xAt(i)}
              y={H - 8}
              textAnchor="middle"
              className="fill-zinc-500"
              style={{ fontSize: 10 }}
            >
              {points[i]?.date.slice(5) /* MM-DD */}
            </text>
          ))}
        </svg>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Gold line = impressions per day. Gold bars = posts per day. Hover any point for the platform breakdown.
      </p>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-bg-graphite bg-bg-charcoal px-3 py-2">
      <div className="text-2xs uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="mt-0.5 font-display text-base text-white">{value}</div>
    </div>
  );
}

/** 7-day × 24-hour heatmap of avg_engagement, painted in gold opacity.
 *  Slots without data render as bg-charcoal. The 5 highest-engagement
 *  cells get a gold border so they pop visually. */
function BestTimesHeatmap({ slots }: { slots: BestTimeSlot[] }) {
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const HOURS = Array.from({ length: 24 }, (_, h) => h);

  const byDayHour = new Map<string, BestTimeSlot>();
  for (const s of slots) byDayHour.set(`${s.day_of_week}-${s.hour}`, s);

  const maxEng = Math.max(1, ...slots.map((s) => s.avg_engagement));
  const top5 = new Set(
    [...slots]
      .sort((a, b) => b.avg_engagement - a.avg_engagement)
      .slice(0, 5)
      .map((s) => `${s.day_of_week}-${s.hour}`),
  );

  return (
    <div className="overflow-x-auto">
      <table className="text-2xs">
        <thead>
          <tr>
            <th className="px-1 py-0.5 text-right text-zinc-500"></th>
            {HOURS.map((h) => (
              <th key={h} className="px-0.5 py-0.5 text-zinc-500 font-normal">
                {h % 3 === 0 ? h : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DOW.map((label, dow) => (
            <tr key={dow}>
              <td className="px-1 py-0.5 pr-2 text-right text-zinc-500">{label}</td>
              {HOURS.map((h) => {
                const slot = byDayHour.get(`${dow}-${h}`);
                const intensity = slot ? slot.avg_engagement / maxEng : 0;
                const isTop = slot && top5.has(`${dow}-${h}`);
                const bg = slot
                  ? `rgba(248, 211, 128, ${0.15 + 0.85 * intensity})`
                  : "#222";
                return (
                  <td
                    key={h}
                    title={
                      slot
                        ? `${label} ${h}:00 — avg ${slot.avg_engagement} engagement on ${slot.post_count} post${slot.post_count === 1 ? "" : "s"}`
                        : `${label} ${h}:00 — no data`
                    }
                    className={`h-5 w-5 ${isTop ? "ring-1 ring-gold" : ""}`}
                    style={{ background: bg }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-zinc-500">
        Gold-ringed cells = top 5 engagement windows from your post history. Hover for details.
      </p>
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
