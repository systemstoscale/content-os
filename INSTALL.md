# Acquisition OS — Install on Max's Cloudflare account

Step-by-step plan to stand the system up end-to-end. **Expect bugs.** Each phase ends with a verification step that surfaces real failures.

Total realistic time: **4–6 hours of focused work**, including bug-fixing.

---

## Pre-flight (10 min) — confirm prerequisites

Before touching anything, gather these so you're not interrupted later:

- [ ] Cloudflare account login + access to the **skalers** team workspace
- [ ] Cloudflare API token with scopes: `Workers Scripts:Edit`, `Workers KV:Edit`, `R2:Edit`, `D1:Edit`, `Browser Rendering:Edit`, `Cron:Edit`, `Email:Edit`, `Containers:Edit`
- [ ] Anthropic API key (from `https://console.anthropic.com/settings/keys`)
- [ ] Zernio API key + your `@scalermax` profile ID (per memory: `695061a982617b5c3fd7edf1`)
- [ ] Higgsfield API key (only if you want avatar reels in this first install — recommend skipping for v1)
- [ ] Meta Ads access token + ad account ID + page ID (only if you want Meta Ads in v1 — skip)
- [ ] A Cloudflare-managed domain you can point email routing at (e.g. `agent.scalermax.com` or a subdomain you control)

**Decision**: For the first install, ship with **carousels + quote posts + talking-head reels only**. Skip avatar reels (Higgsfield), YouTube long-form, and Meta Ads on first deploy. Those add 5+ verification surfaces; we want to find code bugs, not API bugs, on day one.

---

## Phase A — Local prep (15 min)

```bash
cd /Users/max/Documents/Antigravity/Skalers.io/skalers/acquisition-os

# 1. Verify deps install cleanly
bun install

# 2. Typecheck baseline
bun run typecheck

# 3. Check wrangler is logged in to the right account
bunx wrangler whoami
# If wrong account: bunx wrangler logout && bunx wrangler login
```

**Likely first bug**: `@cloudflare/containers@0.1.0` may not exist or may be deprecated. If install fails, check `bun add @cloudflare/containers@latest` and update the version in `package.json` accordingly.

---

## Phase B — Provision Cloudflare resources (20 min)

```bash
# KV namespaces (returns IDs — paste into wrangler.toml)
bunx wrangler kv namespace create SECRETS
bunx wrangler kv namespace create CONFIG

# R2 bucket
bunx wrangler r2 bucket create acquisition-os-assets

# D1 database (returns ID — paste into wrangler.toml)
bunx wrangler d1 create acquisition-os

# Apply D1 schema
bunx wrangler d1 execute acquisition-os --file=migrations/0001_init.sql --remote
```

**Action**: Edit [wrangler.toml](wrangler.toml) and replace each `REPLACE_ME_AFTER_FIRST_DEPLOY` with the actual ID returned above. Three replacements total.

**Verification**: `bunx wrangler kv key list --binding=CONFIG` returns `[]` (empty but the namespace exists).

**Likely bug**: D1 migration may fail on the `INTEGER PRIMARY KEY AUTOINCREMENT` line if D1's SQL dialect differs. If so, change to plain `INTEGER PRIMARY KEY`.

---

## Phase C — Set secrets (10 min)

```bash
# Mandatory
bunx wrangler secret put ANTHROPIC_API_KEY
bunx wrangler secret put ZERNIO_API_KEY
bunx wrangler secret put ACQUISITION_OS_API_TOKEN   # generate fresh: openssl rand -hex 24
```

Skip Higgsfield, Meta, Telegram for the first deploy.

---

## Phase D — Edit `wrangler.toml` vars (5 min)

```toml
[vars]
CREATOR_NAME = "Max Warnault"
CREATOR_TIMEZONE = "Europe/Paris"
ZERNIO_PROFILE_ID = "695061a982617b5c3fd7edf1"   # @scalermax personal
APPROVAL_EMAIL = "max@adslab.com"
TELEGRAM_CHAT_ID = ""
```

Also delete the `[[unsafe.bindings]]` Email block for the first deploy — we'll wire email after the worker is live.

---

## Phase E — Upload creator config to CONFIG KV (30 min)

Edit the 4 templates in [creator-config-template/](creator-config-template/) with your real content:

- [ ] `voice-fingerprint.md` — copy from `context/voice-fingerprint.md` or generate via the `0-voice-fingerprint` skill
- [ ] `business-brief.md` — copy from `context/1-business.md` (the client roster + offers + ICP)
- [ ] `hook-bank.md` — pull from `context/hook-bank.md` or run the `2-hook-bank` skill
- [ ] `content-pillars.md` — 5–7 themes (write fresh — the 7 SCALING letters work)

Then upload:

```bash
bunx wrangler kv key put --binding=CONFIG voice-fingerprint.md --path=creator-config-template/voice-fingerprint.md
bunx wrangler kv key put --binding=CONFIG business-brief.md    --path=creator-config-template/business-brief.md
bunx wrangler kv key put --binding=CONFIG hook-bank.md         --path=creator-config-template/hook-bank.md
bunx wrangler kv key put --binding=CONFIG content-pillars.md   --path=creator-config-template/content-pillars.md
```

**Verification**: `bunx wrangler kv key get --binding=CONFIG voice-fingerprint.md` returns the markdown content.

---

## Phase F — First deploy (45 min, expect 2–4 bugs)

```bash
bun run typecheck   # final sanity check
bunx wrangler deploy
```

**What will likely break:**

1. **Container build failure** — Docker image too large, ffmpeg layer missing, Python version mismatch. Fix Dockerfile in [container/Dockerfile](container/Dockerfile).
2. **`[[containers]]` syntax error** — adjust per Wrangler's error message.
3. **DO migration error** — `new_sqlite_classes` may need to be `new_classes`. Adjust [wrangler.toml](wrangler.toml).
4. **`@cloudflare/containers` API mismatch** — `getContainer(env.PROCESSOR)` may need to be `env.PROCESSOR.get(env.PROCESSOR.idFromName("singleton"))`. Adjust [src/processor.ts](src/processor.ts).

When `wrangler deploy` succeeds, you'll get a URL like `https://acquisition-os.<your-subdomain>.workers.dev`.

**Verification**:

```bash
curl https://acquisition-os.<your-subdomain>.workers.dev/health
# Expected: {"ok":true,"creator":"Max Warnault"}
```

If this fails, the worker doesn't run at all. Iterate until `/health` returns OK.

---

## Phase G — Static post smoke test (30 min, expect 1–2 bugs)

The lightest possible test — no video processing, no third-party calls beyond Anthropic + Zernio.

```bash
curl -X POST https://acquisition-os.<your-subdomain>.workers.dev/trigger/manual \
  -H "authorization: Bearer $ACQUISITION_OS_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"intent":"Quote post: nothing scales until your offer scales"}'
```

**Expected within ~60s**: agent renders a 1080×1080 PNG, saves draft to D1, returns `sessionId` + final text.

**Tail logs** in another terminal:
```bash
bunx wrangler tail
```

**What will likely break:**

1. **Browser Rendering binding error** — `env.BROWSER.fetch(...)` may return 4xx because the URL/payload I guessed is wrong. Fix in [src/tools/render.ts](src/tools/render.ts) using the real Cloudflare Browser Rendering REST shape.
2. **Anthropic SDK version mismatch** — tool-use loop shape may have changed. Bump `@anthropic-ai/sdk` to latest, fix any TypeScript errors in [src/agent.ts](src/agent.ts).
3. **D1 column type mismatch** — sometimes string-vs-number coercion silently fails. Watch `wrangler tail` for SQL errors.

**Verification when working**:
```bash
bunx wrangler d1 execute acquisition-os --remote --command="SELECT id, format, status, caption FROM drafts ORDER BY created_at DESC LIMIT 1"
# Expect one row with format=quote_post, status=pending
```

---

## Phase H — Email approval flow (45 min)

Now wire inbound email so you can ship drafts by reply.

1. **In Cloudflare dashboard** → Email → Email Routing → enable on your chosen domain (e.g. `scalermax.com`)
2. **Add a catch-all rule**: `*@agent.scalermax.com` → **send to Worker** → pick `acquisition-os`
3. **Re-deploy** the worker (it already has the `email()` handler exported)
4. **Add the `[[send_email]]` binding** to `wrangler.toml` (replace the `[[unsafe.bindings]]` block from earlier):
   ```toml
   [[send_email]]
   name = "EMAIL"
   destination_address = "max@adslab.com"
   ```
5. **Re-deploy**

**Smoke test**:
- Send an email from `max@adslab.com` to `topic@agent.scalermax.com` with subject `"Carousel about firing your VAs"`
- Expect: reply email arrives ~60s later with draft ID + preview links
- Reply `ship dft_xxxx`
- Verify: post lands on @scalermax IG within ~30s

**Likely bugs**:
- Email routing rule may need a few minutes to propagate
- `sendPreviewEmail` may need adjustment if [src/tools/email.ts](src/tools/email.ts) `EmailMessage` import is wrong
- The Zernio publish call may fail if the platforms array shape doesn't match what Zernio expects

---

## Phase I — Talking-head reel smoke test (60 min, expect Container surprises)

This is the first test of the Container. Expect more friction.

```bash
# Use a short test clip (10–30 seconds)
curl -X POST "https://acquisition-os.<your-subdomain>.workers.dev/trigger/upload?slug=smoke-test&brief=test+reel" \
  -H "authorization: Bearer $ACQUISITION_OS_API_TOKEN" \
  -H "content-type: video/mp4" \
  --data-binary @path/to/short-test-clip.mp4
```

**Watch `wrangler tail`** for ~2–3 minutes.

**What will likely break:**

1. **Container cold start** — first request triggers image pull + container boot, 30–60s. Subsequent requests are fast.
2. **faster-whisper model download** — first transcribe takes ~2 min as Whisper `base` model downloads. Subsequent fast.
3. **ffmpeg path issues** — confirm Dockerfile actually installs `ffmpeg` and it's in `$PATH`
4. **Memory limits** — Container's default memory may be too low for 30-second 1080p video processing. Bump `instance_type` to `standard` or higher in `wrangler.toml`.
5. **Service binding round-trip** — `processorFetch` may need adjustment if `@cloudflare/containers` API differs.

**Verification**:
- Email arrives with link to processed video (silences cut, captions burned)
- Watch the video — confirm captions are word-by-word and the cuts are clean
- Reply `ship dft_xxxx` → published to your IG

---

## Phase J — Daily cron (15 min)

The most important test: this is the autopilot.

```bash
# Trigger cron manually (won't run on schedule until tomorrow morning)
bunx wrangler dev --remote
# In another terminal:
curl -X POST "https://acquisition-os.<your-subdomain>.workers.dev/cdn-cgi/handler/scheduled"
```

Or just wait until 09:00 Paris tomorrow.

**Expected**: agent reads pillars from CONFIG, picks one not used in last 7 days, drafts a carousel or quote, **auto-publishes** without waiting for your approval (cron drafts only).

**Verification**:
```bash
bunx wrangler d1 execute acquisition-os --remote --command="SELECT * FROM pillar_log ORDER BY posted_at DESC LIMIT 5"
```

---

## Stopping point for v1

Once Phases A–J pass:

- ✅ Worker deployed, container running
- ✅ Manual triggers work (carousel, quote, reel)
- ✅ Email approval loop works
- ✅ Cron auto-publishes daily
- ✅ Drafts persist to D1, pillar rotation works

That's enough to **dogfood for 2 weeks**. Run daily content through your own AOS install. Find the rest of the bugs (preview email formatting, caption tone, hook quality, render-quality issues).

After 2 weeks of clean dogfooding, then we add:
- Higgsfield avatar reels (Phase 3 capability)
- YouTube long-form (Phase 4)
- Meta Ads (Phase 5)

And only after Higgsfield + YT + Meta all pass on YOUR account do we start the productization sprint (web installer, OAuth flows, automated provisioning) to ship to your first beta student.

---

## What to do when something breaks

Three rules:

1. **`wrangler tail`** in a second terminal — you'll see the actual error
2. **Fix the one file** that owns that surface — most failures map to a single TS file
3. **Re-deploy with `wrangler deploy`** — full rebuild is <60s

The bugs you'll find on this first deploy are the **last** structural bugs in the system. Everything after this is iteration on quality.

---

## If you get stuck

The 3 most likely failure modes and their files:

| Symptom | File to check |
|---|---|
| Worker deploy fails on Container | [wrangler.toml](wrangler.toml), [container/Dockerfile](container/Dockerfile) |
| Browser Rendering returns 4xx | [src/tools/render.ts](src/tools/render.ts) — the `https://browser.cloudflare.com/screenshot` URL |
| Agent loop errors on tool-use | [src/agent.ts](src/agent.ts) — Anthropic SDK version + tool_use block shape |

Any other failure: paste the `wrangler tail` output into a new Claude session with the prompt:

> Read `skalers/acquisition-os/STATUS.md` and `skalers/acquisition-os/INSTALL.md`, then help me debug this error from the deploy: [paste]
