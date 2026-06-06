"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Markdown } from "@/components/Markdown";
import { MediaThumb } from "@/components/MediaLightbox";
import { stripMarkdown } from "@/lib/text";
import { Breadcrumb } from "@/components/ui/breadcrumb";

interface YouTubeMetadata {
  zernio_account_id: string;
  titles: string[];
  description: string;
  chapters: Array<{ start_seconds: number; label: string }>;
  tags: string[];
  thumbnail_urls: string[];
  video_url: string;
}

interface DraftPayload {
  asset_urls: string[];
  platforms: Array<{ platform: string; accountId: string; content?: string }>;
  thumbnail_url?: string;
  scheduled_for?: string;
  youtube?: YouTubeMetadata;
}

interface Draft {
  id: string;
  created_at: number;
  source: string;
  status: "pending" | "approved" | "published" | "rejected" | "failed";
  format: string;
  caption: string;
  pillar: string | null;
  payload: DraftPayload;
  published_at: number | null;
  zernio_post_id: string | null;
}

// useSearchParams needs to be inside a Suspense boundary for Next.js
// static export prerendering. The default export is a tiny shell that
// provides the boundary; DraftDetailInner does the actual work.
export default function DraftDetail() {
  return (
    <Suspense fallback={<p className="mx-auto max-w-4xl px-6 py-10 text-sm text-zinc-500">Loading…</p>}>
      <DraftDetailInner />
    </Suspense>
  );
}

function DraftDetailInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const queryClient = useQueryClient();
  const authed = useRequireAuth();
  const [actionError, setActionError] = useState<string | null>(null);

  const draft = useQuery<{ draft: Draft }>({
    queryKey: ["draft", id],
    queryFn: () => api.get(`/api/drafts/${id}`),
    enabled: authed === true && Boolean(id),
  });

  const approve = useMutation({
    mutationFn: (publish: boolean) => api.post(`/api/drafts/${id}/approve`, { publish }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["draft", id] });
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
    },
    onError: (e) => setActionError(String(e)),
  });

  const reject = useMutation({
    mutationFn: () => api.post(`/api/drafts/${id}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["draft", id] });
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
    },
    onError: (e) => setActionError(String(e)),
  });

  // Repurpose: spin this post into a new format via the content pipeline. The
  // agent adapts the core idea + voice to the target format and saves a fresh
  // draft (lands in your drafts + Telegram for approval).
  const repurpose = useMutation<unknown, Error, { format: string; caption: string }>({
    mutationFn: ({ format, caption }) =>
      api.post("/api/posting/manual", {
        brief: `Repurpose this existing post into a ${format.replace(/_/g, " ")}. Keep the core idea + my voice; adapt the structure to the new format. Source post:\n\n${caption}`,
        format,
      }),
    onError: (e) => setActionError(String(e)),
  });

  if (!authed) return null;

  const d = draft.data?.draft;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Posting", href: "/posting/drafts" }, { label: "Draft" }]} />
      <Link href="/posting/drafts" className="text-xs uppercase tracking-widest text-zinc-500 hover:text-gold">
        ← All drafts
      </Link>

      {draft.isLoading && <p className="mt-6 text-sm text-zinc-500">Loading draft…</p>}
      {draft.error && (
        <Card className="mt-6 bg-red-500/10 p-5 text-sm text-red-200">{String(draft.error)}</Card>
      )}

      {d && (
        <>
          <header className="mt-2 mb-6 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl">{d.id}</h1>
            <Badge tone={d.status}>{d.status}</Badge>
            <span className="text-xs uppercase tracking-widest text-zinc-500">{d.format}</span>
            <span className="text-xs uppercase tracking-widest text-zinc-500">{d.source}</span>
          </header>

          {actionError && (
            <Card className="mb-4 bg-red-500/10 p-3 text-sm text-red-200">{actionError}</Card>
          )}

          <Card className="mb-6">
            <CardHeader>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Caption</h2>
            </CardHeader>
            <CardBody>
              <Markdown>{d.caption}</Markdown>
              {d.pillar && (
                <p className="mt-3 text-xs text-zinc-500">Pillar: {d.pillar}</p>
              )}
            </CardBody>
          </Card>

          {/* Repurpose — spin this post into another format */}
          <Card className="mb-6">
            <CardHeader>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                ♻️ Repurpose into another format
              </h2>
            </CardHeader>
            <CardBody>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["carousel", "🎠 Carousel"],
                    ["quote_post", "💬 Quote"],
                    ["reel", "🎬 Reel"],
                    ["text_post", "📝 Text"],
                  ] as const
                ).map(([fmt, label]) => (
                  <button
                    key={fmt}
                    onClick={() => repurpose.mutate({ format: fmt, caption: d.caption })}
                    disabled={repurpose.isPending}
                    className="rounded-card border border-bg-graphite px-3 py-1.5 text-xs uppercase tracking-widest text-zinc-300 hover:border-gold/60 disabled:opacity-50"
                  >
                    {label}
                  </button>
                ))}
                <button
                  onClick={() =>
                    (["carousel", "quote_post", "reel", "text_post"] as const).forEach((fmt) =>
                      repurpose.mutate({ format: fmt, caption: d.caption }),
                    )
                  }
                  disabled={repurpose.isPending}
                  className="rounded-card border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs uppercase tracking-widest text-gold hover:bg-gold/20 disabled:opacity-50"
                  title="Spin this long-form into a carousel, quote, reel, and text post — all at once"
                >
                  ⚡ Full set
                </button>
              </div>
              {repurpose.isPending && (
                <p className="mt-2 text-xs text-zinc-500">Kicking the agent… preview lands in Telegram + your drafts.</p>
              )}
              {repurpose.isSuccess && (
                <p className="mt-2 text-xs text-emerald-300">
                  ✅ Repurpose started — the new draft will appear in your drafts shortly.
                </p>
              )}
            </CardBody>
          </Card>

          {d.payload?.asset_urls?.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  Assets ({d.payload.asset_urls.length})
                </h2>
              </CardHeader>
              <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {d.payload.asset_urls.map((url, i) => (
                  <MediaThumb key={i} url={url} />
                ))}
              </CardBody>
            </Card>
          )}

          {d.payload?.youtube && (
            <Card className="mb-6">
              <CardHeader>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  YouTube metadata
                </h2>
              </CardHeader>
              <CardBody className="space-y-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-widest text-zinc-500">Titles</p>
                  <ol className="mt-1 list-decimal pl-5 text-zinc-200">
                    {d.payload.youtube.titles.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ol>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-zinc-500">Chapters</p>
                  <ul className="mt-1 font-mono text-xs text-zinc-300">
                    {d.payload.youtube.chapters.map((c, i) => (
                      <li key={i}>
                        {formatTime(c.start_seconds)} — {c.label}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-zinc-500">Tags</p>
                  <p className="mt-1 text-xs text-zinc-300">{d.payload.youtube.tags.join(", ")}</p>
                </div>
              </CardBody>
            </Card>
          )}

          <div className="flex flex-wrap gap-3">
            {d.status === "pending" && (
              <>
                <Button
                  onClick={() => approve.mutate(true)}
                  disabled={approve.isPending}
                >
                  {approve.isPending ? "Publishing…" : "Approve + publish now"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => approve.mutate(false)}
                  disabled={approve.isPending}
                >
                  Approve (publish later via cron)
                </Button>
                <Button
                  variant="danger"
                  onClick={() => reject.mutate()}
                  disabled={reject.isPending}
                >
                  Reject
                </Button>
              </>
            )}

            <CrossPostButton
              draftId={d.id}
              caption={d.caption}
              hasMedia={(d.payload?.asset_urls?.length ?? 0) > 0}
            />

            {d.status === "approved" && (
              <Button onClick={() => approve.mutate(true)} disabled={approve.isPending}>
                {approve.isPending ? "Publishing…" : "Publish now"}
              </Button>
            )}

            {d.status === "published" && d.zernio_post_id && (
              <div className="text-xs text-zinc-500">
                Published {d.published_at ? new Date(d.published_at).toLocaleString() : ""} ·
                Zernio post <span className="font-mono text-gold">{d.zernio_post_id}</span>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}

/** Cross-post action: fan a draft out to any subset of connected platforms
 *  via Zernio. When the draft has rendered assets, the real media (image or
 *  video) is carried; otherwise it's a caption-only post.
 *
 *  Multi-account handling: when the user has >1 account on a platform
 *  (e.g. Max has both his personal LinkedIn and Skalers' LinkedIn), the
 *  modal shows a dropdown to pick the target account. We pass the picked
 *  IDs parallel to the platforms array to the API. */
function CrossPostButton({
  draftId,
  caption,
  hasMedia,
}: {
  draftId: string;
  caption: string;
  hasMedia: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Selected platform → account_id mapping. Empty string = auto/single account.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"scheduled" | "publish_now" | "is_draft">("scheduled");

  // Lazy-fetch the connected accounts when the modal opens, so we can
  // surface multi-account dropdowns where needed.
  const accountsQ = useQuery<{
    accounts: { id: string; platform: string; username: string; display_name: string | null }[];
  }>({
    queryKey: ["analytics-accounts-lite"],
    queryFn: () => api.get("/api/analytics?limit=1"),
    enabled: open,
  });

  // Group accounts by platform.
  const byPlatform = (accountsQ.data?.accounts ?? []).reduce<
    Record<string, { id: string; label: string }[]>
  >((acc, a) => {
    (acc[a.platform] ??= []).push({ id: a.id, label: a.display_name || a.username });
    return acc;
  }, {});

  // Platform list — only show platforms the user actually has accounts on.
  const PLATFORMS = Object.keys(byPlatform).sort();

  const selected = Object.keys(picks);

  const submit = useMutation<{ ok: boolean; message: string; platforms: string[] }, Error, void>({
    mutationFn: () => {
      const platforms = selected;
      const account_ids = platforms.map((p) => picks[p] || "");
      return api.post("/api/posting/cross-post", {
        draft_id: draftId,
        platforms,
        account_ids,
        publish_now: mode === "publish_now",
        is_draft: mode === "is_draft",
      });
    },
  });

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {hasMedia ? "📤 Cross-post →" : "📤 Cross-post text →"}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-card border border-bg-graphite bg-bg-deep p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 font-display text-base">Cross-post to other platforms</h3>
            <p className="mb-4 text-xs text-zinc-500">
              {hasMedia
                ? "Fans out your caption + the rendered media to each platform. Pick the platforms + when:"
                : "Text-only fan-out. Each platform posts your caption as-is. Pick the platforms + when:"}
            </p>

            {accountsQ.isLoading && (
              <p className="mb-4 text-xs text-zinc-500">Loading your connected accounts…</p>
            )}

            {!accountsQ.isLoading && PLATFORMS.length === 0 && (
              <p className="mb-4 text-xs text-zinc-500">
                No connected accounts found. Connect socials at zernio.com first.
              </p>
            )}

            <div className="mb-4 space-y-2">
              {PLATFORMS.map((p) => {
                const accs = byPlatform[p] ?? [];
                const isSelected = p in picks;
                return (
                  <div
                    key={p}
                    className={`rounded border px-3 py-2 ${
                      isSelected
                        ? "border-gold bg-gold/10"
                        : "border-bg-graphite bg-bg-ink"
                    }`}
                  >
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            // Auto-pick the first account; user can change.
                            setPicks((cur) => ({ ...cur, [p]: accs[0]?.id ?? "" }));
                          } else {
                            setPicks((cur) => {
                              const { [p]: _, ...rest } = cur;
                              return rest;
                            });
                          }
                        }}
                        className="accent-gold"
                      />
                      <span className={isSelected ? "text-gold" : "text-zinc-300"}>{p}</span>
                      {accs.length === 1 && (
                        <span className="ml-auto text-xs text-zinc-500">{accs[0]!.label}</span>
                      )}
                    </label>
                    {isSelected && accs.length > 1 && (
                      <select
                        value={picks[p]}
                        onChange={(e) => setPicks((cur) => ({ ...cur, [p]: e.target.value }))}
                        className="mt-2 w-full rounded border border-bg-graphite bg-black px-2 py-1 text-xs text-zinc-200 focus:border-gold focus:outline-none"
                      >
                        {accs.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mb-4">
              <div className="mb-2 text-xs uppercase tracking-widest text-zinc-500">When</div>
              <div className="flex flex-col gap-2 text-sm">
                <Radio
                  checked={mode === "scheduled"}
                  onChange={() => setMode("scheduled")}
                  label="Scheduled (~1 hour from now)"
                />
                <Radio
                  checked={mode === "publish_now"}
                  onChange={() => setMode("publish_now")}
                  label="Publish immediately"
                />
                <Radio
                  checked={mode === "is_draft"}
                  onChange={() => setMode("is_draft")}
                  label="Save as Zernio draft (no schedule)"
                />
              </div>
            </div>

            <div className="mb-4 rounded-card border border-bg-graphite bg-bg-ink p-3 text-xs text-zinc-400">
              <div className="mb-1 uppercase tracking-widest text-zinc-500">Caption preview</div>
              <p className="line-clamp-4 text-zinc-300">{stripMarkdown(caption)}</p>
            </div>

            {submit.error && (
              <div className="mb-3 rounded-card border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                {String(submit.error)}
              </div>
            )}
            {submit.data?.ok && (
              <div className="mb-3 rounded-card border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                ✓ {submit.data.message}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button
                size="sm"
                onClick={() => submit.mutate()}
                disabled={submit.isPending || selected.length === 0}
              >
                {submit.isPending
                  ? "Sending…"
                  : `Cross-post to ${selected.length} platform${selected.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Radio({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
      <input type="radio" checked={checked} onChange={onChange} className="accent-gold" />
      {label}
    </label>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
