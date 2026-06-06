import type { Env } from "../env";
import {
  insertDraft,
  getDraft,
  markDraftPublished,
  markDraftStatus,
  logPillar,
  type DraftFormat,
  type DraftPayload,
  type YouTubeMetadata,
} from "../db";
import { zernioPublish, type ZernioPlatform } from "./zernio";
import { zernioYoutubePublish } from "./youtube";

export interface SaveDraftInput {
  format: DraftFormat;
  caption: string;
  pillar?: string;
  asset_urls: string[]; // required for media formats; pass [] for text_post
  platforms: ZernioPlatform[];
  thumbnail_url?: string;
  scheduled_for?: string;
}

export interface SaveDraftOutput {
  draft_id: string;
  status: "pending";
  preview_token: string;
}

export async function saveDraft(
  env: Env,
  input: SaveDraftInput,
  source: string
): Promise<SaveDraftOutput> {
  const draft_id = `dft_${crypto.randomUUID().slice(0, 8)}`;
  // A text_post is explicitly media-less — never inherit asset_urls into the
  // platform media, so it publishes as a clean text/thread post via Zernio.
  const isText = input.format === "text_post";
  const payload: DraftPayload = {
    asset_urls: input.asset_urls,
    platforms: input.platforms.map((p) => ({
      ...p,
      media_urls: isText ? [] : (p.media_urls ?? input.asset_urls),
    })),
    thumbnail_url: isText ? undefined : input.thumbnail_url,
    scheduled_for: input.scheduled_for,
  };

  await insertDraft(env, {
    id: draft_id,
    source,
    format: input.format,
    caption: input.caption,
    pillar: input.pillar ?? null,
    payload,
  });

  return { draft_id, status: "pending", preview_token: draft_id };
}

export interface SaveYouTubeDraftInput {
  zernio_account_id: string;
  titles: string[];
  description: string;
  chapters: Array<{ start_seconds: number; label: string }>;
  tags: string[];
  category?: string;
  visibility?: "public" | "unlisted" | "private";
  thumbnail_urls: string[];
  video_url: string;
  pillar?: string;
  scheduled_for?: string;
}

export async function saveYoutubeDraft(
  env: Env,
  input: SaveYouTubeDraftInput,
  source: string
): Promise<SaveDraftOutput> {
  if (!Array.isArray(input.titles) || input.titles.length < 1) {
    throw new Error("titles[] must have at least 1 entry (ideally 3 for A/B testing)");
  }
  if (!Array.isArray(input.thumbnail_urls) || input.thumbnail_urls.length < 1) {
    throw new Error("thumbnail_urls[] must have at least 1 entry");
  }

  const draft_id = `dft_${crypto.randomUUID().slice(0, 8)}`;
  const youtube: YouTubeMetadata = {
    zernio_account_id: input.zernio_account_id,
    titles: input.titles.slice(0, 3),
    description: input.description,
    chapters: input.chapters,
    tags: input.tags,
    category: input.category,
    visibility: input.visibility ?? "public",
    thumbnail_urls: input.thumbnail_urls.slice(0, 3),
    video_url: input.video_url,
  };

  const payload: DraftPayload = {
    asset_urls: [input.video_url, ...input.thumbnail_urls],
    platforms: [],
    thumbnail_url: input.thumbnail_urls[0],
    scheduled_for: input.scheduled_for,
    youtube,
  };

  await insertDraft(env, {
    id: draft_id,
    source,
    format: "youtube",
    caption: input.titles[0]!,
    pillar: input.pillar ?? null,
    payload,
  });

  return { draft_id, status: "pending", preview_token: draft_id };
}

export interface PublishDraftOutput {
  ok: boolean;
  draft_id: string;
  zernio_post_id?: string;
  error?: string;
  reminder?: string;
}

export async function publishDraftById(
  env: Env,
  draft_id: string
): Promise<PublishDraftOutput> {
  const draft = await getDraft(env, draft_id);
  if (!draft) return { ok: false, draft_id, error: "draft not found" };
  if (draft.status === "published") {
    return {
      ok: true,
      draft_id,
      zernio_post_id: draft.zernio_post_id ?? undefined,
    };
  }
  if (draft.status === "rejected") {
    return { ok: false, draft_id, error: "draft was rejected" };
  }

  if (draft.format === "meta_ads") {
    return {
      ok: false,
      draft_id,
      error: "meta_ads drafts are not publishable from here — set budget and unpause in Meta Ads Manager",
    };
  }

  if (draft.format === "youtube") {
    const yt = draft.payload.youtube;
    if (!yt) return { ok: false, draft_id, error: "youtube draft missing youtube_metadata" };

    const result = await zernioYoutubePublish(env, {
      zernio_account_id: yt.zernio_account_id,
      video_url: yt.video_url,
      title: yt.titles[0]!,
      description: yt.description,
      tags: yt.tags,
      category: yt.category,
      visibility: yt.visibility,
      thumbnail_url: yt.thumbnail_urls[0],
      scheduled_for: draft.payload.scheduled_for,
    });

    if (!result.ok) {
      await markDraftStatus(env, draft_id, "failed");
      return { ok: false, draft_id, error: result.error };
    }
    await markDraftPublished(env, draft_id, result.postId);
    if (draft.pillar) await logPillar(env, draft.pillar, draft_id);

    const otherTitles = yt.titles.slice(1).filter(Boolean);
    const otherThumbs = yt.thumbnail_urls.slice(1).filter(Boolean);
    const reminder =
      otherTitles.length || otherThumbs.length
        ? `In YouTube Studio, add ${otherTitles.length} additional title(s) and ${otherThumbs.length} additional thumbnail(s) for native A/B testing.`
        : undefined;

    return { ok: true, draft_id, zernio_post_id: result.postId, reminder };
  }

  // A text_post is just `content` (no media) — fail loudly rather than ship a
  // blank post if the caption is empty.
  if (draft.format === "text_post" && !draft.caption.trim()) {
    return { ok: false, draft_id, error: "text_post has empty caption" };
  }

  const result = await zernioPublish(env, {
    content: draft.caption,
    platforms: draft.payload.platforms,
    scheduled_for: draft.payload.scheduled_for,
    thumbnail_url: draft.payload.thumbnail_url,
  });

  if (!result.ok) {
    await markDraftStatus(env, draft_id, "failed");
    return { ok: false, draft_id, error: result.error };
  }

  await markDraftPublished(env, draft_id, result.postId);
  if (draft.pillar) await logPillar(env, draft.pillar, draft_id);

  return { ok: true, draft_id, zernio_post_id: result.postId };
}

export async function rejectDraft(env: Env, draft_id: string): Promise<void> {
  await markDraftStatus(env, draft_id, "rejected");
}

// ─── edit_draft — patch the caption on a not-yet-published draft ────────────
// Phone + web both lacked any edit path; this lifts both. Slide/image text
// changes still require re-running render_carousel/render_quote_post (the
// agent does that conversationally), but caption edits are the common case.

export interface EditDraftInput {
  draft_id: string;
  caption: string;
}

export interface EditDraftOutput {
  ok: boolean;
  draft_id?: string;
  error?: string;
}

export async function editDraft(env: Env, input: EditDraftInput): Promise<EditDraftOutput> {
  if (!input.draft_id) return { ok: false, error: "draft_id required" };
  if (typeof input.caption !== "string") return { ok: false, error: "caption required" };
  const draft = await getDraft(env, input.draft_id);
  if (!draft) return { ok: false, error: `draft ${input.draft_id} not found` };
  if (draft.status === "published") {
    return { ok: false, error: "already published — can't edit" };
  }
  await env.DB.prepare(`UPDATE drafts SET caption = ? WHERE id = ?`)
    .bind(input.caption, input.draft_id)
    .run();
  return { ok: true, draft_id: input.draft_id };
}
