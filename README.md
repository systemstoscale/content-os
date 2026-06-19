# Content OS

> Record a video, get a finished captioned reel, publish it everywhere, from Telegram. Runs entirely on your own Cloudflare account.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/systemstoscale/content-os)

**One click** clones this into your own GitHub, provisions your Cloudflare resources (KV / D1 / R2), prompts for your keys, and deploys Content OS to **your** account. You own and can customize the code. Full walkthrough in [SETUP.md](SETUP.md).

## What is this?

**Content OS turns one recording into published short-form content, automatically.** Drop a video into your Telegram bot (or paste an R2 link), tap a format, and the agent edits it — silence + filler cut, word-synced karaoke captions, cinematic motion-graphic b-roll, a magazine-cover thumbnail, and an auto-written caption — then sends back a preview card. Tap **Publish now / Add to queue / Schedule** to push it to Instagram, TikTok, YouTube Shorts, Facebook Reels, and LinkedIn via [Zernio](https://zernio.com).

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

## Install

**One-click + a guided wizard — no Cloudflare dashboard required.** Click **Deploy to Cloudflare** (button at top). Cloudflare clones the repo into your GitHub, provisions your D1 + KV + R2 + Worker + container, and deploys. Then open the Worker URL and the built-in **setup wizard** walks you through everything in your browser:

1. **Pick your password** (you choose it — nothing to lose).
2. **Paste your keys** (each field has a "Where do I get this?" link):
   - **Required:** `ANTHROPIC_API_KEY` (agent + captions), `GROQ_API_KEY` (transcription), `ZERNIO_API_KEY` + Zernio Profile ID (publishing), Cloudflare Account ID + R2 Access Key ID + R2 Secret (reel storage), and your **Content OS license key** (from your 10xcontent.io purchase).
   - **Optional:** `KIE_AI_API_KEY` (AI thumbnails/avatar reels), `ELEVENLABS_API_KEY` (voice-cloned TTS).
3. **Connect Telegram** — create a bot with @BotFather, paste the token, and the wizard auto-registers the webhook; send `/start` to link it.

The wizard stores everything in your own Cloudflare KV (Workers can't set their own secrets), so you never touch Settings → Variables. When it finishes you're signed in and live — drop a video in your Telegram bot, then run `/brand` to make it yours.

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
| Publishing | Zernio (zernio.com) across IG / TikTok / YouTube / Facebook / LinkedIn |
| Control | Telegram bot (ingest, format pick, preview card, `/brand`, `/reels`) + web dashboard |

## Access

This repo is **private** — access is granted by invite after purchase at [skalers.io](https://skalers.io).
