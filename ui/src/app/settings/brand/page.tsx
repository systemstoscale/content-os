"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Breadcrumb } from "@/components/ui/breadcrumb";

interface BrandKit {
  voice: string;
  business: string;
  hooks: string;
  pillars: string;
  belief: string;
}

const FIELDS: Array<{ key: keyof BrandKit; emoji: string; label: string; hint: string }> = [
  {
    key: "voice",
    emoji: "🗣️",
    label: "Voice fingerprint",
    hint: "How you sound — tone, cadence, phrases you use and ban. The AI matches this on every post.",
  },
  {
    key: "business",
    emoji: "🏢",
    label: "Business brief",
    hint: "Who you are, the offer, the proof, the audience. Grounds every claim so nothing is invented.",
  },
  {
    key: "hooks",
    emoji: "🪝",
    label: "Hook bank",
    hint: "Your best opening lines / angles. The AI pulls from these to start scroll-stopping posts.",
  },
  {
    key: "pillars",
    emoji: "🏛️",
    label: "Content pillars",
    hint: "The 3-5 themes you post about. Keeps the content on-message and balanced.",
  },
  {
    key: "belief",
    emoji: "🧠",
    label: "Belief shifts",
    hint: "Hidden objections → the belief that dissolves each one. Injected into content + ad ideation so every piece pre-sells by dismantling an objection. One per line: 'Objection → new belief'.",
  },
];

export default function BrandKitPage() {
  const authed = useRequireAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<BrandKit | null>(null);

  const kit = useQuery<BrandKit>({
    queryKey: ["brand"],
    queryFn: () => api.get("/api/brand"),
    enabled: authed === true,
  });

  useEffect(() => {
    if (kit.data && !form) setForm(kit.data);
  }, [kit.data, form]);

  const save = useMutation<{ ok: boolean }, Error, BrandKit>({
    mutationFn: (f) => api.post("/api/brand", f),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["brand"] }),
  });

  if (!authed) return null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Settings", href: "/settings" }, { label: "Brand" }]} />
      <header className="mb-8">
        <p className="mb-1 text-xs uppercase tracking-widest text-gold">Settings</p>
        <h1 className="font-display text-3xl">🎨 Brand kit</h1>
        <p className="mt-2 text-sm text-zinc-400">
          The foundation every post is written from. The AI reads all four on every brief — so a
          sharp brand kit is the difference between generic content and content that sounds like
          you. Markdown is fine.
        </p>
      </header>

      {kit.isLoading || !form ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block font-display text-base text-white">
                {f.emoji} {f.label}
              </label>
              <p className="mb-2 text-xs text-zinc-500">{f.hint}</p>
              <textarea
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                rows={f.key === "business" || f.key === "hooks" ? 8 : 6}
                className="w-full rounded-card border border-bg-graphite bg-bg-deep px-3 py-2 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-gold focus:outline-none"
                placeholder={`(empty — add your ${f.label.toLowerCase()})`}
              />
            </div>
          ))}

          <div className="flex items-center gap-3">
            <button
              onClick={() => form && save.mutate(form)}
              disabled={save.isPending}
              className="rounded-card bg-gold px-5 py-2.5 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save brand kit"}
            </button>
            {save.isSuccess && <span className="text-sm text-emerald-300">Saved ✅</span>}
            {save.isError && <span className="text-sm text-red-400">{save.error.message}</span>}
          </div>
        </div>
      )}
    </main>
  );
}
