import type { Env } from "../env";
import type { ReelTranscript } from "./reel";
import { processorFetch } from "../processor";

const ZERNIO_BASE = "https://getlate.dev/api/v1";

export interface TranscribeVideoInput {
  r2_key: string;
}

export interface TranscribeVideoOutput {
  r2_key: string;
  transcript: ReelTranscript;
}

export async function transcribeVideo(
  env: Env,
  input: TranscribeVideoInput
): Promise<TranscribeVideoOutput> {
  const obj = await env.ASSETS.get(input.r2_key);
  if (!obj) throw new Error(`r2 object not found: ${input.r2_key}`);

  const filename = input.r2_key.split("/").pop() ?? "input.mp4";
  const contentType = obj.httpMetadata?.contentType ?? "video/mp4";

  const form = new FormData();
  form.append("video", new Blob([await obj.arrayBuffer()], { type: contentType }), filename);

  const res = await processorFetch(env, "/transcribe", { method: "POST", body: form });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`transcribe ${res.status}: ${text.slice(0, 500)}`);
  }

  const transcript = (await res.json()) as ReelTranscript;
  return { r2_key: input.r2_key, transcript };
}

export interface YouTubeUploadInput {
  zernio_account_id: string;
  video_url: string;
  title: string;
  description: string;
  tags: string[];
  category?: string;
  visibility?: "public" | "unlisted" | "private";
  thumbnail_url?: string;
  scheduled_for?: string;
}

export interface YouTubeUploadOutput {
  ok: boolean;
  postId?: string;
  error?: string;
}

export async function zernioYoutubePublish(
  env: Env,
  input: YouTubeUploadInput
): Promise<YouTubeUploadOutput> {
  if (!env.ZERNIO_PROFILE_ID) {
    return { ok: false, error: "ZERNIO_PROFILE_ID not set" };
  }

  const platformSpecificData: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    tags: input.tags,
    visibility: input.visibility ?? "public",
    category: input.category ?? "Education",
    embeddable: true,
    publicStatsViewable: true,
  };

  const customMedia: Array<Record<string, unknown>> = [
    input.thumbnail_url
      ? { url: input.video_url, type: "video", thumbnail: input.thumbnail_url }
      : { url: input.video_url, type: "video" },
  ];

  const mediaItems: Array<Record<string, unknown>> = [
    input.thumbnail_url
      ? { url: input.video_url, thumbnail: input.thumbnail_url }
      : { url: input.video_url },
  ];

  const payload: Record<string, unknown> = {
    profileId: env.ZERNIO_PROFILE_ID,
    content: input.description,
    platforms: [
      {
        platform: "youtube",
        accountId: input.zernio_account_id,
        customMedia,
        platformSpecificData,
      },
    ],
    mediaItems,
    timezone: env.CREATOR_TIMEZONE || "UTC",
  };

  if (input.scheduled_for) payload["scheduledFor"] = input.scheduled_for;

  const res = await fetch(`${ZERNIO_BASE}/posts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.ZERNIO_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: `zernio ${res.status}: ${text.slice(0, 500)}` };
  }
  try {
    const data = JSON.parse(text) as { _id?: string; id?: string };
    return { ok: true, postId: data._id ?? data.id };
  } catch {
    return { ok: true };
  }
}
