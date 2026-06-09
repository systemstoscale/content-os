import type { Env } from "../env";

// Content OS is open-core: the code is public, so render/publish are gated on a
// license key (issued at 10xcontent.io on purchase). The key is validated against
// the funnel and the verdict cached in CONFIG KV so we don't call out every render
// and survive brief funnel downtime.
const FUNNEL = "https://10xcontent.io";
const CACHE_KEY = "LICENSE_STATUS";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // re-verify daily

interface Cached { valid: boolean; ts: number; keyHash: string }

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readKey(env: Env): Promise<string> {
  const fromEnv = (env.CONTENT_OS_LICENSE_KEY || "").trim();
  if (fromEnv) return fromEnv;
  try { return ((await env.CONFIG.get("CONTENT_OS_LICENSE_KEY")) || "").trim(); } catch { return ""; }
}

export interface LicenseResult { valid: boolean; reason?: string }

export async function checkLicense(env: Env): Promise<LicenseResult> {
  const key = await readKey(env);
  if (!key) {
    return { valid: false, reason: "No license key set. Buy at 10xcontent.io, then add CONTENT_OS_LICENSE_KEY in Cloudflare \u2192 Settings \u2192 Variables." };
  }
  const keyHash = await hashKey(key);
  // Fresh cache hit?
  try {
    const cached = (await env.CONFIG.get(CACHE_KEY, "json")) as Cached | null;
    if (cached && cached.keyHash === keyHash && Date.now() - cached.ts < CACHE_TTL_MS) {
      return { valid: cached.valid, reason: cached.valid ? undefined : "Your Content OS license isn't active (check 10xcontent.io)." };
    }
  } catch {}
  // Verify against the funnel.
  try {
    const res = await fetch(`${FUNNEL}/api/license/verify?key=${encodeURIComponent(key)}`);
    const d = (await res.json()) as { valid?: boolean };
    const valid = !!d.valid;
    try { await env.CONFIG.put(CACHE_KEY, JSON.stringify({ valid, ts: Date.now(), keyHash } satisfies Cached)); } catch {}
    return { valid, reason: valid ? undefined : "Your Content OS license isn't active (check 10xcontent.io)." };
  } catch {
    // Funnel unreachable \u2014 fall back to the last verdict for this key if we have one.
    try {
      const cached = (await env.CONFIG.get(CACHE_KEY, "json")) as Cached | null;
      if (cached && cached.keyHash === keyHash) return { valid: cached.valid };
    } catch {}
    return { valid: false, reason: "Couldn't reach the license server. Try again shortly." };
  }
}
