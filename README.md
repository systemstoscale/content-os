# Content OS

> Record a video, get a finished captioned reel, publish it everywhere — from Telegram. Runs entirely on your own Cloudflare account.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/systemstoscale/content-os)

## What is this?

**Content OS turns one recording into published short-form content, automatically.** Drop a video into your Telegram bot (or paste an R2 link), tap a format, and the agent edits it — silence + filler cut, word-synced karaoke captions, cinematic motion-graphic b-roll, a magazine-cover thumbnail, and an auto-written caption — then sends back a preview card. Tap **Publish now / Add to queue / Schedule** to push it to Instagram, TikTok, YouTube Shorts, Facebook Reels, and LinkedIn via [Zernio](https://getlate.dev).

It's the same pipeline that edits reels inside 7-figure founder businesses, packaged so any creator can install it on their own Cloudflare account.

Built on the Anthropic Managed Agents API + a Cloudflare Worker + a render container (ffmpeg + Chromium + HyperFrames) + D1 + R2 + KV.

## The flow (Telegram-first)

1. **Drop a video** → the bot asks the format:
   - **Talking head → Captions + motion graphics** — full edit (cut, captions, cinematic b-roll, thumbnail).
   - **Talking head → Post raw** — no edits, just transcribe + auto-caption.
   - **B-roll** — answer a topic + key points → AI headline overlay + mood music.
2. **Reel ready card** arrives with a preview + thumbnail + caption.
3. **Publish now / Add to queue / Schedule / Re-render / Cancel** — one tap. Scheduling fires from a per-minute cron (Zernio's own scheduler is bypassed; it's unreliable on Meta/LinkedIn/TikTok).

Files over 20 MB: use the iPhone Shortcut to upload straight to R2 (`POST /r2/upload`), then paste the link.

## Make it yours — `/brand`

Fully self-serve brand customization from Telegram (no code):

- **Caption style** — `bold-karaoke`, `clean-minimal`, `highlight-pop`, `big-word` (font, size, position, animation, case).
- **Motion-graphics style** — `skalers-cinematic`, `minimal-editorial`, `bold-blocky`, `glass-neon`, or `off`.
- **Thumbnail** — `overlay` (frame + headline in your fonts/colors) or `ai` (Nano Banana Pro / GPT Image 2, face-accurate).
- **Colors / fonts / voice / CTA / hashtags** — `/brand accent #00e5ff`, `/brand display Montserrat`, `/brand cta ...`.

Every change writes `CONFIG.BRAND_PROFILE` and previews live in chat. Defaults reproduce the Skalers look.

## Also included

- **Voice-to-content** — send a voice note → transcript → idea/script.
- **Script writer** — topic → reel script + multi-platform captions (`write_script`).
- **YouTube long-form** — transcribe + chapters + 3 titles/thumbnails → publish.
- **Asset library** — drop a `logo:` / `meme:` / `sound:` attachment → indexed in R2 for the agent to pull into edits.
- **Web dashboard** — posting calendar, drafts, analytics, settings.

## Install (one click)

Click **Deploy to Cloudflare** above. Cloudflare forks this repo into your GitHub, provisions your D1 + KV + R2 + Worker + container, applies migrations, and builds the UI. Then add your keys (Worker → Settings → Variables, or `wrangler secret put`):

**Required**
- `ANTHROPIC_API_KEY` — Claude (the agent + captions + b-roll planning)
- `GROQ_API_KEY` — Whisper transcription (word timestamps)
- `ZERNIO_API_KEY` + `ZERNIO_PROFILE_ID` — multi-platform publishing
- `CLOUDFLARE_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` — the render container uploads finished reels to R2

**Optional**
- `TELEGRAM_BOT_TOKEN` — the Telegram control surface (pair with `/start`)
- `KIE_AI_API_KEY` — AI thumbnails + AI images + avatar reels
- `ELEVENLABS_API_KEY` — voice-cloned TTS for avatar reels

After deploy: open the Worker URL, finish `/setup`, set `CONFIG.ZERNIO_ACCOUNTS` (a JSON map of `platform → { accountId }`) once your accounts are connected, then run `/brand` in Telegram to make it yours.

> Operators installing for a client can instead run `./install.sh` from a checkout (provisions everything + deploys via the Wrangler CLI).

## Architecture

| Layer | Stack |
|---|---|
| Agent | Anthropic Managed Agents API (`managed-agents` beta) in a Cloudflare Worker |
| Render | Cloudflare Container (`standard-4`): ffmpeg + Node + Playwright Chromium + HyperFrames + the vendored `content/` pipeline |
| Orchestration | Cloudflare Workflows (`reel-render`) — durable, multi-minute, retrying |
| State | D1 (`reel_projects`, `drafts`, `assets`, …) |
| Storage | R2 (raw clips, finished reels, thumbnails, previews) |
| Config | KV (`CONFIG.BRAND_PROFILE`, creator profile, connected accounts) |
| Publishing | Zernio (getlate.dev) across IG / TikTok / YouTube / Facebook / LinkedIn |
| Control | Telegram bot (ingest, format pick, preview card, `/brand`, `/reels`) + web dashboard |

## Access

This repo is **private** — access is granted by invite after purchase at [skalers.io](https://skalers.io).
