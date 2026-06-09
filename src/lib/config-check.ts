import type { Env } from "../env";
import { checkLicense } from "./license";

/** Secrets required for the reel RENDER pipeline (cut -> captions -> b-roll ->
 *  thumbnail -> upload). Returns the human labels of anything missing. */
export function missingReelKeys(env: Env): string[] {
  const missing: string[] = [];
  if (!env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY (the editing + caption brain)");
  if (!env.GROQ_API_KEY) missing.push("GROQ_API_KEY (transcription)");
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    missing.push("R2 credentials (CLOUDFLARE_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY)");
  }
  return missing;
}

/** Plain-language Telegram message telling the buyer exactly what to set. */
export function reelConfigHint(missing: string[]): string {
  return (
    "⚠️ I can't render reels yet — these aren't set:\n• " +
    missing.join("\n• ") +
    "\n\nAdd them in Cloudflare → Workers & Pages → content-os → Settings → Variables and Secrets, then click Deploy. Send /status anytime to check."
  );
}

export interface ConfigStatus {
  keys: Record<string, boolean>;
  ready: boolean;
  missing: string[];
  licensed: boolean;
}

/** Booleans-only config snapshot (never leaks values) for /status + /api/health. */
export async function configStatus(env: Env): Promise<ConfigStatus> {
  const zernioAccounts = !!(await env.CONFIG.get("ZERNIO_ACCOUNTS").catch(() => null));
  const keys: Record<string, boolean> = {
    ANTHROPIC_API_KEY: !!env.ANTHROPIC_API_KEY,
    GROQ_API_KEY: !!env.GROQ_API_KEY,
    ZERNIO_API_KEY: !!env.ZERNIO_API_KEY,
    ZERNIO_ACCOUNTS: zernioAccounts,
    CLOUDFLARE_ACCOUNT_ID: !!env.CLOUDFLARE_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: !!env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: !!env.R2_SECRET_ACCESS_KEY,
    TELEGRAM_BOT_TOKEN: !!env.TELEGRAM_BOT_TOKEN,
    KIE_AI_API_KEY: !!env.KIE_AI_API_KEY,
    ELEVENLABS_API_KEY: !!env.ELEVENLABS_API_KEY,
  };
  const missing = missingReelKeys(env);
  const licensed = (await checkLicense(env)).valid;
  return { keys, ready: missing.length === 0, missing, licensed };
}

const REQUIRED = [
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "ZERNIO_API_KEY",
  "ZERNIO_ACCOUNTS",
  "CLOUDFLARE_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];
const OPTIONAL = ["TELEGRAM_BOT_TOKEN", "KIE_AI_API_KEY", "ELEVENLABS_API_KEY"];

/** HTML-formatted /status message for Telegram. */
export function statusMessage(s: ConfigStatus): string {
  const line = (k: string) => `${s.keys[k] ? "✅" : "❌"} ${k}`;
  return (
    "<b>Content OS status</b>\n\n" +
    `${s.licensed ? "✅" : "❌"} License (CONTENT_OS_LICENSE_KEY)\n\n` +
    "<b>Required</b>\n" +
    REQUIRED.map(line).join("\n") +
    "\n\n<b>Optional</b>\n" +
    OPTIONAL.map(line).join("\n") +
    "\n\n" +
    (!s.licensed
      ? "🔒 No active license — render/publish are locked. Get your key at 10xcontent.io, then set CONTENT_OS_LICENSE_KEY in Cloudflare → Settings → Variables."
      : s.ready
        ? "🟢 Render pipeline ready. (Publishing also needs ZERNIO_API_KEY + ZERNIO_ACCOUNTS.)"
        : "🔴 Not ready — set the ❌ required items in Cloudflare → Settings → Variables, then Deploy.")
  );
}
