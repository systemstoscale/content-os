import type { Env } from "../env";

/** Credential resolver for Content OS.
 *
 *  Deploy-button installs can't set Worker secrets from inside the Worker, so
 *  the /setup wizard writes every API key into CONFIG KV (in the buyer's own
 *  Cloudflare account). Operator installs (install.sh) still set real Worker
 *  secrets. This helper centralises the precedence so call sites don't care
 *  which mechanism a given install used:
 *
 *    1. CONFIG KV   (set by the /setup wizard or /settings) — Deploy-button installs
 *    2. env secret  (wrangler secret put)                   — operator installs
 *    3. fallback    (default / "")
 *
 *  Every key is stored + read under its canonical UPPER_SNAKE name — the same
 *  name used as the env secret (e.g. ANTHROPIC_API_KEY) — so CONFIG and env are
 *  interchangeable. This generalises the pattern already used for
 *  CONTENT_OS_LICENSE_KEY (lib/license.ts), CONTENT_OS_API_TOKEN (api/auth.ts)
 *  and ZERNIO_PROFILE_ID (tools/zernio.ts). */

export type CredentialKey =
  | "ANTHROPIC_API_KEY"
  | "GROQ_API_KEY"
  | "ZERNIO_API_KEY"
  | "ZERNIO_PROFILE_ID"
  | "CLOUDFLARE_ACCOUNT_ID"
  | "R2_ACCESS_KEY_ID"
  | "R2_SECRET_ACCESS_KEY"
  | "R2_BUCKET_NAME"
  | "CONTENT_OS_LICENSE_KEY"
  | "TELEGRAM_BOT_TOKEN"
  | "KIE_AI_API_KEY"
  | "ELEVENLABS_API_KEY";

/** Required for a working render + publish pipeline — the /setup wizard blocks
 *  completion until all are present. */
export const REQUIRED_CREDENTIALS: CredentialKey[] = [
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "ZERNIO_API_KEY",
  "ZERNIO_PROFILE_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "CONTENT_OS_LICENSE_KEY",
];

/** Optional — unlock extra features (Telegram control surface, AI media, TTS).
 *  R2_BUCKET_NAME is NOT collected at setup: the Deploy button always provisions
 *  the literal `content-os-assets` bucket (the ASSETS binding in
 *  wrangler.deploy.jsonc is a fixed name, not templated to the project), and the
 *  container defaults to that. It stays here only as an advanced manual override
 *  (e.g. operator/CLI installs that bind a differently-named bucket). */
export const OPTIONAL_CREDENTIALS: CredentialKey[] = [
  "TELEGRAM_BOT_TOKEN",
  "KIE_AI_API_KEY",
  "ELEVENLABS_API_KEY",
  "R2_BUCKET_NAME",
];

/** Resolve one credential: CONFIG KV first, then env secret/var, then fallback. */
export async function getCredential(env: Env, key: CredentialKey, fallback = ""): Promise<string> {
  try {
    const fromConfig = await env.CONFIG.get(key);
    if (fromConfig) return fromConfig;
  } catch {
    // CONFIG unreachable (rare) — fall through to env.
  }
  const fromEnv = (env as unknown as Record<string, string | undefined>)[key];
  return fromEnv || fallback;
}

/** True iff the credential resolves to a non-empty value (CONFIG or env). */
export async function hasCredential(env: Env, key: CredentialKey): Promise<boolean> {
  return (await getCredential(env, key)).trim().length > 0;
}

/** Resolve many credentials in one parallel pass. */
export async function getCredentials<K extends CredentialKey>(
  env: Env,
  keys: readonly K[],
): Promise<Record<K, string>> {
  const vals = await Promise.all(keys.map((k) => getCredential(env, k)));
  return Object.fromEntries(keys.map((k, i) => [k, vals[i]])) as Record<K, string>;
}
