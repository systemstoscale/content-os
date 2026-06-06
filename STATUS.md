# Acquisition OS — Status & Handoff

Single-file context document. Drop this path into any new conversation:

> "Read `skalers/acquisition-os/STATUS.md` and continue from there."

## One-line summary

A creator-installable content agent that runs entirely on Cloudflare. Produces carousels, quote posts, talking-head reels, AI avatar reels, YouTube long-form, and Meta Ads drafts from briefs (email / Telegram / HTTP / cron). All sensitive content gets a human-in-loop approval gate; static cron posts auto-publish; Meta Ads can never auto-publish.

## What's built (status as of 2026-05-25)

| Phase | Capability | State |
|---|---|---|
| 0 | Single-template static posts | ✅ in code, typecheck pass |
| 1 | Multi-slide carousels, draft→approve→publish via D1, 7-day pillar rotation, YT thumbnails | ✅ in code, typecheck pass |
| 2 | Talking-head reel pipeline (raw upload → silence-cut → opus caption-burn → multi-platform draft) | ✅ in code, typecheck pass |
| 3 | Higgsfield Soul avatar reels (script → trained-face video → caption-burn → draft) | ✅ in code, typecheck pass — **Higgsfield API contract is INFERRED, never verified** |
| 4 | YouTube long-form (transcribe → chapters → SEO description → 3 title variants → 3 thumbnail variants) | ✅ in code, typecheck pass |
| 4.5 | Drop Railway, embed processor as a Cloudflare Container, service-binding instead of HTTPS+Bearer | ✅ in code, typecheck pass |
| 5 | Meta Ads draft creation (PAUSED + $0 budget — creator unpauses in Ads Manager) | ✅ in code, typecheck pass |
| 5.5 | Video ads + mixed image/video ad sets + `meta-ad-from-draft` remix of existing draft into ads | ✅ in code, typecheck pass |
| 6 | Production rollout: lesson page, beta cohort, docs | **NOT STARTED** |

**Important honest disclaimer**: the entire system typechecks cleanly but **has never been deployed against real Cloudflare or real third-party APIs**. First deploy will surface contract mismatches in 5+ places (see "Known guesses" section below).

## Architecture

Everything runs on Cloudflare. One platform, one `wrangler deploy`, one bill per creator.

```
┌─ Cloudflare (creator's own account) ─────────────────────────┐
│  Worker (acquisition-os)                                     │
│   - /trigger/{manual,telegram,upload,reel,avatar,            │
│               youtube,youtube-upload,meta-ad,                │
│               meta-ad-from-draft}                            │
│   - scheduled() handler (cron, default 09:00 Paris)          │
│   - email() handler (inbound)                                │
│   - /r2/* (proxy read for previews)                          │
│  KV:        SECRETS + CONFIG                                 │
│  R2:        ASSETS bucket                                    │
│  D1:        drafts + pillar_log + sessions                   │
│  Browser:   HTML → PNG renders (slides, quotes, thumbnails)  │
│  Email:     inbound on agent@<creator-domain>                │
│                                                              │
│  Container (Durable Object-bound, service-binding only) ───┐ │
│   - FastAPI + ffmpeg + faster-whisper + httpx              │ │
│   - No public route. Worker calls via env.PROCESSOR        │ │
│   - Scales to zero between requests                        │ │
│   - Endpoints: /process-reel /transcribe                   │ │
│                /generate-avatar-reel /health               │ │
└────────────────────────────────────────────────────────────┴─┘
                       │ Anthropic API (Messages, tool-use loop)
                       ▼
                Claude Opus 4.7 — the brain
                (managed-agents-2026-04-01 beta header)
```

External dependencies (all third-party, all required by the creator's own keys):
- **Anthropic** — Claude (the brain, mandatory)
- **Zernio** (getlate.dev) — multi-platform publishing (org, optional alternative is direct platform APIs)
- **Higgsfield** — only for AI avatar reels (Phase 3)
- **Meta Graph API** — only for Meta Ads (Phase 5)

## File layout

```
skalers/acquisition-os/
├── STATUS.md                    ← this file
├── README.md                    ← user-facing setup guide
├── package.json                 ← deps: @anthropic-ai/sdk, @cloudflare/containers, zod
├── wrangler.toml                ← Worker + KV + R2 + D1 + Browser + Email + Cron + Container
├── tsconfig.json
├── migrations/
│   └── 0001_init.sql            ← drafts, pillar_log, sessions tables
├── creator-config-template/     ← creator fills these and uploads to CONFIG KV
│   ├── voice-fingerprint.md
│   ├── business-brief.md
│   ├── hook-bank.md
│   ├── content-pillars.md
│   └── soul-id.md               ← (Phase 3 — avatar reels only)
├── templates/                   ← HTML rendered → PNG via Browser Rendering
│   ├── slide-title.html         ← 1080×1350 opener slide
│   ├── slide-list.html          ← 1080×1350 numbered body slide
│   ├── slide-cta.html           ← 1080×1350 gold-inverted closer
│   ├── quote-post.html          ← 1080×1080
│   └── yt-thumbnail.html        ← 1280×720 with one-word accent
├── src/
│   ├── index.ts                 ← Worker entry, route dispatch, exports Container class
│   ├── env.ts                   ← Env type (KV, R2, D1, BROWSER, PROCESSOR, secrets)
│   ├── container.ts             ← Container class extends @cloudflare/containers
│   ├── processor.ts             ← processorFetch(env, path, init) helper
│   ├── agent.ts                 ← Anthropic tool-use loop, session logging to D1
│   ├── db.ts                    ← typed D1 helpers
│   ├── templates.ts             ← template registry + fillTemplate(key, vars)
│   ├── html-shim.d.ts           ← `*.html` declared as text imports for Wrangler
│   ├── prompts/
│   │   └── system.ts            ← buildSystemPrompt(env) — brand rules + 5 flows
│   ├── tools/
│   │   ├── index.ts             ← TOOL_SCHEMAS[] + dispatchTool()
│   │   ├── render.ts            ← renderCarousel / renderQuotePost / renderThumbnail
│   │   ├── drafts.ts            ← saveDraft / saveYoutubeDraft / publishDraftById
│   │   ├── email.ts             ← sendPreviewEmail (uses Cloudflare Email Routing)
│   │   ├── zernio.ts            ← zernioPublish (generic multi-platform)
│   │   ├── youtube.ts           ← transcribeVideo + zernioYoutubePublish
│   │   ├── reel.ts              ← processReel (raw video → cut + caption)
│   │   ├── higgsfield.ts        ← higgsfieldSoulVideo (script → avatar video)
│   │   └── meta-ads.ts          ← metaAdsCreateDraft (image or video variants)
│   └── triggers/
│       ├── manual.ts            ← POST /trigger/manual (JSON intent)
│       ├── telegram.ts          ← POST /trigger/telegram (webhook)
│       ├── email.ts             ← email() handler — also handles ship/reject replies
│       ├── cron.ts              ← scheduled() handler — pillar rotation, auto-publish
│       ├── upload.ts            ← POST /trigger/upload (raw MP4 → reel pipeline)
│       ├── reel.ts              ← POST /trigger/reel (r2_key → reel pipeline)
│       ├── avatar.ts            ← POST /trigger/avatar (brief → Higgsfield)
│       ├── youtube.ts           ← /trigger/youtube + /trigger/youtube-upload
│       ├── meta-ad.ts           ← POST /trigger/meta-ad (brief → 6 ad variants)
│       ├── meta-ad-remix.ts     ← POST /trigger/meta-ad-from-draft (reuse draft media)
│       └── r2.ts                ← GET /r2/* (proxy bucket reads for previews)
└── container/
    ├── Dockerfile               ← python:3.12-slim + ffmpeg + DejaVu fonts
    ├── requirements.txt         ← fastapi, uvicorn, faster-whisper, httpx, pydantic
    ├── .dockerignore
    └── app/
        ├── __init__.py
        ├── main.py              ← FastAPI: /process-reel /transcribe /generate-avatar-reel
        ├── pipeline.py          ← run_reel_pipeline (transcribe → cut → burn)
        ├── transcribe.py        ← faster-whisper base/int8 + VAD
        ├── cut.py               ← silence_cut_clips + shift_words + run_ffmpeg_concat
        ├── captions.py          ← build_opus_ass (word-by-word) + build_minimal_ass
        └── higgsfield.py        ← submit + poll Higgsfield Soul video API
```

## Triggers (Worker public surface)

All `/trigger/*` routes require `Authorization: Bearer $ACQUISITION_OS_API_TOKEN`.

| Trigger | Method | Body / Query | What it does |
|---|---|---|---|
| `/trigger/manual` | POST | `{ intent: string }` | Agent runs free-form brief. Defaults to a static post |
| `/trigger/upload` | POST | `Content-Type: video/*` body, `?slug=&brief=` | Stores raw MP4 → kicks off reel pipeline (cut + caption + thumbnail + multi-platform draft) |
| `/trigger/reel` | POST | `{ r2_key, brief?, caption_style? }` | Same as upload but the MP4 is already in R2 |
| `/trigger/avatar` | POST | `{ brief, aspect_ratio?, voice_id?, caption_style? }` | Script → Higgsfield Soul → captions → draft |
| `/trigger/youtube-upload` | POST | `Content-Type: video/*` body, `?slug=&brief=&yt_account_id=` | Long-form: transcribe → chapters → 3 titles → 3 thumbnails → SEO desc → draft |
| `/trigger/youtube` | POST | `{ r2_key, brief?, yt_account_id? }` | Same but MP4 already in R2 |
| `/trigger/meta-ad` | POST | `{ brief, offer_url, objective?, count? }` | Agent renders/sources N ad variants (image, video, or mixed) → PAUSED $0 draft in Ads Manager |
| `/trigger/meta-ad-from-draft` | POST | `{ draft_id, offer_url, count?, objective?, extra_brief? }` | Reuses existing draft's media, writes N new copy angles, uploads as ads |
| `/trigger/telegram` | POST | Telegram webhook | Conversational interface |
| Inbound email | — | Email Routing → email() handler | Subject+body → brief; `ship dft_xxxx` / `no` → approve/reject |
| Daily cron | — | `0 7 * * *` (default) | Pillar-rotated static post, auto-publishes |

## Tools the agent has

Each tool's full schema lives in [src/tools/index.ts](src/tools/index.ts) (`TOOL_SCHEMAS`). Dispatch in same file.

| Tool | Purpose |
|---|---|
| `render_carousel` | 1–10 slides at 1080×1350 using `slide-title` / `slide-list` / `slide-cta` templates |
| `render_quote_post` | Single 1080×1080 quote |
| `render_thumbnail` | 1280×720 thumbnail with one-word accent color |
| `process_reel` | Raw MP4 → silence-cut + caption-burn + transcript (Container `/process-reel`) |
| `higgsfield_soul_video` | Script → trained-face avatar video + captions (Container `/generate-avatar-reel`, forwards `x-higgsfield-key` header) |
| `transcribe_video` | Transcript-only, no video processing (Container `/transcribe`) |
| `meta_ads_create_draft` | Create PAUSED Meta campaign + ad set + N ad creatives (image OR video OR mixed). UTM params auto-injected. Always $0 daily budget |
| `save_draft` | Persist non-YT draft to D1 |
| `save_youtube_draft` | Persist YT draft with 3 titles + 3 thumbnails + chapters + tags |
| `publish_draft_by_id` | Routes by format. YouTube → `zernioYoutubePublish`. Refuses reels, avatars, YouTube on cron, and meta_ads outright |
| `send_preview_email` | Sends approval-required preview via Cloudflare Email Routing |

## Required setup (creator-side)

Verbatim from README:

```bash
cd skalers/acquisition-os
bun install
bunx wrangler login

# Provision (3 commands), paste IDs into wrangler.toml REPLACE_ME_AFTER_FIRST_DEPLOY slots
bunx wrangler kv namespace create SECRETS
bunx wrangler kv namespace create CONFIG
bunx wrangler r2 bucket create acquisition-os-assets
bunx wrangler d1 create acquisition-os

# Apply schema
bunx wrangler d1 execute acquisition-os --file=migrations/0001_init.sql --remote

# Secrets
bunx wrangler secret put ANTHROPIC_API_KEY
bunx wrangler secret put ZERNIO_API_KEY
bunx wrangler secret put ACQUISITION_OS_API_TOKEN
bunx wrangler secret put HIGGSFIELD_API_KEY        # optional, Phase 3
bunx wrangler secret put META_ADS_TOKEN            # optional, Phase 5
bunx wrangler secret put TELEGRAM_BOT_TOKEN        # optional

# Creator config (4 markdown files → KV)
bunx wrangler kv key put --binding=CONFIG voice-fingerprint.md  --path=creator-config-template/voice-fingerprint.md
bunx wrangler kv key put --binding=CONFIG business-brief.md     --path=creator-config-template/business-brief.md
bunx wrangler kv key put --binding=CONFIG hook-bank.md          --path=creator-config-template/hook-bank.md
bunx wrangler kv key put --binding=CONFIG content-pillars.md    --path=creator-config-template/content-pillars.md
# optional
bunx wrangler kv key put --binding=CONFIG SOUL_ID            "soul_xxxxx"
bunx wrangler kv key put --binding=CONFIG YT_ACCOUNT_ID      "yt_xxxxx"
bunx wrangler kv key put --binding=CONFIG META_AD_ACCOUNT_ID "act_xxxxx"
bunx wrangler kv key put --binding=CONFIG META_PAGE_ID       "1234567890"

# Edit wrangler.toml [vars] (CREATOR_NAME, TIMEZONE, ZERNIO_PROFILE_ID, APPROVAL_EMAIL)

# Deploy (builds Container image + Worker in one shot)
bun run typecheck
bunx wrangler deploy

# Optional wiring
# - Cloudflare dashboard → Email → Email Routing → catch-all → this Worker
# - Telegram: BotFather → setWebhook to .../trigger/telegram
```

## Security model

| Concern | Mechanism |
|---|---|
| Agent sees raw API keys | **No.** Tools dispatch in Worker code; agent only sees tool names + structured args |
| Public-facing routes get hit by anyone | All `/trigger/*` require `Bearer $ACQUISITION_OS_API_TOKEN` |
| Container exposed publicly | **No.** Container is reached only via Worker's `env.PROCESSOR` service binding. No public route |
| Higgsfield key in container env at rest | **No.** Worker forwards key per-request as `X-Higgsfield-Key` header |
| Inbound email from unauthorized sender | `email()` handler rejects anything not from `APPROVAL_EMAIL` |
| Accidental Meta ad spend | 3 gates: (1) tool always sets `status: PAUSED`, (2) ad set `daily_budget: 0`, (3) `publishDraftById` refuses `meta_ads` outright |
| Reels auto-publishing without approval | Cron prompt explicitly says "static formats only"; `publishDraftById` for reels is only reachable via human reply `ship dft_xxxx` |

## Costs (per creator, monthly)

| Item | Estimate |
|---|---|
| **Cloudflare** (Worker + KV + R2 + D1 + Browser + Container, scale-to-zero) | $0–3 — most stays on free tier |
| **Anthropic** | ~$5–15 for ~30 cron sessions/mo + ad-hoc |
| **Zernio** | Per their plan |
| **Higgsfield** (only if avatar reels enabled) | Per their plan |
| **Meta Ads** (token is free; the actual ad spend is the creator's choice once they unpause) | $0 from us |
| **Total platform overhead** | ~$10–25/mo per creator |

R2 egress is **$0** because video bytes never leave Cloudflare's network. The Worker streams to the Container via service binding (same colo).

## Known guesses / needs verification

These were written against inferred contracts. **First deploy will surface mismatches.**

1. **Higgsfield API shape** ([container/app/higgsfield.py](container/app/higgsfield.py)). Base URL `https://platform.higgsfield.ai/v1`, payload `{model, soul_id, prompt, aspect_ratio}`, polling `GET /videos/{id}`. Adjust in one file. Endpoint may actually live elsewhere (e.g. `api.higgsfield.com`) and field names may differ.

2. **Cloudflare Browser Rendering API** ([src/tools/render.ts](src/tools/render.ts)). I used `env.BROWSER.fetch("https://browser.cloudflare.com/screenshot", ...)`. The actual binding may expose a different URL or take a different request body shape.

3. **Cloudflare Containers config** ([wrangler.toml](wrangler.toml)). `[[containers]]` syntax has shifted between iterations. Watch `wrangler deploy` output for "unknown field" errors.

4. **Meta Graph video upload** ([src/tools/meta-ads.ts](src/tools/meta-ads.ts)). I use `POST /advideos?file_url=...` which works for sized-bounded videos. Larger videos may require the resumable upload endpoint. Add chunked path if first deploy hits a size error.

5. **Zernio YouTube `platformSpecificData`** ([src/tools/youtube.ts](src/tools/youtube.ts)). Field names (`title`, `description`, `tags`, `category`, `visibility`, `embeddable`, `publicStatsViewable`) inferred from existing Python client. May differ from Zernio's actual schema.

6. **Anthropic SDK version**. `package.json` pins `^0.40.0`. Newer versions exist; the Messages API tool-use loop shape may have changed. The `managed-agents-2026-04-01` beta header is set but we use the regular Messages API loop, not the dedicated Managed Agents endpoint — so the header may be a no-op.

## What's NOT done

- **Never deployed in production.** Typecheck passes; nothing has been validated against a real Cloudflare account.
- **Phase 6 (production rollout)**: lesson page on skalers.io/dashboard, beta cohort onboarding, docs, troubleshooting guide.
- **Setup wizard UI**: today setup is 9 CLI commands. A webform-driven wizard in skalers.io/dashboard would auto-provision and write secrets via Cloudflare API. Required for true one-click install to non-technical creators.
- **Inbox dashboard**: today drafts approve via email reply. A web inbox would be much better daily UX.
- **Performance feedback loop**: no Zernio analytics integration yet. Top-performing posts don't yet feed back into the hook bank.
- **DM/comment auto-responder**: when someone DMs "100K" on a published reel, no automation responds yet. Big gap for the "no calls" SCALING promise.
- **Multi-platform OAuth**: Zernio is the only publishing path. Direct platform APIs (IG Graph, TikTok, LinkedIn, YT Data API) aren't wired in.

## Recommended next steps (priority order)

1. **Smoke-test on Max's Cloudflare** (~half day). Deploy → push one carousel + one reel + one meta-ad through → fix the 3–5 things that break. Most leveraged work that exists.
2. **Verify Higgsfield API contract** (~1 hour, can be done locally with the API key without deploying). Confirms Phase 3 will work.
3. **Performance feedback loop** (~1 day). Daily cron reads Zernio analytics → ranks posts → updates `top-performers.md` in CONFIG KV → agent uses it as priors. Closes the loop from "generator" to "optimizer."
4. **Setup wizard UI** (~2 days). Required before opening to non-technical Skalers students.
5. **DM/comment auto-responder** (~1.5 days). The conversion hook.

## Source of truth pointers

- **Plan file** (original strategic plan): `~/.claude/plans/get-the-description-and-rippling-wolf.md`
- **README** (user-facing setup): [README.md](README.md)
- **This file** (handoff): you're reading it
- **Container code**: [container/](container/) and its [README.md](container/README.md) is gone — root README covers it
- **Source video** that inspired the architecture: https://www.youtube.com/watch?v=lQxrHmjHf28 (Cloudflare Developers, "Run Claude Managed Agents on Cloudflare")

## Branding

**Acquisition OS — Powered by Claude.** Anthropic guidelines forbid "Claude Code Agent" or "Claude Cowork." Per skalers context memory: this product is one of the SCALING System modules under the A (Attention) letter, but the product is named Acquisition OS to reflect that it covers attention + leads + conversion creative — the broader top of funnel.
