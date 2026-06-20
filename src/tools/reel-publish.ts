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
import { tgSendMessage, resolveOwnerChatId } from "../telegram/api";
import type { ZernioPlatform } from "./zernio";
import { hasCredential } from "../lib/credentials";
import { callZernioMcpTool } from "../clients/zernio-mcp";

/** Minimal shape of the Zernio `analytics_get_analytics` response we need to
 *  derive connected accounts. The analytics API surfaces the full type, but its
 *  interface is private to that module, so we declare what we read locally. */
interface ZernioAccountsResponse {
  accounts?: Array<{ _id: string; platform: string; username?: string }>;
}

/** Fetch the buyer's connected social accounts from their own Zernio key and
 *  persist them to CONFIG.ZERNIO_ACCOUNTS as { platform: { accountId, username } }.
 *  Returns the map (or {} on failure/none). Never throws. */
export async function refreshZernioAccounts(
  env: Env,
): Promise<Record<string, { accountId: string; username?: string }>> {
  if (!(await hasCredential(env, "ZERNIO_API_KEY"))) return {};
  let result: ZernioAccountsResponse;
  try {
    result = await callZernioMcpTool<ZernioAccountsResponse>(env, "analytics_get_analytics", {
      limit: 1,
    });
  } catch {
    return {};
  }
  const map: Record<string, { accountId: string; username?: string }> = {};
  for (const a of result.accounts ?? []) {
    if (a.platform && a._id) {
      map[a.platform] = { accountId: a._id, username: a.username };
    }
  }
  if (Object.keys(map).length > 0) {
    await env.CONFIG.put("ZERNIO_ACCOUNTS", JSON.stringify(map));
  }
  return map;
}

// Reels publish through the SAME path as every other draft: we materialise a
// `drafts` row from the reel + its caption payload, then call publishDraftById
// (which owns the Zernio re-host + create_post + status bookkeeping). This
// reuses the battle-tested publish logic instead of duplicating Zernio calls.
//
// Scheduling is reel-centric: the draft is always "publish now" (no
// scheduled_for on it); the reel row's `scheduled_for` + the per-minute cron
// decide WHEN publishReel runs. Zernio's own scheduler is bypassed (it's
// unreliable on Meta/LinkedIn/TikTok — confirmed on the Railway system).

/** Project a ZERNIO_ACCOUNTS map onto the publishable reel surfaces. */
function platformsFromMap(map: Record<string, { accountId: string }>): ZernioPlatform[] {
  const surfaces = ["instagram", "tiktok", "facebook", "youtube", "linkedin"] as const;
  return surfaces
    .filter((s) => map[s]?.accountId)
    .map((s) => ({
      platform: s as ZernioPlatform["platform"],
      accountId: map[s]!.accountId,
      media_type: "video" as const,
    }));
}

/** Connected publishing accounts, read from CONFIG.ZERNIO_ACCOUNTS
 *  ({ instagram: { accountId }, tiktok: {...}, ... }). Mirrors the avatar-reel
 *  workflow's resolver so all reels publish to the same surfaces.
 *
 *  Self-healing: a fresh install never has ZERNIO_ACCOUNTS written, so when the
 *  map yields zero surfaces we pull the buyer's connected accounts from their
 *  own Zernio key ONCE and re-derive — the first publish after they connect
 *  socials at zernio.com populates with no manual step. */
export async function zernioReelPlatforms(env: Env): Promise<ZernioPlatform[]> {
  const raw = await env.CONFIG.get("ZERNIO_ACCOUNTS");
  let platforms: ZernioPlatform[] = [];
  if (raw) {
    try {
      platforms = platformsFromMap(JSON.parse(raw) as Record<string, { accountId: string }>);
    } catch {
      platforms = [];
    }
  }
  if (platforms.length > 0) return platforms;
  // Empty (never written, or no matching surfaces) — try a one-shot refresh.
  const refreshed = await refreshZernioAccounts(env);
  return platformsFromMap(refreshed);
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
const NO_ACCOUNTS_MSG =
  "No connected social accounts — connect them at zernio.com and they'll publish automatically.";

export async function publishReel(env: Env, projectId: string): Promise<PublishReelResult> {
  const project = await getReelProject(env, projectId);
  if (!project) return { ok: false, error: "reel project not found" };
  if (project.status === "cancelled") return { ok: false, error: "reel was cancelled" };
  if (project.status === "published") {
    return { ok: true, zernio_post_id: project.zernio_post_id ?? undefined };
  }

  // Never mark a reel published when it would target ZERO platforms — that's a
  // silent no-op. Fail loudly (and ping the owner if we can resolve them) so
  // the buyer knows to connect their socials at zernio.com.
  const platforms = await zernioReelPlatforms(env);
  if (platforms.length === 0) {
    await updateReelProject(env, projectId, {
      status: "failed",
      error_message: NO_ACCOUNTS_MSG,
    });
    const ownerChatId = await resolveOwnerChatId(env);
    if (ownerChatId != null) {
      await tgSendMessage(
        env,
        ownerChatId,
        `❌ Reel \`${projectId.slice(0, 8)}\` couldn't publish — ${NO_ACCOUNTS_MSG}`,
      ).catch(() => {});
    }
    return { ok: false, error: NO_ACCOUNTS_MSG };
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
