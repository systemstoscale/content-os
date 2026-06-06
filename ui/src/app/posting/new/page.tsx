"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Breadcrumb } from "@/components/ui/breadcrumb";

const FORMATS = [
  { id: "carousel", label: "Carousel", hint: "5–7 slides, single-quote-per-slide style" },
  { id: "quote_post", label: "Quote post", hint: "Single 1080x1080 image with a hero quote" },
  { id: "single_image", label: "Single image", hint: "One graphic post, no slides" },
  { id: "reel", label: "Reel", hint: "Process an uploaded MP4 — captions burned, cover rendered" },
  { id: "youtube", label: "YouTube long-form", hint: "Transcribe + chapter + 3 thumbnail variants" },
] as const;

type Format = (typeof FORMATS)[number]["id"];

interface ManualResponse {
  ok: boolean;
  sessionId?: string;
  error?: string | null;
}

export default function NewBrief() {
  const router = useRouter();
  const authed = useRequireAuth();
  const [brief, setBrief] = useState("");
  const [format, setFormat] = useState<Format>("carousel");
  const [pillar, setPillar] = useState("");

  const submit = useMutation<ManualResponse, Error, void>({
    mutationFn: () =>
      api.post("/api/posting/manual", {
        brief: brief.trim(),
        format,
        pillar: pillar.trim() || undefined,
      }),
  });

  if (!authed) return null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Posting", href: "/posting/drafts" }, { label: "New" }]} />
      <Link
        href="/posting/drafts"
        className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold"
      >
        ← All drafts
      </Link>

      <header className="mt-2 mb-8">
        <h1 className="font-display text-3xl">New content brief</h1>
        <p className="mt-2 text-sm text-zinc-400">
          The agent designs the post from your brief, renders assets, and saves a draft for approval. Takes ~3–6 minutes. You can close this tab — preview lands by email + Telegram.
        </p>
      </header>

      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          // Guard against double-submits: once the mutation is in-flight or
          // has already succeeded, ignore further submits. Prevents
          // duplicate drafts from rapid Enter/Click combos and from the
          // user-clicked-then-page-rendered-the-error edge case.
          if (!brief.trim() || submit.isPending || submit.isSuccess) return;
          submit.mutate();
        }}
      >
        <Field
          label="Brief"
          hint='Hook + angle + the takeaway. Example: "Russ Ruffino scaled to $100M without hiring more people. Carousel on systems > headcount."'
        >
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={6}
            placeholder="What's the post about?"
            className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 text-sm focus:border-gold focus:outline-none"
          />
        </Field>

        <Field label="Format">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormat(f.id)}
                className={`rounded-card border px-3 py-2 text-left text-sm transition ${
                  format === f.id
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-bg-graphite bg-bg-ink text-zinc-300 hover:border-gold/40"
                }`}
              >
                <div className="font-display text-xs uppercase">{f.label}</div>
                <div className="mt-0.5 text-xs text-zinc-500">{f.hint}</div>
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Pillar (optional)"
          hint="Tags the draft for content-balance tracking in /posting/calendar. Leave blank if unsure."
        >
          <input
            type="text"
            value={pillar}
            onChange={(e) => setPillar(e.target.value)}
            placeholder="e.g. systems_over_hiring"
            className="w-full rounded-card border border-bg-graphite bg-black px-3 py-2 font-mono text-sm focus:border-gold focus:outline-none"
          />
        </Field>

        {submit.error && (
          <Card className="bg-red-500/10 p-4 text-sm text-red-200">
            {String(submit.error)}
          </Card>
        )}

        {submit.data?.ok && submit.data.sessionId && (
          <Card>
            <CardBody className="space-y-2 text-sm">
              <p className="text-zinc-200">
                ✓ Session{" "}
                <span className="font-mono text-gold">{submit.data.sessionId}</span> finished.
              </p>
              <p className="text-xs text-zinc-500">
                The new draft is now in{" "}
                <Link href="/posting/drafts" className="underline">
                  /posting/drafts
                </Link>{" "}
                with status <code className="text-gold">pending</code>. Preview email + Telegram message also sent.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => router.push("/posting/drafts")}
              >
                Open drafts list
              </Button>
            </CardBody>
          </Card>
        )}

        <Button
          type="submit"
          disabled={submit.isPending || submit.isSuccess || !brief.trim()}
        >
          {submit.isPending ? "Designing… (~3–6 min)" : submit.isSuccess ? "Done ✓" : "Create draft"}
        </Button>
      </form>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-semibold text-white">{label}</div>
      {hint && <div className="mb-2 text-xs text-zinc-500">{hint}</div>}
      {children}
    </label>
  );
}
