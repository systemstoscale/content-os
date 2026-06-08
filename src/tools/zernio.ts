import type { Env } from "../env";

const ZERNIO_BASE = "https://getlate.dev/api/v1";

export interface ZernioPlatform {
  platform:
    | "instagram"
    | "tiktok"
    | "linkedin"
    | "twitter"
    | "facebook"
    | "youtube"
    | "telegram";
  accountId: string;
  media_urls?: string[];
  media_type?: "image" | "video";
  /** Per-platform caption override. Use when a platform has different length
   *  limits (Twitter <=280, Instagram <=2200, LinkedIn ~3000) and the
   *  top-level content needs to be tightened. */
  content?: string;
}

export interface ZernioPublishInput {
  content: string;
  platforms: ZernioPlatform[];
  scheduled_for?: string;
  thumbnail_url?: string;
}

export interface ZernioPublishOutput {
  ok: boolean;
  postId?: string;
  scheduled_for?: string;
  error?: string;
}

const PSD_THUMB_FIELD: Partial<Record<ZernioPlatform["platform"], string>> = {
  instagram: "instagramThumbnail",
  facebook: "video_cover_image_url",
};

export async function zernioPublish(
  env: Env,
  input: ZernioPublishInput
): Promise<ZernioPublishOutput> {
  // Deploy-button installs hold the profile id in CONFIG KV (set by /setup),
  // not in [vars]. Resolve env first, then CONFIG, before failing.
  const profileId = env.ZERNIO_PROFILE_ID || (await env.CONFIG.get("ZERNIO_PROFILE_ID")) || "";
  if (!profileId) {
    return { ok: false, error: "ZERNIO_PROFILE_ID not set (env vars or CONFIG)" };
  }

  const platformList: Array<Record<string, unknown>> = [];
  const allMediaUrls: string[] = [];

  for (const p of input.platforms) {
    const entry: Record<string, unknown> = {
      platform: p.platform.toLowerCase(),
      accountId: p.accountId,
    };

    if (p.content) entry["content"] = p.content;

    if (p.media_urls && p.media_urls.length > 0) {
      const mediaType = p.media_type ?? "video";
      entry["customMedia"] = p.media_urls.map((url) =>
        input.thumbnail_url
          ? { url, type: mediaType, thumbnail: input.thumbnail_url }
          : { url, type: mediaType }
      );
      for (const url of p.media_urls) {
        if (!allMediaUrls.includes(url)) allMediaUrls.push(url);
      }
    }

    const psdField = PSD_THUMB_FIELD[p.platform];
    if (input.thumbnail_url && psdField) {
      entry["platformSpecificData"] = { [psdField]: input.thumbnail_url };
    }

    platformList.push(entry);
  }

  const payload: Record<string, unknown> = {
    profileId,
    content: input.content,
    platforms: platformList,
    timezone: env.CREATOR_TIMEZONE || "UTC",
  };

  if (allMediaUrls.length > 0) {
    payload["mediaItems"] = allMediaUrls.map((url) =>
      input.thumbnail_url
        ? { url, thumbnail: input.thumbnail_url }
        : { url }
    );
  }

  if (input.scheduled_for) {
    payload["scheduledFor"] = input.scheduled_for;
  } else {
    // Without scheduledFor, Zernio creates the post in 'draft' state. Force
    // immediate publish per the Zernio docs (publishNow flag).
    payload["publishNow"] = true;
  }

  const res = await fetch(`${ZERNIO_BASE}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.ZERNIO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  // Zernio sometimes returns 207 Multi-Status when the post is created but
  // a sub-platform fails or is delayed; treat 200/201/207 as success.
  // 409 means this post already exists (a retry after a transient error) —
  // treat it as success too so a cron/network retry can never double-publish.
  if (!res.ok && res.status !== 207 && res.status !== 409) {
    return { ok: false, error: `zernio ${res.status}: ${text.slice(0, 500)}` };
  }

  try {
    const data = JSON.parse(text) as {
      _id?: string;
      id?: string;
      postId?: string;
      post?: { _id?: string; id?: string };
      scheduledFor?: string;
    };
    const postId =
      data._id ?? data.id ?? data.postId ?? data.post?._id ?? data.post?.id;
    return { ok: true, postId, scheduled_for: data.scheduledFor };
  } catch {
    return { ok: true };
  }
}
