import type { Env } from "./env";

/** Creator profile resolver.
 *
 *  Used to be `[vars]` in wrangler.toml (operator pre-edited before deploy).
 *  Now the canonical store is CONFIG KV — values are captured by the /setup
 *  first-visit wizard and written to CONFIG. This helper centralises the
 *  lookup so call sites don't have to remember the precedence order, and
 *  provides safe defaults so the Worker never crashes on an unset value
 *  (a fresh Deploy-button install has none of these set until /setup runs).
 *
 *  Precedence:
 *    1. CONFIG KV (set by /setup wizard or `/settings/config` UI)
 *    2. env [vars] fallback — only for legacy operator-installed instances
 *       whose wrangler.toml still carries [vars]. New Deploy-button installs
 *       leave these empty.
 *    3. Type-safe default (empty string / safe fallback) — keeps the Worker
 *       running until /setup completes. */

export interface CreatorProfile {
  creator_name: string;
  creator_timezone: string;
  approval_email: string;
  zernio_profile_id: string;
  telegram_chat_id: string;
}

const FALLBACKS: CreatorProfile = {
  creator_name: "Content OS",
  creator_timezone: "UTC",
  approval_email: "",
  zernio_profile_id: "",
  telegram_chat_id: "",
};

/** Resolve a single field. Tries CONFIG first, then env, then fallback. */
export async function profileField<K extends keyof CreatorProfile>(
  env: Env,
  field: K,
): Promise<CreatorProfile[K]> {
  const configKey = field.toUpperCase();
  const configVal = await env.CONFIG.get(configKey);
  if (configVal) return configVal as CreatorProfile[K];
  const envVal = (env as unknown as Record<string, string | undefined>)[configKey];
  if (envVal) return envVal as CreatorProfile[K];
  return FALLBACKS[field];
}

/** Load all fields in parallel. Use when a caller needs multiple values
 *  — single round-trip to CONFIG instead of N sequential reads. */
export async function getProfile(env: Env): Promise<CreatorProfile> {
  const [
    creator_name,
    creator_timezone,
    approval_email,
    zernio_profile_id,
    telegram_chat_id,
  ] = await Promise.all([
    profileField(env, "creator_name"),
    profileField(env, "creator_timezone"),
    profileField(env, "approval_email"),
    profileField(env, "zernio_profile_id"),
    profileField(env, "telegram_chat_id"),
  ]);
  return {
    creator_name,
    creator_timezone,
    approval_email,
    zernio_profile_id,
    telegram_chat_id,
  };
}
