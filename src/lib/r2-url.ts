import type { Env } from "../env";

/** Absolute public URL for an R2 object served by this Worker's /r2/ route.
 *
 *  The base is CONFIG.WORKER_URL (seeded by install.sh / the /setup wizard),
 *  with R2_PUBLIC_BASE as an override for installs fronted by a custom domain.
 *  Returns a relative "/r2/<key>" only if neither is set — callers that hand
 *  the URL to an external service (Zernio, the container) require the base, so
 *  this should always be configured before the reel pipeline runs. */
export async function r2PublicUrl(env: Env, key: string): Promise<string> {
  const base =
    (await env.CONFIG.get("R2_PUBLIC_BASE")) || (await env.CONFIG.get("WORKER_URL")) || "";
  const cleanKey = key.replace(/^\/+/, "");
  if (base) return `${base.replace(/\/+$/, "")}/r2/${cleanKey}`;
  return `/r2/${cleanKey}`;
}
