import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { Env } from "../env";
import { renderReel } from "../tools/render-reel";
import { getReelProject, updateReelProject } from "../db";
import { ensureReelDraft } from "../tools/reel-publish";
import { sendReelReadyCard } from "../telegram/reel-ui";
import { tgSendMessage } from "../telegram/api";
import { thumbnailMode, loadBrandProfile } from "../lib/brand";
import { kieImage } from "../tools/kie";
import { hasCredential } from "../lib/credentials";

/** Input for the reel render workflow — everything else lives on the
 *  `reel_projects` row (source video, format, topic, key points, chat id). */
export interface ReelRenderParams {
  project_id: string;
}

/** Durable orchestration for one reel render. The container job runs 3-6 min
 *  (cut -> cinematic b-roll -> captions -> render -> thumbnail) — well past a
 *  single Worker request's budget — so the heavy step lives in a checkpointed
 *  Workflow step that can wait, retry, and survive Worker eviction. The final
 *  step fires the Telegram "Reel ready" card durably.
 *
 *  Brand styling is read from CONFIG.BRAND_PROFILE and passed to the container,
 *  so each buyer's reels render in their own look (nothing hardcoded here). */
export class ReelRenderWorkflow extends WorkflowEntrypoint<Env, ReelRenderParams> {
  async run(
    event: WorkflowEvent<ReelRenderParams>,
    step: WorkflowStep,
  ): Promise<{ project_id: string; status: string }> {
    const env = this.env;
    const pid = event.payload.project_id;

    const project = await getReelProject(env, pid);
    if (!project) throw new Error(`reel project not found: ${pid}`);
    // If the user hit Cancel before/while we started, do not resurrect it.
    if (project.status === "cancelled") {
      return { project_id: pid, status: "cancelled" };
    }
    if (!project.raw_video_url || project.raw_video_url === "pending") {
      throw new Error(`reel ${pid} has no source video`);
    }
    const format = project.format ?? "talking_head";

    try {
      await step.do("mark-editing", async () => {
        await updateReelProject(env, pid, { status: "editing", error_message: null });
      });

      // Per-buyer brand profile (Phase 6 schema). null = Skalers default preset.
      const brandRaw = await env.CONFIG.get("BRAND_PROFILE");
      let brandProfile: unknown = null;
      if (brandRaw) {
        try {
          brandProfile = JSON.parse(brandRaw);
        } catch {
          brandProfile = null;
        }
      }

      const out = await step.do(
        "render",
        { retries: { limit: 1, delay: "10 seconds", backoff: "constant" }, timeout: "25 minutes" },
        async () =>
          renderReel(env, {
            video_url: project.raw_video_url!,
            project_id: pid,
            format,
            topic: project.topic ?? undefined,
            key_points: project.key_points ?? undefined,
            brand_profile: brandProfile,
          }),
      );

      await step.do("persist", async () => {
        await updateReelProject(env, pid, {
          status: "ready",
          edited_url: out.reel_url,
          thumbnail_url: out.thumbnail_url ?? null,
          transcript_url: out.transcript_url ?? null,
          caption_payload: out.caption_payload ?? null,
          error_message: null,
        });
      });

      // AI thumbnail (opt-in via /brand → thumbnail mode "ai"): generate a
      // face-accurate, stylish cover from the clean cover frame via KIE, and
      // replace the overlay thumbnail BEFORE the draft is minted. Falls back to
      // the container's overlay thumbnail on any failure.
      await step.do("ai-thumbnail", async () => {
        if ((await thumbnailMode(env)) !== "ai" || !out.cover_frame_url) return;
        const fresh = await getReelProject(env, pid);
        const headline = fresh?.caption_payload?.headline ?? "";
        const bp = await loadBrandProfile(env);
        const prompt = [
          "Vertical 9:16 social reel thumbnail, face-accurate to the reference person.",
          headline ? `Bold headline text: "${headline}".` : "",
          "High-contrast, scroll-stopping, professional.",
          bp.thumbnail_style?.ai_style_prompt ?? "",
        ]
          .filter(Boolean)
          .join(" ");
        try {
          const img = await kieImage(env, {
            prompt,
            image_reference: out.cover_frame_url,
            aspect_ratio: "9:16",
            resolution: "2K",
            asset_prefix: `reels/${pid}/thumb-ai`,
            model: bp.thumbnail_style?.ai_model,
          });
          await updateReelProject(env, pid, { thumbnail_url: img.public_url });
        } catch (e) {
          console.error(`[reel-render ${pid}] ai-thumbnail failed, keeping overlay:`, String(e));
          // Most common cause on a fresh install: no KIE key. Tell the buyer
          // (only in that case) so the silent overlay fallback doesn't look broken.
          if (project.telegram_chat_id && !(await hasCredential(env, "KIE_AI_API_KEY"))) {
            const chatId = Number(project.telegram_chat_id);
            if (Number.isFinite(chatId)) {
              await tgSendMessage(
                env,
                chatId,
                "ℹ️ Used the overlay thumbnail — AI covers need your KIE.AI key. Add it with `/key kie <value>`.",
              ).catch(() => {});
            }
          }
        }
      });

      // Materialise the linked draft (caption + platforms + thumbnail) so the
      // Publish / Schedule / Queue actions all go through the proven draft path.
      await step.do("make-draft", async () => {
        const ready = await getReelProject(env, pid);
        if (ready && ready.status === "ready") {
          await ensureReelDraft(env, ready);
        }
      });

      await step.do("preview-telegram", async () => {
        // Re-read so the card reflects the persisted edited_url + caption, and
        // re-check cancellation (user may have cancelled during render).
        const fresh = await getReelProject(env, pid);
        if (fresh && fresh.status !== "cancelled") {
          await sendReelReadyCard(env, fresh);
        }
      });

      return { project_id: pid, status: "ready" };
    } catch (e) {
      const errMsg = String(e).slice(0, 400);
      console.error(`[reel-render ${pid}] failed:`, errMsg);
      await step.do("mark-failed", async () => {
        await updateReelProject(env, pid, { status: "failed", error_message: errMsg });
        if (project.telegram_chat_id) {
          const chatId = Number(project.telegram_chat_id);
          if (Number.isFinite(chatId)) {
            await tgSendMessage(
              env,
              chatId,
              `❌ Reel \`${pid.slice(0, 8)}\` failed: ${errMsg}`,
            ).catch(() => {});
          }
        }
      });
      throw e;
    }
  }
}
