"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";

interface SessionDetail {
  id: string;
  created_at: number;
  source: string;
  intent: string;
  outcome: string | null;
  tool_calls: number;
  error: string | null;
}

export default function SessionView() {
  return (
    <Suspense fallback={<p className="mx-auto max-w-4xl px-6 py-10 text-sm text-zinc-500">Loading…</p>}>
      <SessionViewInner />
    </Suspense>
  );
}

function SessionViewInner() {
  const search = useSearchParams();
  const id = search.get("id") ?? "";
  const authed = useRequireAuth();

  const detail = useQuery<{ session: SessionDetail }>({
    queryKey: ["session", id],
    queryFn: () => api.get(`/api/sessions/${id}`),
    enabled: authed === true && Boolean(id),
  });

  if (!authed) return null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Settings", href: "/settings" }, { label: "Sessions", href: "/settings/sessions" }, { label: "Session" }]} />
      <Link href="/settings/sessions" className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold">
        ← All sessions
      </Link>

      {detail.isLoading && <p className="mt-6 text-sm text-zinc-500">Loading session…</p>}
      {detail.error && (
        <Card className="mt-6 bg-red-500/10 p-4 text-sm text-red-200">{String(detail.error)}</Card>
      )}

      {detail.data && (
        <>
          <header className="mt-2 mb-6 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl">{detail.data.session.id}</h1>
            {detail.data.session.error ? (
              <Badge tone="failed">error</Badge>
            ) : detail.data.session.outcome ? (
              <Badge tone="approved">done</Badge>
            ) : (
              <Badge tone="pending">pending</Badge>
            )}
            <span className="text-xs uppercase tracking-widest text-zinc-500">{detail.data.session.source}</span>
            <span className="text-xs text-zinc-500">
              {new Date(detail.data.session.created_at).toLocaleString()}
            </span>
            <span className="text-xs text-zinc-500">{detail.data.session.tool_calls} tool calls</span>
          </header>

          <Card className="mb-4">
            <CardHeader>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Intent</h2>
            </CardHeader>
            <CardBody>
              <pre className="whitespace-pre-wrap break-words font-body text-sm text-zinc-100">
                {detail.data.session.intent}
              </pre>
            </CardBody>
          </Card>

          {detail.data.session.outcome && (
            <Card className="mb-4">
              <CardHeader>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Outcome</h2>
              </CardHeader>
              <CardBody>
                <pre className="whitespace-pre-wrap break-words font-body text-sm text-zinc-100">
                  {detail.data.session.outcome}
                </pre>
              </CardBody>
            </Card>
          )}

          {detail.data.session.error && (
            <Card className="mb-4 border-red-500/40 bg-red-500/10">
              <CardHeader>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-red-300">Error</h2>
              </CardHeader>
              <CardBody>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs text-red-200">
                  {detail.data.session.error}
                </pre>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
