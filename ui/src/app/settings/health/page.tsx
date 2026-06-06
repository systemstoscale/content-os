"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";

interface OauthEntry {
  provider: string;
  status: "connected" | "expired" | "missing";
  expires_at: number;
}

interface ConfigPair {
  key: string;
  value: string | null;
}

interface RecentSession {
  id: string;
  created_at: number;
  source: string;
  tool_calls: number;
  error: string | null;
  completed: boolean;
  intent_preview: string;
}

interface HealthFull {
  ok: boolean;
  creator: string;
  timezone: string;
  bindings: Record<string, "ok" | "missing" | "error">;
  oauth: OauthEntry[];
  telegram: "ok" | "missing" | "error";
  config: ConfigPair[];
  cron: {
    schedule_utc: string;
    last_run_at: number | null;
    last_run_completed: boolean;
    last_run_error: string | null;
  };
  recent_sessions: RecentSession[];
}

// Content OS has no OAuth providers — Zernio / KIE.AI / ElevenLabs are all
// API-key based. Left empty so no dead /oauth reconnect links render.
const OAUTH_RECONNECT: Record<string, string | undefined> = {};

export default function HealthSettings() {
  const authed = useRequireAuth();
  const health = useQuery<HealthFull>({
    queryKey: ["health-full"],
    queryFn: () => api.get("/api/health-full"),
    enabled: authed === true,
    refetchInterval: 60_000,
  });

  if (!authed) return null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Settings", href: "/settings" }, { label: "Health" }]} />
      <Link href="/" className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold">
        ← Dashboard
      </Link>

      <header className="mt-2 mb-8">
        <h1 className="font-display text-3xl">Settings · Health</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Bindings, OAuth tokens, configuration, and recent agent activity. Auto-refreshes every minute.
        </p>
      </header>

      {health.isLoading && <p className="text-sm text-zinc-500">Loading health…</p>}
      {health.error && (
        <Card className="bg-red-500/10 p-4 text-sm text-red-200">{String(health.error)}</Card>
      )}

      {health.data && (
        <div className="space-y-6">
          {/* ─── Bindings ─── */}
          <Card>
            <CardHeader>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                Worker bindings
              </h2>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(health.data.bindings).map(([k, v]) => (
                  <div
                    key={k}
                    className="rounded-card border border-bg-graphite bg-bg-charcoal px-3 py-2 text-xs"
                  >
                    <div className="font-mono text-zinc-500">{k}</div>
                    <div className={v === "ok" ? "text-gold" : "text-red-400"}>{v}</div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* ─── Telegram ─── */}
          <Card>
            <CardHeader>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                Telegram bot
              </h2>
            </CardHeader>
            <CardBody>
              {health.data.telegram === "ok" ? (
                <p className="text-sm text-gold">✅ Connected — bot token set and an owner chat is linked.</p>
              ) : health.data.telegram === "error" ? (
                <p className="text-sm text-yellow-500">
                  ⚠️ Bot token set, but no owner chat linked yet. Open your bot in Telegram and send{" "}
                  <span className="font-mono">/start</span> to link it.
                </p>
              ) : (
                <p className="text-sm text-zinc-500">
                  ❌ No bot token. Add <span className="font-mono">TELEGRAM_BOT_TOKEN</span> in Settings ·
                  Integrations to control everything from Telegram (optional).
                </p>
              )}
            </CardBody>
          </Card>

          {/* ─── OAuth ─── */}
          <Card>
            <CardHeader>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                OAuth connections
              </h2>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {health.data.oauth.map((o) => {
                  const reconnect = OAUTH_RECONNECT[o.provider];
                  const tone =
                    o.status === "connected"
                      ? "approved"
                      : o.status === "expired"
                        ? "pending"
                        : "failed";
                  return (
                    <div
                      key={o.provider}
                      className="rounded-card border border-bg-graphite bg-bg-charcoal px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-mono text-xs text-zinc-500">{o.provider}</div>
                          <Badge tone={tone}>{o.status}</Badge>
                        </div>
                        {o.status !== "connected" && reconnect && (
                          <a
                            href={reconnect}
                            className="rounded border border-gold/40 px-2 py-1 text-2xs uppercase tracking-widest text-gold hover:bg-gold/10"
                          >
                            Reconnect
                          </a>
                        )}
                      </div>
                      {o.status === "connected" && o.expires_at > 0 && (
                        <p className="mt-1 text-xs text-zinc-500">
                          Expires {new Date(o.expires_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          {/* ─── Cron ─── */}
          <Card>
            <CardHeader>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                Daily content cron
              </h2>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <Row
                label="Schedule (UTC)"
                value={<code className="text-xs text-gold">{health.data.cron.schedule_utc}</code>}
              />
              <Row
                label="Last run"
                value={
                  health.data.cron.last_run_at
                    ? new Date(health.data.cron.last_run_at).toLocaleString()
                    : "—"
                }
              />
              <Row
                label="Last result"
                value={
                  health.data.cron.last_run_error ? (
                    <span className="text-red-400">error</span>
                  ) : health.data.cron.last_run_completed ? (
                    <span className="text-gold">success</span>
                  ) : (
                    "—"
                  )
                }
              />
              {health.data.cron.last_run_error && (
                <p className="mt-1 text-xs text-red-300">
                  {health.data.cron.last_run_error.slice(0, 200)}
                </p>
              )}
            </CardBody>
          </Card>

          {/* ─── CONFIG values ─── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  Creator configuration
                </h2>
                <Link
                  href="/settings/config"
                  className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold"
                >
                  Edit →
                </Link>
              </div>
            </CardHeader>
            <CardBody className="space-y-1 text-sm">
              {health.data.config.map((c) => (
                <Row
                  key={c.key}
                  label={c.key}
                  value={
                    c.value ? (
                      <code className="text-xs text-zinc-300">{c.value}</code>
                    ) : (
                      <span className="text-zinc-600">unset</span>
                    )
                  }
                />
              ))}
            </CardBody>
          </Card>

          {/* ─── Recent sessions ─── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  Recent agent sessions ({health.data.recent_sessions.length})
                </h2>
                <Link
                  href="/settings/sessions"
                  className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold"
                >
                  View all →
                </Link>
              </div>
            </CardHeader>
            <CardBody>
              {health.data.recent_sessions.length === 0 ? (
                <p className="text-sm text-zinc-500">No sessions yet.</p>
              ) : (
                <ul className="space-y-1">
                  {health.data.recent_sessions.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/settings/sessions/view?id=${s.id}`}
                        className="flex items-start gap-3 rounded-card border border-bg-graphite bg-bg-charcoal px-3 py-2 text-xs transition hover:border-gold/60"
                      >
                        <div className="flex w-28 shrink-0 flex-col gap-1">
                          <span className="font-mono text-gold">{s.id}</span>
                          <span className="text-zinc-500">{s.source}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-zinc-300">{s.intent_preview}</p>
                          <p className="mt-1 text-zinc-600">
                            {new Date(s.created_at).toLocaleString()} · {s.tool_calls} tool call
                            {s.tool_calls === 1 ? "" : "s"}
                            {s.error ? (
                              <span className="ml-2 text-red-400">error</span>
                            ) : s.completed ? (
                              <span className="ml-2 text-gold">done</span>
                            ) : (
                              <span className="ml-2 text-zinc-500">pending</span>
                            )}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-widest text-zinc-500">{label}</span>
      <span className="text-right text-zinc-200">{value}</span>
    </div>
  );
}
