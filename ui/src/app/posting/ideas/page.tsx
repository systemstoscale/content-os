"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { lookup, DRAFT_FORMAT } from "@/lib/labels";
import { Breadcrumb } from "@/components/ui/breadcrumb";

interface Idea {
  id: string;
  hook: string;
  angle: string | null;
  pillar: string | null;
  format_hint: string | null;
}

const VALID_FORMATS = new Set([
  "carousel",
  "quote_post",
  "single_image",
  "reel",
  "youtube",
  "text_post",
]);

export default function IdeasPage() {
  const authed = useRequireAuth();
  const qc = useQueryClient();
  const [topic, setTopic] = useState("");

  const list = useQuery<{ ideas: Idea[] }>({
    queryKey: ["content-ideas"],
    queryFn: () => api.get("/api/ideas"),
    enabled: authed === true,
  });

  const generate = useMutation<{ ok: boolean; inserted: number }, Error, void>({
    mutationFn: () => api.post("/api/ideas/generate", { topic: topic.trim() || undefined }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["content-ideas"] }),
  });

  // "Draft this": kick the content pipeline with the idea, then mark it used.
  const draftIt = useMutation<unknown, Error, Idea>({
    mutationFn: async (idea) => {
      const brief = [idea.hook, idea.angle].filter(Boolean).join(" — ");
      const format =
        idea.format_hint && VALID_FORMATS.has(idea.format_hint) ? idea.format_hint : undefined;
      await api.post("/api/posting/manual", { brief, format, pillar: idea.pillar ?? undefined });
      await api.post(`/api/ideas/${idea.id}`, { action: "use" });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["content-ideas"] }),
  });

  const dismiss = useMutation<unknown, Error, string>({
    mutationFn: (id) => api.post(`/api/ideas/${id}`, { action: "dismiss" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["content-ideas"] }),
  });

  if (!authed) return null;
  const ideas = list.data?.ideas ?? [];

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Posting", href: "/posting/drafts" }, { label: "Ideas" }]} />
      <header className="mb-8">
        <div className="flex items-baseline justify-between">
          <p className="mb-1 text-xs uppercase tracking-widest text-gold">Posting</p>
          <Link
            href="/posting/drafts"
            className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold"
          >
            Drafts
          </Link>
        </div>
        <h1 className="font-display text-3xl">💡 Idea bank</h1>
        <p className="mt-2 text-sm text-zinc-400">
          AI-generated post ideas from your brand kit. Dismiss the weak ones, and one-tap
          &quot;Draft this&quot; to send a winner to the content pipeline — the post lands in your
          drafts + Telegram for approval.
        </p>
      </header>

      <section className="mb-6 rounded-card border border-bg-graphite bg-bg-ink p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Optional: focus topic (e.g. hiring vs systems). Blank = across all pillars."
            className="flex-1 rounded-card border border-bg-graphite bg-bg-deep px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-gold focus:outline-none"
          />
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="rounded-card bg-gold px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50"
          >
            {generate.isPending ? "Thinking…" : "✨ Generate ideas"}
          </button>
        </div>
        {generate.isError && <p className="mt-2 text-xs text-red-400">{generate.error.message}</p>}
        {generate.data && (
          <p className="mt-2 text-xs text-emerald-300">Added {generate.data.inserted} ideas.</p>
        )}
      </section>

      {list.isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
      {!list.isLoading && ideas.length === 0 && (
        <div className="rounded-card border border-bg-graphite bg-bg-ink p-6 text-center text-sm text-zinc-500">
          No ideas yet. Tap ✨ Generate to fill the bank from your brand kit.
        </div>
      )}

      <div className="space-y-3">
        {ideas.map((idea) => {
          const fmt = idea.format_hint ? lookup(DRAFT_FORMAT, idea.format_hint) : null;
          return (
            <div key={idea.id} className="rounded-card border border-bg-graphite bg-bg-ink p-4">
              <p className="font-medium text-white">{idea.hook}</p>
              {idea.angle && <p className="mt-1 text-sm text-zinc-400">{idea.angle}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs uppercase tracking-widest text-zinc-500">
                {idea.pillar && <span className="rounded bg-bg-charcoal px-2 py-0.5">{idea.pillar}</span>}
                {fmt && (
                  <span className="rounded bg-bg-charcoal px-2 py-0.5">
                    {fmt.emoji} {fmt.label}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => draftIt.mutate(idea)}
                  disabled={draftIt.isPending}
                  className="rounded-card bg-gold px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-black hover:opacity-90 disabled:opacity-50"
                >
                  ✨ Draft this
                </button>
                <button
                  onClick={() => dismiss.mutate(idea.id)}
                  disabled={dismiss.isPending}
                  className="rounded-card border border-bg-graphite px-3 py-1.5 text-xs uppercase tracking-widest text-zinc-500 hover:text-white disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
