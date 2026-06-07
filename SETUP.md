# Set up Content OS (step by step)

This is the do-it-yourself guide. Follow it top to bottom. Most people are live
in about 10 to 15 minutes. You do not need to code. You will copy a few keys
from other websites and paste them into Cloudflare.

> Prefer to skip all of this? The **done-for-you** option at
> [10xcontent.io](https://10xcontent.io) means we do every step below for you and
> hand you a finished, working system. This guide is only for the DIY option.

You will need: a Cloudflare account (free), a GitHub account, and about 15
minutes. Have a second browser tab open for grabbing keys.

---

## Step 1: Accept your GitHub invite

After you buy, we email you a GitHub invitation to the private Content OS repo.

1. Open the email from GitHub and click **View invitation** (or go to
   `https://github.com/systemstoscale/content-os/invitations`).
2. Click **Accept invitation**. Done. You now have access.

## Step 2: Click "Deploy to Cloudflare"

1. Go to the repo's README and click the **Deploy to Cloudflare** button (or use
   this link): `https://deploy.workers.cloudflare.com/?url=https://github.com/systemstoscale/content-os`
2. Sign in to Cloudflare (create a free account if you do not have one).
3. Approve the GitHub connection. Cloudflare copies the project into your own
   GitHub and sets up everything (your database, storage, and worker) in your
   account.
4. Wait for the build to finish (a few minutes). When it is done you get a URL
   like `https://content-os.<you>.workers.dev`. Keep that tab open.

## Step 3: Get your keys (copy each one)

Open each link, create the key, and paste it somewhere temporary (a notes app).
You will add them to Cloudflare in Step 4.

1. **Anthropic (Claude)**: powers the editing + captions.
   These are the tools I actually run across my businesses:
   `https://skalers.io/dashboard/scaling-overview?panel=tools`. Sign up for
   Anthropic there, then go to `https://console.anthropic.com/settings/keys` →
   **Create Key** → copy it (starts with `sk-ant-`).
2. **Groq**: does the transcription (free).
   Go to `https://console.groq.com/keys` → **Create API Key** → copy it (starts
   with `gsk_`).
3. **Zernio**: publishes to your platforms. (`getlate.dev`)
   Sign up, then **Settings → API** → copy your **API key**. Then connect your
   Instagram / TikTok / YouTube / Facebook / LinkedIn accounts in Zernio. Note
   your **Profile ID** (in the URL or profile settings).
4. **Cloudflare R2 token**: lets the editor save finished reels.
   In your Cloudflare dashboard: **R2 → Manage R2 API Tokens → Create API Token**
   → permission **Object Read & Write** → **Create**. Copy the **Access Key ID**
   and **Secret Access Key**. Also copy your **Account ID** (Workers & Pages →
   right sidebar).
5. **Telegram bot**: how you talk to it.
   In Telegram, open **@BotFather** → send `/newbot` → pick a name → copy the
   **bot token** it gives you (looks like `1234:ABC...`).

Optional (skip for now if you want): **KIE.AI** key (AI thumbnails) and
**ElevenLabs** key (voice for AI avatar reels).

## Step 4: Paste your keys into Cloudflare

1. In Cloudflare, go to **Workers & Pages → content-os → Settings → Variables and
   Secrets**.
2. Add each of these as an **Encrypted** secret (click **Add**, type the name,
   paste the value, choose Encrypt, Save):

   | Name | Paste |
   |------|-------|
   | `ANTHROPIC_API_KEY` | your Claude key |
   | `GROQ_API_KEY` | your Groq key |
   | `ZERNIO_API_KEY` | your Zernio key |
   | `ZERNIO_PROFILE_ID` | your Zernio profile id |
   | `CLOUDFLARE_ACCOUNT_ID` | your account id |
   | `R2_ACCESS_KEY_ID` | from the R2 token |
   | `R2_SECRET_ACCESS_KEY` | from the R2 token |
   | `TELEGRAM_BOT_TOKEN` | your bot token |

3. Click **Deploy** (top right) so the new secrets take effect.

## Step 5: Finish setup

1. Open your worker URL (from Step 2) and complete the short **/setup** screen
   (your name, timezone, email). It gives you a login.
2. In settings, set your connected accounts. Paste a small map of the platforms
   you connected in Zernio, for example:
   `{"instagram":{"accountId":"..."},"tiktok":{"accountId":"..."}}`
   into the `ZERNIO_ACCOUNTS` config field.

## Step 6: Pair Telegram + brand it

1. Open your bot in Telegram and send `/start` to pair it to you.
2. Send `/brand` and pick your fonts, colors, caption style, motion style, and
   thumbnail look. You get live previews.

## Step 7: Make your first reel 🎬

Record a short talking-head clip on your phone and send it to your bot. Pick
**Talking head → Captions + motion graphics**. In a few minutes you get a
finished reel with a caption and thumbnail. Tap **Publish now**, **Schedule**,
or **Add to queue**. That is it.

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
