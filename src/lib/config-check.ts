import type { Env } from "../env";
import { checkLicense } from "./license";
import { hasCredential } from "./credentials";

/** Credentials required for the reel RENDER pipeline (cut -> captions -> b-roll ->
 *  thumbnail -> upload). Returns the human labels of anything missing.
 *  Reads via getCredential so CONFIG-KV (Deploy-button) installs count too. */
export async function missingReelKeys(env: Env): Promise<string[]> {
  const [anthropic, groq, acct, ak, sk] = await Promise.all([
    hasCredential(env, "ANTHROPIC_API_KEY"),
    hasCredential(env, "GROQ_API_KEY"),
    hasCredential(env, "CLOUDFLARE_ACCOUNT_ID"),
    hasCredential(env, "R2_ACCESS_KEY_ID"),
    hasCredential(env, "R2_SECRET_ACCESS_KEY"),
  ]);
  const missing: string[] = [];
  if (!anthropic) missing.push("ANTHROPIC_API_KEY (the editing + caption brain)");
  if (!groq) missing.push("GROQ_API_KEY (transcription)");
  if (!acct || !ak || !sk) {
    missing.push("R2 credentials (CLOUDFLARE_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY)");
  }
  return missing;
}

/** Plain-language Telegram message telling the buyer exactly what to set. */
export function reelConfigHint(missing: string[]): string {
  return (
    "⚠️ I can't render reels yet — these aren't set:\n• " +
    missing.join("\n• ") +
    "\n\nOpen your Content OS dashboard → Settings → API keys and paste them once. Send /status anytime to check."
  );
}

export interface ConfigStatus {
  keys: Record<string, boolean>;
  ready: boolean;
  missing: string[];
  licensed: boolean;
}

/** Booleans-only config snapshot (never leaks values) for /status + /api/health.
 *  Resolves every key via CONFIG-then-env so it reflects the in-app store. */
export async function configStatus(env: Env): Promise<ConfigStatus> {
  const [anthropic, groq, zernio, acct, ak, sk, telegram, kie, eleven, zernioAccounts] =
    await Promise.all([
      hasCredential(env, "ANTHROPIC_API_KEY"),
      hasCredential(env, "GROQ_API_KEY"),
      hasCredential(env, "ZERNIO_API_KEY"),
      hasCredential(env, "CLOUDFLARE_ACCOUNT_ID"),
      hasCredential(env, "R2_ACCESS_KEY_ID"),
      hasCredential(env, "R2_SECRET_ACCESS_KEY"),
      hasCredential(env, "TELEGRAM_BOT_TOKEN"),
      hasCredential(env, "KIE_AI_API_KEY"),
      hasCredential(env, "ELEVENLABS_API_KEY"),
      env.CONFIG.get("ZERNIO_ACCOUNTS").then((v) => !!v).catch(() => false),
    ]);
  const keys: Record<string, boolean> = {
    ANTHROPIC_API_KEY: anthropic,
    GROQ_API_KEY: groq,
    ZERNIO_API_KEY: zernio,
    ZERNIO_ACCOUNTS: zernioAccounts,
    CLOUDFLARE_ACCOUNT_ID: acct,
    R2_ACCESS_KEY_ID: ak,
    R2_SECRET_ACCESS_KEY: sk,
    TELEGRAM_BOT_TOKEN: telegram,
    KIE_AI_API_KEY: kie,
    ELEVENLABS_API_KEY: eleven,
  };
  const missing = await missingReelKeys(env);
  const licensed = (await checkLicense(env)).valid;
  return { keys, ready: missing.length === 0, missing, licensed };
}

// Render-pipeline requirements (these gate `ready`). ZERNIO_ACCOUNTS is NOT
// here on purpose: rendering must complete green without connected socials —
// publishing readiness is reported separately below as a non-blocking note.
const REQUIRED = [
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "ZERNIO_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];
const OPTIONAL = ["TELEGRAM_BOT_TOKEN", "KIE_AI_API_KEY", "ELEVENLABS_API_KEY"];

/** HTML-formatted /status message for Telegram. */
export function statusMessage(s: ConfigStatus): string {
  const line = (k: string) => `${s.keys[k] ? "✅" : "❌"} ${k}`;
  // Publishing readiness is separate from render readiness and NEVER blocks
  // setup: ZERNIO_ACCOUNTS auto-populates from the buyer's Zernio key once they
  // connect socials at zernio.com (on the first publish, if not before).
  const publishingLine = !s.keys["ZERNIO_API_KEY"]
    ? "❌ Publishing — add ZERNIO_API_KEY to enable"
    : s.keys["ZERNIO_ACCOUNTS"]
      ? "✅ Publishing — social accounts connected"
      : "⚠️ Publishing — connect your social accounts at zernio.com (they'll sync automatically)";
  return (
    "<b>Content OS status</b>\n\n" +
    `${s.licensed ? "✅" : "❌"} License (CONTENT_OS_LICENSE_KEY)\n\n` +
    "<b>Required</b>\n" +
    REQUIRED.map(line).join("\n") +
    "\n\n<b>Publishing</b>\n" +
    publishingLine +
    "\n\n<b>Optional</b>\n" +
    OPTIONAL.map(line).join("\n") +
    "\n\n" +
    (!s.licensed
      ? "🔒 No active license — render/publish are locked. Get your key at 10xcontent.io, then add it in your dashboard → Settings → API keys."
      : s.ready
        ? "🟢 Render pipeline ready."
        : "🔴 Not ready — add the ❌ required items in your dashboard → Settings → API keys.")
  );
}
