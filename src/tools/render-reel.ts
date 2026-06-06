import type { Env } from "../env";
import { processorFetch } from "../processor";
import { r2PublicUrl } from "../lib/r2-url";
import type { ReelFormat, CaptionPayload } from "../db";

export interface RenderReelInput {
  /** Public R2 URL of the source clip — the container downloads it (httpx). */
  video_url: string;
  /** Stable id used to namespace the output keys: reels/{project_id}/... */
  project_id: string;
  format: ReelFormat;
  /** B-roll format: the reel topic + post-body key points. */
  topic?: string;
  key_points?: string;
  /** Per-buyer brand profile (fonts/colors/caption-style/motion-style/thumbnail).
   *  null/undefined = Skalers default. */
  brand_profile?: unknown;
}

export interface RenderReelOutput {
  reel_key: string;
  reel_url: string;
  thumbnail_url?: string;
  transcript_url?: string;
  /** Clean cover frame (no overlay) — the AI-thumbnail path conditions on this. */
  cover_frame_url?: string;
  caption_payload?: CaptionPayload;
  duration_seconds?: number;
}

interface ContainerRenderResult {
  reel_key: string;
  thumbnail_key?: string;
  transcript_key?: string;
  cover_frame_key?: string;
  caption_payload?: CaptionPayload;
  duration_seconds?: number;
}

/** Drive the in-container cinematic pipeline (cut -> b-roll -> captions ->
 *  render -> thumbnail). The container uploads the 50-200 MB reel + thumbnail
 *  DIRECTLY to R2 (S3 API) and returns KEYS; we build the public URLs here from
 *  the Worker's configured base. See container/app/render_reel.py. */
export async function renderReel(env: Env, input: RenderReelInput): Promise<RenderReelOutput> {
  const res = await processorFetch(env, "/render-reel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`render-reel ${res.status}: ${text.slice(0, 500)}`);
  }
  const r = (await res.json()) as ContainerRenderResult;
  if (!r.reel_key) throw new Error("render-reel: container returned no reel_key");
  return {
    reel_key: r.reel_key,
    reel_url: await r2PublicUrl(env, r.reel_key),
    thumbnail_url: r.thumbnail_key ? await r2PublicUrl(env, r.thumbnail_key) : undefined,
    transcript_url: r.transcript_key ? await r2PublicUrl(env, r.transcript_key) : undefined,
    cover_frame_url: r.cover_frame_key ? await r2PublicUrl(env, r.cover_frame_key) : undefined,
    caption_payload: r.caption_payload,
    duration_seconds: r.duration_seconds,
  };
}

export interface PreviewInput {
  kind: "caption" | "card" | "thumbnail";
  brand_profile?: unknown;
}

export interface PreviewOutput {
  url: string;
  content_type: string;
}

/** Render a /brand wizard sample (caption clip / card / thumbnail) in the given
 *  brand profile and return its public URL. */
export async function renderPreview(env: Env, input: PreviewInput): Promise<PreviewOutput> {
  const res = await processorFetch(env, "/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`preview ${res.status}: ${text.slice(0, 300)}`);
  }
  const r = (await res.json()) as { key: string; content_type: string };
  return { url: await r2PublicUrl(env, r.key), content_type: r.content_type };
}
