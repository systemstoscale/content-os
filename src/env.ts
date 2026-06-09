import type { Processor } from "./container";
import type { BrowserWorker } from "@cloudflare/puppeteer";

export interface Env {
  // KV
  SECRETS: KVNamespace;
  CONFIG: KVNamespace;

  // R2
  ASSETS: R2Bucket;

  // D1
  DB: D1Database;

  // Browser Rendering — used by @cloudflare/puppeteer
  BROWSER: BrowserWorker;

  // Workers Assets — serves the Next.js static-export SPA at /
  // and falls through to index.html for client-side routes.
  ASSETS_STATIC: Fetcher;

  // Workers AI — used by Whisper for Telegram voice transcription
  AI: Ai;

  // Container (ffmpeg + faster-whisper for reel post-production).
  // Reachable only from this Worker via service binding.
  PROCESSOR: DurableObjectNamespace<Processor>;

  // Workflow that orchestrates the multi-minute avatar reel pipeline.
  // Workers Workflows give us durable step-by-step execution well past a
  // single Worker request's budget.
  AVATAR_REEL_WORKFLOW: Workflow;

  // Workflow that orchestrates one reel render (cut -> cinematic b-roll ->
  // captions -> render -> thumbnail in the container) then fires the Telegram
  // "Reel ready" card. See src/workflows/reel-render.ts.
  REEL_RENDER_WORKFLOW: Workflow;

  // Email Routing binding. Optional — Deploy-button installs don't ship with
  // a verified email-sending domain, so this binding is absent there and
  // sendPreviewEmail() short-circuits cleanly. Operator installs (running on
  // scalers.email) have it wired.
  EMAIL?: { send: (msg: unknown) => Promise<void> };

  // Legacy [vars] fields — operator-installed instances may still pass these
  // via wrangler.toml [vars]. Deploy-button installs leave them undefined and
  // the per-creator profile is read from CONFIG KV via src/profile.ts.
  CREATOR_NAME?: string;
  CREATOR_TIMEZONE?: string;
  ZERNIO_PROFILE_ID?: string;
  TELEGRAM_CHAT_ID?: string;
  APPROVAL_EMAIL?: string;

  // Secrets (wrangler secret put)
  ANTHROPIC_API_KEY: string;
  ZERNIO_API_KEY: string;
  CONTENT_OS_API_TOKEN?: string;
  /** License key issued at 10xcontent.io on purchase. Open-core gate: render +
   *  publish require a valid key (validated against the funnel — see lib/license.ts). */
  CONTENT_OS_LICENSE_KEY?: string;
  /** KIE.AI API key — the single credential behind ALL media generation
   *  (images via nano-banana-pro, talking-head reels via the avatar model).
   *  One Bearer key, no OAuth, no per-buyer model training — set once with
   *  `wrangler secret put KIE_AI_API_KEY`. Per-buyer model/look choices live
   *  in CONFIG KV (see src/lib/media-config.ts). */
  KIE_AI_API_KEY?: string;

  /** ElevenLabs API key for voice-cloned TTS used by the avatar reel
   *  pipeline. The creator's voice id is stored in CONFIG.ELEVENLABS_DEFAULT_VOICE_ID. */
  ELEVENLABS_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;

  /** Groq API key — Whisper transcription (word timestamps) for the cinematic
   *  reel render pipeline. Injected into the Processor container. */
  GROQ_API_KEY?: string;

  /** R2 S3-API credentials — the render container uploads finished reels +
   *  thumbnails straight to R2 (it has no Workers binding). Created once as an
   *  R2 API token; injected into the container via src/container.ts. */
  CLOUDFLARE_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** Bucket the container writes to (defaults to content-os-assets, the same
   *  bucket the ASSETS binding reads). */
  R2_BUCKET_NAME?: string;

  /** Optional per-install override of the caption/headline model. */
  REEL_CAPTION_MODEL?: string;
}
