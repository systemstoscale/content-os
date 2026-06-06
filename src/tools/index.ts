import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env";
import {
  renderCarousel,
  renderQuotePost,
  renderThumbnail,
  type RenderCarouselInput,
  type RenderQuoteInput,
  type RenderThumbnailInput,
} from "./render";
import {
  saveDraft,
  saveYoutubeDraft,
  publishDraftById,
  type SaveDraftInput,
  type SaveYouTubeDraftInput,
} from "./drafts";
import { sendPreviewEmail, type SendPreviewEmailInput } from "./email";
import {
  sendPreviewTelegram,
  notifyDraftReady,
  type SendPreviewTelegramInput,
  type NotifyDraftReadyInput,
} from "./telegram-preview";
import { processReel, type ProcessReelInput } from "./reel";
import { kieImage, kieCreatorImage, type KieImageInput, type KieCreatorImageInput } from "./kie";
import { generateAvatarReel, type AvatarReelInput } from "./avatar-reel-tool";
import { transcribeVideo, type TranscribeVideoInput } from "./youtube";
import { editDraft, type EditDraftInput } from "./drafts";
import {
  searchAssetsTool,
  listAssetsTool,
  type SearchAssetsInput,
  type ListAssetsInput,
} from "./assets";
import { generateScript, type GenerateScriptInput } from "./script";
import { saveIdea, type SaveIdeaInput } from "./ideas";

export const TOOL_SCHEMAS: Anthropic.Tool[] = [
  {
    name: "render_carousel",
    description:
      "Render N slides (1–10) to PNGs at 1080x1350 and store them in R2. Returns { assets: [{public_url}] }. Use templates: slide-title | slide-list | slide-cta.",
    input_schema: {
      type: "object",
      properties: {
        asset_prefix: { type: "string", description: "Short slug, no extension." },
        slides: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              template: {
                type: "string",
                enum: ["slide-title", "slide-list", "slide-cta"],
              },
              vars: {
                type: "object",
                additionalProperties: { type: "string" },
                description:
                  "Template variables. Required per-template:\n" +
                  "  slide-title: EYEBROW, HEADLINE, SUBHEAD, BRAND_HANDLE. Optional HEADSHOT_URL — when provided the slide switches to a 2-column layout with the creator's photo on the right. Only include HEADSHOT_URL if the brief explicitly asks for a photo OR a URL is supplied; otherwise omit.\n" +
                  "  slide-list: INDEX, HEADLINE, BODY, BRAND_HANDLE, PROGRESS. Optional EYEBROW (small uppercase label above the index), BULLET_1, BULLET_2, BULLET_3 (each one short line, ideally 6-14 words; you can wrap a 2-3-word lead in **double-asterisks** for gold emphasis), TAKEAWAY (one sharp sentence shown in a gold-accented box at the bottom). USE THESE OPTIONAL FIELDS — without bullets and a takeaway the slide looks empty. Aim for 2-3 bullets + a takeaway on every list slide.\n" +
                  "  slide-cta: EYEBROW, HEADLINE, CTA_LINE, CTA_BADGE, BRAND_HANDLE.",
              },
            },
            required: ["template", "vars"],
          },
        },
      },
      required: ["asset_prefix", "slides"],
    },
  },
  {
    name: "render_quote_post",
    description:
      "Render a single 1080x1080 quote post. Returns { public_url }. The 'attribution' value MUST be exactly the creator's handle (e.g. '@scalermax'). Do NOT include the full name. The render layer will strip any full name if you slip.",
    input_schema: {
      type: "object",
      properties: {
        quote: { type: "string" },
        attribution: {
          type: "string",
          description: "Always just the @handle, e.g. '@scalermax'. Never the full name.",
        },
        asset_prefix: { type: "string" },
      },
      required: ["quote", "attribution", "asset_prefix"],
    },
  },
  {
    name: "render_thumbnail",
    description:
      "Render a thumbnail/cover image with a one-word accent color highlight. Use orientation='yt' (default, 1280x720 16:9) for YouTube long-form. Use orientation='reel' (1080x1920 9:16) for IG Reels / TikTok / YT Shorts covers — required for reel and avatar reel flows so the cover matches the video aspect ratio.",
    input_schema: {
      type: "object",
      properties: {
        eyebrow: { type: "string" },
        headline_pre: { type: "string", description: "Headline text before the accent word." },
        headline_accent: { type: "string", description: "The 1–2 word phrase in gold." },
        headline_post: { type: "string", description: "Headline text after the accent." },
        brand_handle: { type: "string" },
        asset_prefix: { type: "string" },
        orientation: {
          type: "string",
          enum: ["yt", "reel"],
          description:
            "Cover format. 'yt' = 1280x720 16:9 (YouTube long-form). 'reel' = 1080x1920 9:16 (IG Reels / TikTok / Shorts cover). Default 'yt'.",
        },
        background_image_url: {
          type: "string",
          description:
            "Optional public URL of an image to use as the cover background (e.g. process_reel.cover_frame_url). Currently honored by orientation='reel' — a dark gradient overlay is drawn on top so the headline stays legible. For reel covers, ALWAYS pass cover_frame_url here when process_reel returned one.",
        },
      },
      required: ["eyebrow", "headline_pre", "headline_accent", "headline_post", "brand_handle", "asset_prefix"],
    },
  },
  {
    name: "process_reel",
    description:
      "Post-produce a raw talking-head video stored in R2: removes silences/fillers, transcribes with word-level timestamps, and burns opus-style captions. Returns { processed_r2_key, processed_public_url, transcript: {text, words[], segments[]}, duration_seconds }.",
    input_schema: {
      type: "object",
      properties: {
        r2_key: { type: "string", description: "R2 key of the raw upload (e.g. uploads/foo.mp4)." },
        caption_style: {
          type: "string",
          enum: ["opus", "minimal", "off"],
          description: "Default 'opus' = word-by-word highlight. 'off' = no captions burned.",
        },
      },
      required: ["r2_key"],
    },
  },
  {
    name: "kie_avatar_reel",
    description:
      "Generate a voice-cloned talking-head reel of the creator via KIE.AI, ALL POST-PRODUCTION INCLUDED. PIPELINE (all internal, you don't manage any of this): (1) portrait of the creator via KIE image, conditioned on their headshot (CONFIG.SOUL_REFERENCE_URL) + look (CONFIG.CREATOR_LOOK) — ~75-85% likeness, (2) ElevenLabs TTS of the script in the cloned voice, (3) KIE avatar model lipsyncs the portrait to the audio, (4) opus captions burned in, (5) cover frame extracted. Returns { video_url (READY-TO-PUBLISH mp4), cover_frame_url (use as background_image_url on render_thumbnail), portrait_url, audio_url, transcript_text, duration_seconds }. Total run 3-6 minutes — this is a synchronous blocking call. Required: script (the spoken text — write it the way the creator actually speaks), setting (visual scene description like 'studio with soft ring light'), asset_prefix. The creator's look, headshot, voice, and model are all read from CONFIG so each buyer customises them. After this returns, your remaining steps are: render_thumbnail with background_image_url=cover_frame_url, save_draft format='reel' with asset_urls=[video_url] + thumbnail_url, then send_preview_email + send_preview_telegram. STOP — avatar reels NEVER auto-publish.",
    input_schema: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description:
            "Talking-head script the avatar will speak verbatim. Write the way the creator actually speaks. ~120 words for 30s reel, ~240 words for 60s. No bracketed stage directions, no on-screen-text cues.",
        },
        setting: {
          type: "string",
          description:
            "Visual scene description: location, lighting, mood. Examples: 'studio with soft ring light, neutral grey backdrop', 'rooftop golden hour with city skyline behind', 'home office with natural window light'.",
        },
        aspect_ratio: { type: "string", enum: ["9:16", "1:1", "16:9"], description: "Default 9:16 (Reels/Shorts/TikTok)." },
        asset_prefix: { type: "string", description: "Short slug for R2 storage." },
        voice_id: { type: "string", description: "Optional override for CONFIG.ELEVENLABS_DEFAULT_VOICE_ID." },
      },
      required: ["script", "setting", "asset_prefix"],
    },
  },
  {
    name: "kie_image",
    description:
      "Generate an AI image via KIE.AI (nano-banana-pro). Use this for GENERIC scenes, metaphors, products, abstract backgrounds, quote-post hero images, and ad creatives that do NOT need the creator's face. Submits the job, blocks until ready (~15-60s), uploads to R2, returns { public_url, width, height }. For an image OF THE CREATOR, use kie_creator_image instead. Requires KIE_AI_API_KEY.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text description of the desired image. Specific is better — include subject, lighting, setting, mood, camera/lens hints.",
        },
        aspect_ratio: {
          type: "string",
          enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "auto"],
          description: "Pick by use case: 1:1 (IG grid/quote post), 4:5 (IG portrait/carousel hero), 9:16 (reel cover/story), 16:9 (YT thumbnail). Default 1:1.",
        },
        resolution: { type: "string", enum: ["1K", "2K", "4K"], description: "Default 2K." },
        asset_prefix: { type: "string", description: "Short slug for the R2 filename (no extension)." },
        image_reference: {
          type: "string",
          description: "Optional public URL of a reference image (logo, product shot, brand asset) to guide the generation.",
        },
      },
      required: ["prompt", "asset_prefix"],
    },
  },
  {
    name: "kie_creator_image",
    description:
      "Generate an image OF THE CREATOR via KIE.AI. Use this whenever the brief asks for the creator's face — 'image of me', 'photo of me on stage', creator-led ad creatives, personal/POV hero images. The tool automatically conditions on the creator's headshot (CONFIG.SOUL_REFERENCE_URL) and weaves in their look (CONFIG.CREATOR_LOOK) — ~75-85% likeness, reference-conditioned (not a trained face-lock). You do NOT pass a reference or describe their appearance; just describe the scene/pose/wardrobe. Uploads to R2, returns { public_url, width, height }. Requires KIE_AI_API_KEY + a configured SOUL_REFERENCE_URL for a recognizable result.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Describe the SCENE/pose/wardrobe/lighting only — NOT the creator's face or build (that comes from CONFIG). E.g. 'on stage at a conference, confident, holding a mic, dramatic spotlight'.",
        },
        aspect_ratio: {
          type: "string",
          enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "auto"],
          description: "Default 1:1. Use 9:16 for reel covers/stories, 4:5 for IG portrait.",
        },
        resolution: { type: "string", enum: ["1K", "2K", "4K"], description: "Default 2K." },
        asset_prefix: { type: "string", description: "Short slug for the R2 filename (no extension)." },
      },
      required: ["prompt", "asset_prefix"],
    },
  },
  {
    name: "transcribe_video",
    description:
      "Transcribe a long-form video already in R2 with full word-level timestamps. Use this for YouTube long-form briefs where you need chapter timing + SEO description but do NOT want silences cut. Returns { r2_key, transcript: {text, words[], segments[], duration_seconds} }.",
    input_schema: {
      type: "object",
      properties: {
        r2_key: { type: "string", description: "R2 key of the video (e.g. uploads/long-video.mp4)" },
      },
      required: ["r2_key"],
    },
  },
  {
    name: "save_youtube_draft",
    description:
      "Persist a YouTube long-form draft with 3 title variants, 3 thumbnail variants, chapter list, and SEO description. Returns { draft_id }. When the creator approves, the primary (title[0] + thumbnail[0]) is published via Zernio; the email reminder tells them to add the other 2 of each in YT Studio for A/B testing.",
    input_schema: {
      type: "object",
      properties: {
        zernio_account_id: { type: "string", description: "Zernio account ID for the creator's YouTube channel" },
        titles: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: { type: "string", maxLength: 100 },
          description: "1–3 title variants. titles[0] is published; the rest are for YT Studio A/B.",
        },
        description: {
          type: "string",
          description: "Full SEO description with embedded chapter timestamps as 00:00 / 01:23 / etc.",
        },
        chapters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              start_seconds: { type: "number" },
              label: { type: "string" },
            },
            required: ["start_seconds", "label"],
          },
          description: "Chapter list. First chapter must start at 0. Each chapter ~30–90s.",
        },
        tags: { type: "array", items: { type: "string" }, description: "10–15 SEO tags" },
        category: { type: "string", description: "YT category — default Education" },
        visibility: { type: "string", enum: ["public", "unlisted", "private"] },
        thumbnail_urls: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: { type: "string" },
          description: "1–3 thumbnail R2 public URLs from render_thumbnail",
        },
        video_url: { type: "string", description: "R2 public URL of the long-form MP4" },
        pillar: { type: "string" },
        scheduled_for: { type: "string" },
      },
      required: [
        "zernio_account_id",
        "titles",
        "description",
        "chapters",
        "tags",
        "thumbnail_urls",
        "video_url",
      ],
    },
  },
  {
    name: "save_draft",
    description:
      "Persist a draft post to D1 so it can be approved later. Returns { draft_id }. Always include the draft_id in your preview message.",
    input_schema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["carousel", "quote_post", "single_image", "thumbnail", "reel", "meta_ads"] },
        caption: { type: "string" },
        pillar: { type: "string", description: "Which content pillar this fits." },
        asset_urls: { type: "array", items: { type: "string" } },
        platforms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              platform: {
                type: "string",
                enum: ["instagram", "tiktok", "linkedin", "twitter", "facebook", "youtube", "telegram"],
              },
              accountId: { type: "string" },
              media_type: { type: "string", enum: ["image", "video"] },
              content: {
                type: "string",
                description:
                  "Optional per-platform caption override. Use this when a platform has a tighter character limit than the default caption. Twitter MUST be <=257 chars (280 minus 23 for URL). When omitted, the platform uses save_draft's main 'caption' field.",
              },
            },
            required: ["platform", "accountId"],
          },
        },
        thumbnail_url: { type: "string" },
        scheduled_for: { type: "string" },
      },
      required: ["format", "caption", "asset_urls", "platforms"],
    },
  },
  {
    name: "publish_draft_by_id",
    description:
      "Publish a previously-saved draft. ONLY call this when the brief came from cron and format is a static post. Otherwise let the creator approve via email/Telegram.",
    input_schema: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
      },
      required: ["draft_id"],
    },
  },
  {
    name: "send_preview_email",
    description:
      "Email the approval address with a draft preview. Always include the draft_id in the subject like '[dft_xxxx] ...' so the reply handler can find it.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string" },
        body_text: { type: "string" },
        asset_urls: { type: "array", items: { type: "string" } },
      },
      required: ["subject", "body_text"],
    },
  },
  {
    name: "send_preview_telegram",
    description:
      "Send a draft preview to the creator's Telegram. Use this in ADDITION to send_preview_email for any HTTP-triggered job (reel, avatar, youtube, meta-ad, upload) so the creator gets a fast in-pocket notification. Include the draft_id in the message body. Image assets in asset_urls get sent as an album; video_url (optional) is sent as a downloadable document. Skip this tool only when no Telegram bot is configured.",
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description:
            "Short message body shown in Telegram. Must include the draft_id. Keep it under ~600 chars — bullets, then the asset URL on its own line so Telegram auto-previews it.",
        },
        asset_urls: {
          type: "array",
          items: { type: "string" },
          description: "Optional image URLs. If 2+, they are sent as a media-group album below the text.",
        },
        video_url: {
          type: "string",
          description:
            "Optional processed-reel/long-form video URL. Sent as a document attachment so the creator can download to phone.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "notify_draft_ready",
    description:
      "Send a Telegram DM with inline [Approve] [Reject] [Publish now] buttons after save_draft. ALWAYS call this immediately after save_draft for content drafts (carousel, quote_post, single_image, reel, youtube) so the creator can approve in one tap without retyping the draft id. Skip this for meta_ads drafts (they're not publishable from Telegram — Meta Ads Manager owns that flow). If TELEGRAM_BOT_TOKEN isn't configured this is a silent no-op; do NOT fail the session over a missing bot.",
    input_schema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "The draft id returned by save_draft." },
        summary: {
          type: "string",
          description:
            "Optional one-sentence summary of what the draft is (e.g. \"Quote post: systems beat hiring — Russ Ruffino $100M\"). Shown under the headline above the buttons. Keep under 200 chars.",
        },
      },
      required: ["draft_id"],
    },
  },
  {
    name: "edit_draft",
    description:
      "Edit the caption/copy of a not-yet-published draft. For slide/image text changes, re-run the render tool instead. Returns the draft id.",
    input_schema: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        caption: { type: "string", description: "The new caption/post copy." },
      },
      required: ["draft_id", "caption"],
    },
  },
  {
    name: "write_script",
    description:
      "Turn a topic into a ready-to-shoot short-form reel script (a scroll-stopping HOOK, 2-4 BEATS, and a CTA) PLUS three platform-tailored captions (Instagram, LinkedIn, YouTube Shorts). Brand voice and the locked brand CTA are read from CONFIG, so the output is already on-voice. Returns { hook, beats[], cta, script, captions }. Use this when the creator asks for a script/reel copy from a topic, or before generating a talking-head / avatar reel that needs a script written first.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "What the reel is about — a sentence or two of the idea/angle." },
        format: {
          type: "string",
          description:
            "Optional delivery format hint that steers beat structure: 'talking_head' (default), 'screen_recording', or 'broll'.",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "search_assets",
    description:
      "Search the creator's asset library (memes, logos, sounds, screenshots, b-roll the creator dropped into Telegram with a prefix caption). Keyword match across name/description/tags/category. Returns { assets: [{ id, kind, name, public_url, ... }] }. Use this when a brief references a saved asset ('use my logo', 'the rooftop b-roll') so you can pull its public_url into a render/edit.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords to match against asset name/description/tags/category." },
        limit: { type: "number", description: "Max results (1-50, default 12)." },
      },
      required: ["query"],
    },
  },
  {
    name: "list_assets",
    description:
      "List the most-recent assets in the creator's library, optionally filtered by kind. Returns { assets: [...] }. Use when the creator asks what assets they have, or to scan a single kind (e.g. all 'logo' assets). For a targeted lookup, prefer search_assets.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          description: "Optional filter: meme | logo | sound | screenshot | thumbnail | broll | image | video | other.",
        },
        limit: { type: "number", description: "Max results (1-50, default 20)." },
      },
      required: [],
    },
  },
  {
    name: "save_idea",
    description:
      "Persist a content idea into the idea bank so it shows up in the dashboard idea list for later. Use this when the creator dictates or types an idea to capture ('save this as an idea', a voice note brainstorming a hook). Returns { idea_id }. This does NOT create or publish a post — it just files the idea.",
    input_schema: {
      type: "object",
      properties: {
        hook: { type: "string", description: "The scroll-stopping opener / the core of the idea (required)." },
        angle: { type: "string", description: "The take it argues / what makes it interesting." },
        pillar: { type: "string", description: "Which content pillar it fits." },
        format_hint: {
          type: "string",
          description: "Suggested format: carousel | quote_post | reel | text_post | youtube.",
        },
      },
      required: ["hook"],
    },
  },
];

export interface DispatchContext {
  env: Env;
  source: string;
}

export async function dispatchTool(
  ctx: DispatchContext,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const { env, source } = ctx;
  switch (name) {
    case "render_carousel":
      return renderCarousel(env, input as unknown as RenderCarouselInput);
    case "render_quote_post":
      return renderQuotePost(env, input as unknown as RenderQuoteInput);
    case "render_thumbnail":
      return renderThumbnail(env, input as unknown as RenderThumbnailInput);
    case "process_reel":
      return processReel(env, input as unknown as ProcessReelInput);
    case "kie_image":
      return kieImage(env, input as unknown as KieImageInput);
    case "kie_creator_image":
      return kieCreatorImage(env, input as unknown as KieCreatorImageInput);
    case "kie_avatar_reel":
      return generateAvatarReel(env, input as unknown as AvatarReelInput);
    case "transcribe_video":
      return transcribeVideo(env, input as unknown as TranscribeVideoInput);
    case "save_youtube_draft":
      return saveYoutubeDraft(env, input as unknown as SaveYouTubeDraftInput, source);
    case "save_draft":
      return saveDraft(env, input as unknown as SaveDraftInput, source);
    case "publish_draft_by_id":
      return publishDraftById(env, String(input["draft_id"]));
    case "send_preview_email":
      return sendPreviewEmail(env, input as unknown as SendPreviewEmailInput);
    case "send_preview_telegram":
      return sendPreviewTelegram(env, input as unknown as SendPreviewTelegramInput);
    case "notify_draft_ready":
      return notifyDraftReady(env, input as unknown as NotifyDraftReadyInput);
    case "edit_draft":
      return editDraft(env, input as unknown as EditDraftInput);
    case "write_script":
      return generateScript(env, input as unknown as GenerateScriptInput);
    case "search_assets":
      return searchAssetsTool(env, input as unknown as SearchAssetsInput);
    case "list_assets":
      return listAssetsTool(env, input as unknown as ListAssetsInput);
    case "save_idea":
      return saveIdea(env, input as unknown as SaveIdeaInput, source);
    default:
      return { error: `unknown tool: ${name}` };
  }
}
