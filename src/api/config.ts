import type { Env } from "../env";
import { requireBearer, methodNotAllowed } from "./auth";

/** /api/config — view + edit safe-to-expose CONFIG KV values from the SPA.
 *
 *  The CONFIG namespace stores creator profile (CREATOR_NAME, timezone, …),
 *  channel IDs (META_AD_ACCOUNT_ID, META_PAGE_ID, ZERNIO_PROFILE_ID, …),
 *  and OAuth client IDs (META_APP_ID).
 *
 *  Today everything in this list requires `wrangler kv key put` from the
 *  operator's terminal — friction for non-technical founders. This API +
 *  the /settings/config UI move it into the browser, with per-key
 *  validation where useful (e.g. ping Meta to confirm an ad-account id
 *  before saving). */

const SAFE_KEYS = [
  "CREATOR_NAME",
  "CREATOR_TIMEZONE",
  "APPROVAL_EMAIL",
  "ZERNIO_PROFILE_ID",
  "YT_ACCOUNT_ID",
  "ELEVENLABS_DEFAULT_VOICE_ID",
  "TELEGRAM_CHAT_ID",
] as const;
type SafeKey = (typeof SAFE_KEYS)[number];

const KEY_META: Record<SafeKey, { label: string; hint: string }> = {
  CREATOR_NAME: { label: "Creator name", hint: "Used in agent prompts and email signatures." },
  CREATOR_TIMEZONE: { label: "Timezone (IANA)", hint: "e.g. America/New_York. Drives the 7am cron clock." },
  APPROVAL_EMAIL: { label: "Approval email", hint: "Where draft previews land." },
  ZERNIO_PROFILE_ID: { label: "Zernio profile ID", hint: "24-hex id from zernio.com/dashboard." },
  YT_ACCOUNT_ID: { label: "Zernio YouTube account ID", hint: "Specific YT channel inside your Zernio profile." },
  ELEVENLABS_DEFAULT_VOICE_ID: { label: "ElevenLabs voice ID", hint: "Cloned voice used by avatar reels (optional)." },
  TELEGRAM_CHAT_ID: { label: "Telegram chat ID", hint: "Optional override; bot otherwise auto-claims the first chat to DM it." },
};

export async function handleConfigApi(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  pathTail: string,
): Promise<Response> {
  const guard = await requireBearer(req, env);
  if (guard) return guard;

  if (pathTail === "" || pathTail === "/") {
    if (req.method !== "GET") return methodNotAllowed("GET");
    return listConfig(env);
  }

  // PUT /:key
  const segs = pathTail.replace(/^\//, "").split("/");
  const key = segs[0] as SafeKey | undefined;

  if (!key || !SAFE_KEYS.includes(key)) {
    return Response.json({ error: `unknown config key: ${key}` }, { status: 404 });
  }

  if (req.method !== "PUT") return methodNotAllowed("PUT");
  return putValue(env, key, req);
}

async function listConfig(env: Env): Promise<Response> {
  const values = await Promise.all(
    SAFE_KEYS.map(async (k) => ({
      key: k,
      value: (await env.CONFIG.get(k)) ?? null,
      label: KEY_META[k].label,
      hint: KEY_META[k].hint,
    })),
  );
  return Response.json({ values });
}

async function putValue(env: Env, key: SafeKey, req: Request): Promise<Response> {
  const body = await safeJson<{ value?: string }>(req);
  if (body?.value === undefined) {
    return Response.json({ error: "missing 'value'" }, { status: 400 });
  }
  const value = String(body.value).trim();
  // Empty = delete. Lets the user un-set things like ELEVENLABS_DEFAULT_VOICE_ID
  // they no longer want.
  if (value === "") {
    await env.CONFIG.delete(key);
    return Response.json({ ok: true, key, value: null });
  }
  await env.CONFIG.put(key, value);
  return Response.json({ ok: true, key, value });
}

async function safeJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}
