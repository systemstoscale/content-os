import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env";
import { kieImage } from "../tools/kie";
import { submitKieLipsync, probeKieLipsync, downloadKieLipsync } from "../tools/kie-avatar";
import { getMediaConfig, withCreatorLook } from "../lib/media-config";
import { elevenlabsTts } from "../tools/elevenlabs";
import { processReel } from "../tools/reel";
import { renderThumbnail } from "../tools/render";
import { saveDraft } from "../tools/drafts";
import { sendPreviewTelegram } from "../tools/telegram-preview";
import type { ZernioPlatform } from "../tools/zernio";

/** Input for the Avatar Reel Workflow. Mirrors /trigger/avatar's body. */
export interface AvatarReelParams {
  topic: string;
  title?: string;
  bullets?: string[];
  cta?: string;
  setting?: string;
  aspect_ratio?: "9:16" | "1:1" | "16:9";
  asset_prefix?: string;
}

const SCRIPT_MODEL = "claude-haiku-4-5-20251001";

/** Durable multi-step avatar reel pipeline. Each step is checkpointed by the
 *  workflow runtime, so a step failure can be retried in isolation, and the
 *  long KIE lipsync poll can sleep without burning a single Worker request's
 *  budget. Total wall-clock budget on Workflows is hours, not minutes.
 *
 *  Everything creator-specific (look, headshot, voice, models) is read from
 *  CONFIG via getMediaConfig — nothing is hardcoded, so each buyer's install
 *  produces their own face/voice. */
export class AvatarReelWorkflow extends WorkflowEntrypoint<Env, AvatarReelParams> {
  async run(event: WorkflowEvent<AvatarReelParams>, step: WorkflowStep): Promise<{
    draft_id: string;
    video_url: string;
    cover_url: string;
  }> {
    const params = event.payload;
    const env = this.env;
    const aspect = params.aspect_ratio ?? "9:16";
    const setting = params.setting ?? "indoor studio with soft natural light, neutral backdrop";
    const slug = (params.asset_prefix ?? params.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30))
      .replace(/^-+|-+$/g, "");
    const assetPrefix = `avatar-${slug}-${Date.now()}`;

    // Per-buyer media config (look, headshot, voice, model slugs). Plain CONFIG
    // reads — idempotent, safe to resolve outside a checkpointed step.
    const media = await getMediaConfig(env);

    try {
      // 1. Script via Haiku (no tools, one short call).
      const script = await step.do("write-script", async () => writeScript(env, params, setting));

      // 2. Portrait via KIE, conditioned on the creator's headshot + look.
      //    kieImage submits, polls, and re-hosts to R2 in one self-contained
      //    call (sub-minute), so one durable step covers the whole portrait.
      const portrait = await step.do(
        "portrait",
        { retries: { limit: 2, delay: "5 seconds", backoff: "linear" } },
        async () =>
          kieImage(env, {
            prompt: withCreatorLook(
              media.creatorLook,
              `looking confidently at camera, neutral expression, ${setting}, broadcast-quality lighting, photorealistic, sharp focus`,
            ),
            aspect_ratio: aspect,
            resolution: "2K",
            asset_prefix: `${assetPrefix}-portrait`,
            image_reference: media.soulReferenceUrl ?? undefined,
            model: media.imageModel,
          })
      );

      // 3. ElevenLabs TTS. Keep the WAV transcode for now (MP3-direct to the
      //    KIE avatar model is a tested follow-up that drops the container hop).
      const tts = await step.do("tts", async () =>
        elevenlabsTts(env, {
          text: script,
          asset_prefix: `${assetPrefix}-voice`,
          output_format: "mp3_44100_128",
          transcode_to_wav: true,
        })
      );

      // 4. Submit KIE lipsync. Returns the taskId fast.
      const speakTaskId = await step.do("speak-submit", async () =>
        submitKieLipsync(env, {
          portrait_url: portrait.public_url,
          audio_url: tts.public_url,
          prompt: withCreatorLook(
            media.creatorLook,
            `talking-head shot. ${setting}. natural head and lip motion synchronized to the audio. broadcast-quality.`,
          ),
          resolution: media.avatarResolution,
          asset_prefix: `${assetPrefix}-reel`,
          model: media.avatarModel,
        })
      );

      // 5. Poll lipsync. Renders take 2-5 minutes — well past one Worker
      //    request's budget. The workflow runtime sleeps durably between
      //    probes; the whole loop can span hours if needed.
      const speakCdnUrl = await step.do(
        "speak-poll",
        { retries: { limit: 2, delay: "30 seconds", backoff: "linear" }, timeout: "15 minutes" },
        async () => {
          for (let i = 0; i < 60; i++) {
            const p = await probeKieLipsync(env, speakTaskId);
            if (p.status === "completed" && p.url) return p.url;
            if (p.status === "failed") {
              throw new Error(`lipsync failed: ${p.error ?? "no message"}`);
            }
            await new Promise((r) => setTimeout(r, 15_000));
          }
          throw new Error(`lipsync timed out (60 polls × 15s)`);
        }
      );

      // 6. Download lipsync mp4 to R2.
      const speak = await step.do("speak-download", async () =>
        downloadKieLipsync(env, speakCdnUrl, speakTaskId, `${assetPrefix}-reel`)
      );

      // 9. Post-production: opus captions + cover frame.
      const processed = await step.do("process-reel", async () =>
        processReel(env, { r2_key: speak.r2_key, caption_style: "opus" })
      );

      // 10. Cover thumbnail.
      const hookText = params.title ?? params.topic;
      const cover = await step.do("render-cover", async () => {
        const headline = splitHookForAccent(hookText);
        return renderThumbnail(env, {
          eyebrow: shortEyebrow(params),
          headline_pre: headline.pre,
          headline_accent: headline.accent,
          headline_post: headline.post,
          brand_handle: "@scalermax",
          asset_prefix: `${assetPrefix}-cover`,
          orientation: "reel",
          background_image_url: processed.cover_frame_url || portrait.public_url,
        });
      });

      // 11. Save draft.
      const draft = await step.do("save-draft", async () => {
        const caption = `${script}\n\n${params.cta ?? ""}`.trim();
        const platforms = await zernioPlatformsForReel(env);
        return saveDraft(
          env,
          {
            format: "reel",
            caption,
            pillar: pickPillar(params.topic),
            asset_urls: [processed.processed_public_url],
            platforms,
            thumbnail_url: cover.public_url,
          },
          "workflow"
        );
      });

      // 12. Telegram preview.
      await step.do("preview-telegram", async () => {
        const platforms = await zernioPlatformsForReel(env);
        const message = [
          `🎬 AVATAR REEL READY — ${draft.draft_id}`,
          ``,
          `Hook: "${hookText}"`,
          `Duration: ~${Math.round(processed.duration_seconds || tts.duration_seconds_estimate)}s | Captions: opus`,
          `Platforms: ${platforms.map((p) => p.platform).join(" · ")}`,
          ``,
          `Video:`,
          processed.processed_public_url,
          ``,
          `Cover:`,
          cover.public_url,
          ``,
          `Reply "ship ${draft.draft_id}" to publish.`,
        ].join("\n");
        return sendPreviewTelegram(env, {
          message,
          asset_urls: [cover.public_url],
          video_url: processed.processed_public_url,
        });
      });

      return {
        draft_id: draft.draft_id,
        video_url: processed.processed_public_url,
        cover_url: cover.public_url,
      };
    } catch (e) {
      const errMsg = String(e).slice(0, 400);
      console.error(`[avatar-workflow ${assetPrefix}] failed:`, errMsg);
      // Surface the failure to Telegram in a dedicated step so the user
      // always learns about a dead workflow.
      await step.do("error-telegram", async () =>
        sendPreviewTelegram(env, {
          message:
            `❌ Avatar reel workflow failed.\n\n` +
            `Topic: ${params.topic}\n\n` +
            `Error: ${errMsg}\n\n` +
            `Reply if you want me to retry.`,
        }).catch(() => ({ ok: false }))
      );
      throw e;
    }
  }
}

// ---- helpers ----

async function writeScript(
  env: Env,
  body: { topic: string; title?: string; bullets?: string[]; cta?: string },
  setting: string
): Promise<string> {
  const voice = await env.CONFIG.get("voice-fingerprint.md");
  const business = await env.CONFIG.get("business-brief.md");
  const hooks = await env.CONFIG.get("hook-bank.md");
  const system = [
    `You are the script writer for ${env.CREATOR_NAME}'s avatar reels.`,
    `Write a TIGHT 30-45 second talking-head script (~120 words) the avatar will speak verbatim through an ElevenLabs voice clone.`,
    `Rules: read-aloud-naturally, no bracketed stage directions, no on-screen-text cues, no asterisks, no em dashes, no ellipses.`,
    `Lead with the hook. Walk through the bullets. End with the CTA on a short line.`,
    `Voice: confident, direct, no-hype.`,
    `Output ONLY the spoken script — no preamble, no commentary.`,
    ``,
    `# Voice fingerprint\n${voice ?? "(not configured)"}`,
    `# Business brief\n${business ?? "(not configured)"}`,
    `# Hook bank\n${hooks ?? "(not configured)"}`,
  ].join("\n");
  const user = [
    `Topic: ${body.topic}`,
    body.title ? `Hook: ${body.title}` : null,
    body.bullets?.length ? `Bullets:\n${body.bullets.map((b, i) => `  ${i + 1}. ${b}`).join("\n")}` : null,
    body.cta ? `CTA: ${body.cta}` : null,
    `Visual setting (don't describe in the script): ${setting}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-beta": "managed-agents-2026-04-01" },
  });
  const msg = await client.messages
    .stream({
      model: SCRIPT_MODEL,
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: user }],
    })
    .finalMessage();
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
  if (!text) throw new Error("LLM returned empty script");
  return text;
}

function splitHookForAccent(hook: string): { pre: string; accent: string; post: string } {
  const words = hook.split(/\s+/);
  if (words.length <= 2) return { pre: "", accent: hook.toUpperCase(), post: "" };
  const accent = words[words.length - 1]!.toUpperCase();
  const pre = words.slice(0, -1).join(" ").toUpperCase();
  return { pre, accent, post: "" };
}

function shortEyebrow(body: { topic: string; title?: string }): string {
  if (body.topic && body.topic.length <= 18) return body.topic.toUpperCase();
  return "REEL";
}

function pickPillar(topic: string): string | undefined {
  const t = topic.toLowerCase();
  if (/\b(hire|hiring|team)\b/.test(t)) return "Implementation";
  if (/\b(lead|prospect|outbound)\b/.test(t)) return "Leads";
  if (/\b(content|reel|video|post)\b/.test(t)) return "Attention";
  if (/\b(close|sale|funnel)\b/.test(t)) return "Conversion";
  return undefined;
}

async function zernioPlatformsForReel(env: Env): Promise<ZernioPlatform[]> {
  const raw = await env.CONFIG.get("ZERNIO_ACCOUNTS");
  if (!raw) return [];
  try {
    const map = JSON.parse(raw) as Record<string, { accountId: string }>;
    const surfaces = ["instagram", "tiktok", "facebook", "youtube", "linkedin"] as const;
    return surfaces
      .filter((s) => map[s])
      .map((s) => ({ platform: s as ZernioPlatform["platform"], accountId: map[s]!.accountId, media_type: "video" as const }));
  } catch {
    return [];
  }
}
