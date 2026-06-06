import type { Env } from "../env";
import {
  getReelProject,
  updateReelProject,
  markDraftStatus,
  dueReels,
  type ReelProjectRow,
  type CaptionPayload,
} from "../db";
import { saveDraft, publishDraftById } from "./drafts";
import { tgSendMessage } from "../telegram/api";
import type { ZernioPlatform } from "./zernio";

// Reels publish through the SAME path as every other draft: we materialise a
// `drafts` row from the reel + its caption payload, then call publishDraftById
// (which owns the Zernio re-host + create_post + status bookkeeping). This
// reuses the battle-tested publish logic instead of duplicating Zernio calls.
//
// Scheduling is reel-centric: the draft is always "publish now" (no
// scheduled_for on it); the reel row's `scheduled_for` + the per-minute cron
// decide WHEN publishReel runs. Zernio's own scheduler is bypassed (it's
// unreliable on Meta/LinkedIn/TikTok — confirmed on the Railway system).

/** Connected publishing accounts, read from CONFIG.ZERNIO_ACCOUNTS
 *  ({ instagram: { accountId }, tiktok: {...}, ... }). Mirrors the avatar-reel
 *  workflow's resolver so all reels publish to the same surfaces. */
export async function zernioReelPlatforms(env: Env): Promise<ZernioPlatform[]> {
  const raw = await env.CONFIG.get("ZERNIO_ACCOUNTS");
  if (!raw) return [];
  try {
    const map = JSON.parse(raw) as Record<string, { accountId: string }>;
    const surfaces = ["instagram", "tiktok", "facebook", "youtube", "linkedin"] as const;
    return surfaces
      .filter((s) => map[s]?.accountId)
      .map((s) => ({
        platform: s as ZernioPlatform["platform"],
        accountId: map[s]!.accountId,
        media_type: "video" as const,
      }));
  } catch {
    return [];
  }
}

/** Compose the full post caption from the framework-aware payload:
 *  headline + body + cta + hashtags, each separated by a blank line. */
export function composeReelCaption(cap: CaptionPayload | null): string {
  if (!cap) return "";
  return [cap.headline, cap.body, cap.cta, cap.hashtags]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Materialise (or refresh) the linked draft for a ready reel and return its id.
 *  Called from the render workflow's persist step. On re-render we mint a fresh
 *  draft and repoint draft_id — the stale prior draft simply sits unused (never
 *  auto-published; publish only happens on explicit user/cron action). */
export async function ensureReelDraft(env: Env, project: ReelProjectRow): Promise<string | null> {
  if (!project.edited_url) return null;
  const platforms = await zernioReelPlatforms(env);
  const caption = composeReelCaption(project.caption_payload);
  const { draft_id } = await saveDraft(
    env,
    {
      format: "reel",
      caption,
      asset_urls: [project.edited_url],
      platforms,
      thumbnail_url: project.thumbnail_url ?? undefined,
      // No scheduled_for — the draft is always publish-now; the reel row + cron
      // own the timing.
    },
    "reel",
  );
  await updateReelProject(env, project.id, { draft_id });
  return draft_id;
}

export interface PublishReelResult {
  ok: boolean;
  zernio_post_id?: string;
  error?: string;
}

/** Publish a ready reel immediately via its linked draft. Used by the
 *  "Publish now" button and by the scheduling cron when a reel comes due. */
export async function publishReel(env: Env, projectId: string): Promise<PublishReelResult> {
  const project = await getReelProject(env, projectId);
  if (!project) return { ok: false, error: "reel project not found" };
  if (project.status === "cancelled") return { ok: false, error: "reel was cancelled" };
  if (project.status === "published") {
    return { ok: true, zernio_post_id: project.zernio_post_id ?? undefined };
  }

  // Lazily mint the draft if the render predates the draft bridge or it's missing.
  let draftId = project.draft_id;
  if (!draftId) {
    draftId = await ensureReelDraft(env, project);
    if (!draftId) return { ok: false, error: "reel has no edited video to publish" };
  } else {
    // A re-published draft must not short-circuit on a stale 'published' flag
    // from a prior attempt of THIS reel — but a fresh draft is 'pending', so
    // this is a no-op in the normal path.
    await markDraftStatus(env, draftId, "pending").catch(() => {});
  }

  await updateReelProject(env, projectId, { status: "publishing", error_message: null });

  const res = await publishDraftById(env, draftId);
  if (res.ok) {
    await updateReelProject(env, projectId, {
      status: "published",
      zernio_post_id: res.zernio_post_id ?? null,
    });
    return { ok: true, zernio_post_id: res.zernio_post_id };
  }
  await updateReelProject(env, projectId, {
    status: "failed",
    error_message: (res.error ?? "publish failed").slice(0, 500),
  });
  return { ok: false, error: res.error };
}

/** Publish every reel whose scheduled time has arrived. Called by the
 *  per-minute cron. publishReel flips status `scheduled -> publishing` before
 *  the slow Zernio call, so the next tick won't re-select an in-flight reel. */
export async function runDueReels(env: Env): Promise<{ fired: number }> {
  const due = await dueReels(env, Date.now(), 10);
  let fired = 0;
  for (const reel of due) {
    const chatId = reel.telegram_chat_id ? Number(reel.telegram_chat_id) : NaN;
    try {
      const res = await publishReel(env, reel.id);
      if (res.ok) {
        fired++;
        if (Number.isFinite(chatId)) {
          await tgSendMessage(
            env,
            chatId,
            `✅ Scheduled reel \`${reel.id.slice(0, 8)}\` published.\nZernio: \`${res.zernio_post_id ?? "—"}\``,
          ).catch(() => {});
        }
      } else if (Number.isFinite(chatId)) {
        await tgSendMessage(
          env,
          chatId,
          `❌ Scheduled reel \`${reel.id.slice(0, 8)}\` failed to publish: ${(res.error ?? "unknown").slice(0, 200)}`,
        ).catch(() => {});
      }
    } catch (e) {
      console.error(`[runDueReels] ${reel.id} failed:`, String(e));
    }
  }
  return { fired };
}
