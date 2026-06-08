# Set up Content OS (step by step)

This is the do-it-yourself guide. Follow it top to bottom. Most people are live
in about 15 to 20 minutes. You do not need to code. You will create a few free
accounts, copy a key from each, and paste them into one screen in Cloudflare.

> **Prefer to skip all of this?** The **done-for-you** option at
> [10xcontent.io](https://10xcontent.io) means we do every step below for you and
> hand you a finished, working system. This guide is only for the DIY option.

> **Already bought DIY and want us to take it the rest of the way?** Use code
> **`DIYUPGRADE`** at [10xcontent.io](https://10xcontent.io) on the DFY plan to
> get **$150 off** (your DIY payment, credited back). You only pay the
> difference. See [Upgrade to done-for-you](#upgrade-to-done-for-you) at the end.

> 🔧 **The exact tools I use, with my links:**
> [skalers.io/dashboard/scaling-overview?panel=tools](https://skalers.io/dashboard/scaling-overview?panel=tools)

### Accounts you'll need
Free to create, walked through below.

| Service | Needed? | What it does |
|---------|---------|--------------|
| GitHub | Required | Holds your copy of the code |
| Cloudflare | Required | Where Content OS runs (+ your storage) |
| Anthropic (Claude) | Required | The editing + captions brain |
| Groq | Required (free) | Transcribes your videos |
| Zernio | Required | Publishes to your 5 platforms |
| Telegram | Required | How you talk to it |
| KIE.AI | Optional | AI thumbnails + AI avatar reels |
| ElevenLabs | Optional | The voice for AI avatar reels |

Have a second browser tab open for grabbing keys. Paste each key into a notes app
as you go; you'll add them all to Cloudflare in Step 4.

---

## Step 1: Create a GitHub account + accept your invite

GitHub stores your own copy of the Content OS code.

**Don't have GitHub yet?**
1. Go to [github.com/signup](https://github.com/signup).
2. Enter your email, a password, and a username, then verify your email.
3. Official guide: [Creating an account on GitHub](https://docs.github.com/en/get-started/start-your-journey/creating-an-account-on-github).

**Accept your invite** (we send it to your GitHub email after you buy):
1. Open the email from GitHub and click **View invitation**, or go to
   [github.com/systemstoscale/content-os/invitations](https://github.com/systemstoscale/content-os/invitations).
2. Click **Accept invitation**. Done, you now have access.

## Step 2: Create a Cloudflare account + one-click deploy

Cloudflare is where Content OS actually runs. It's free to start.

**Don't have Cloudflare yet?**
1. Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
2. Enter your email + a password and verify your email.
3. Official guide: [Create a Cloudflare account](https://developers.cloudflare.com/fundamentals/setup/account/create-account/).

**Deploy Content OS:**
1. Click **Deploy to Cloudflare** (in the repo README), or use this link:
   [deploy.workers.cloudflare.com/?url=...content-os](https://deploy.workers.cloudflare.com/?url=https://github.com/systemstoscale/content-os).
2. Sign in to Cloudflare and approve the GitHub connection.
3. Cloudflare copies the project into your GitHub and provisions everything
   (your database, storage, and worker) in your account.
4. Wait for the build to finish (a few minutes). You'll get a URL like
   `https://content-os.<you>.workers.dev`. Keep that tab open.

## Step 3: Create each service account + grab its key

Work through these in order. Create the account if you don't have one, then copy
the key into your notes.

### 3.1 Anthropic (Claude) — required — the editing brain
1. **Create an account:** go to [console.anthropic.com](https://console.anthropic.com)
   and sign up (you can also start from my tools page above).
2. Add a small amount of credit under **Billing** (the editor pays per use; a few
   dollars goes a long way).
3. **Get the key:** [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
   → **Create Key** → copy it (starts with `sk-ant-`).
4. Docs: [Anthropic API getting started](https://docs.anthropic.com/en/api/getting-started).

### 3.2 Groq — required, free — transcription
1. **Create an account:** [console.groq.com](https://console.groq.com) (free, no card).
2. **Get the key:** [console.groq.com/keys](https://console.groq.com/keys) →
   **Create API Key** → copy it (starts with `gsk_`).
3. Docs: [Groq quickstart](https://console.groq.com/docs/quickstart).

### 3.3 Zernio (getlate.dev) — required — publishing
1. **Create an account:** [skalers.io/zernio](https://skalers.io/zernio).
2. **Connect your platforms** inside Zernio: Instagram, TikTok, YouTube,
   Facebook, LinkedIn (whichever you post to).
3. **Get the key + profile id:** **Settings → API** → copy your **API key**, and
   note your **Profile ID** (in the URL or profile settings).
4. Docs: [docs.getlate.dev](https://docs.getlate.dev).

### 3.4 Cloudflare R2 — required — storage (uses your Cloudflare from Step 2)
1. In your Cloudflare dashboard: **R2 → Manage R2 API Tokens → Create API Token**.
2. Permission: **Object Read & Write** → **Create**.
3. Copy the **Access Key ID** and **Secret Access Key**.
4. Also copy your **Account ID** (Workers & Pages → right sidebar).
5. Docs: [Cloudflare R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/).

### 3.5 Telegram bot — required — your control surface
1. **Don't have Telegram?** Install the app from [telegram.org](https://telegram.org)
   and create an account with your phone number.
2. **Create your bot:** open [@BotFather](https://t.me/BotFather) in Telegram →
   send `/newbot` → pick a name and username → copy the **bot token** it gives you
   (looks like `1234:ABC...`).
3. Docs: [BotFather / create a bot](https://core.telegram.org/bots/features#botfather).

### 3.6 KIE.AI — optional — AI thumbnails + AI avatar reels
Skip this unless you want AI-generated thumbnails or AI-avatar reels.
1. **Create an account:** [kie.ai](https://kie.ai).
2. **Get the key:** in your dashboard, create an **API key** and copy it.
3. Docs: [docs.kie.ai](https://docs.kie.ai).

### 3.7 ElevenLabs — optional — the voice for AI avatar reels
Only needed if you want **faceless / AI-avatar reels**. ElevenLabs makes the
voice; KIE makes the talking face. If you only post talking-head reels you
filmed yourself, you don't need this at all.
1. **Create an account:** [skalers.io/elevenlabs](https://skalers.io/elevenlabs).
2. **Get the key:** **Profile → API Keys** → copy it.
3. Docs: [ElevenLabs docs](https://elevenlabs.io/docs).

## Step 4: Paste your keys into Cloudflare

1. In Cloudflare, go to **Workers & Pages → content-os → Settings → Variables and
   Secrets**.
2. Add each of these as an **Encrypted** secret (click **Add**, type the name,
   paste the value, choose Encrypt, Save):

   | Name | Paste | Required? |
   |------|-------|-----------|
   | `ANTHROPIC_API_KEY` | your Claude key | Yes |
   | `GROQ_API_KEY` | your Groq key | Yes |
   | `ZERNIO_API_KEY` | your Zernio key | Yes |
   | `ZERNIO_PROFILE_ID` | your Zernio profile id | Yes |
   | `CLOUDFLARE_ACCOUNT_ID` | your account id | Yes |
   | `R2_ACCESS_KEY_ID` | from the R2 token | Yes |
   | `R2_SECRET_ACCESS_KEY` | from the R2 token | Yes |
   | `TELEGRAM_BOT_TOKEN` | your bot token | Yes |
   | `KIE_AI_API_KEY` | your KIE.AI key | Optional |
   | `ELEVENLABS_API_KEY` | your ElevenLabs key | Optional |

3. Click **Deploy** (top right) so the new secrets take effect.

## Step 5: Finish setup

1. Open your worker URL (from Step 2) and complete the short **/setup** screen
   (your name, timezone, email). It gives you a login.
2. In settings, set your connected accounts: paste a small map of the platforms
   you connected in Zernio, for example
   `{"instagram":{"accountId":"..."},"tiktok":{"accountId":"..."}}` into the
   `ZERNIO_ACCOUNTS` config field.

## Step 6: Pair Telegram + brand it

1. Open your bot in Telegram and send `/start` to pair it to you.
2. Send `/brand` and pick your fonts, colors, caption style, motion style, and
   thumbnail look. You get live previews.

## Step 7: Make your first reel 🎬

Record a short talking-head clip on your phone and send it to your bot. Pick
**Talking head → Captions + motion graphics**. In a few minutes you get a
finished reel with a caption and thumbnail. Tap **Publish now**, **Schedule**, or
**Add to queue**. That is it.

---

## Upgrade to done-for-you

Set up DIY and decided you'd rather we just handle it? You can upgrade any time
and **we credit your $150 back**:

1. Go to [10xcontent.io](https://10xcontent.io) and choose the **DFY** plan.
2. Enter code **`DIYUPGRADE`** for **$150 off** (you only pay the difference).
3. Fill the secure form with your accounts above and we install, brand, and
   connect everything for you, live within 48 hours.

---

## Troubleshooting

- **A reel failed to render.** Check that `ANTHROPIC_API_KEY`, `GROQ_API_KEY`,
  and the three R2 values are set, then redeploy.
- **Nothing published.** Make sure your platforms are connected in Zernio and
  `ZERNIO_ACCOUNTS` lists them.
- **Bot not responding.** Re-send `/start`. Confirm `TELEGRAM_BOT_TOKEN` is set
  and you deployed after adding it.
- **Stuck anywhere?** Email `max@skalers.io`, or upgrade to done-for-you at
  [10xcontent.io](https://10xcontent.io) and we will finish the setup for you.
