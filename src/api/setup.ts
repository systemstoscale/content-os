import type { Env } from "../env";
import { hashPassword } from "../lib/password";
import { methodNotAllowed, requireAuth } from "./auth";
import { getCredential, hasCredential, REQUIRED_CREDENTIALS, type CredentialKey } from "../lib/credentials";
import { checkLicense } from "../lib/license";

/** /api/setup/* — Deploy-button first-run onboarding.
 *
 *  A fresh Deploy-button install has an empty `users` table and no API keys —
 *  the buyer never touched the Cloudflare dashboard. The SPA wizard captures
 *  EVERYTHING in-app and POSTs `/api/setup/complete`, which atomically:
 *    - inserts the admin user with the buyer's OWN password (no generated one
 *      to lose; must_change_password = 0)
 *    - stores every API key in CONFIG KV (Workers can't set their own secrets,
 *      so KV is the in-app store — read back via lib/credentials.getCredential)
 *    - seeds the creator profile + a bearer token in CONFIG
 *    - registers the Telegram webhook from the supplied bot token
 *    - validates the license against 10xcontent.io (non-blocking)
 *
 *  `/telegram-webhook` (re)registers the webhook later; `/telegram-status`
 *  reports token/webhook/owner state so the wizard can confirm "/start" live. */

export interface SetupStatus {
  setup_complete: boolean;
  worker_url: string;
  /** Required credentials still missing — lets a half-finished install resume. */
  missing: string[];
}

// Wizard field (snake_case) → canonical credential key stored in CONFIG.
const KEY_FIELDS: Record<string, CredentialKey> = {
  anthropic_api_key: "ANTHROPIC_API_KEY",
  groq_api_key: "GROQ_API_KEY",
  zernio_api_key: "ZERNIO_API_KEY",
  zernio_profile_id: "ZERNIO_PROFILE_ID",
  cloudflare_account_id: "CLOUDFLARE_ACCOUNT_ID",
  r2_access_key_id: "R2_ACCESS_KEY_ID",
  r2_secret_access_key: "R2_SECRET_ACCESS_KEY",
  r2_bucket_name: "R2_BUCKET_NAME",
  content_os_license_key: "CONTENT_OS_LICENSE_KEY",
  kie_ai_api_key: "KIE_AI_API_KEY",
  elevenlabs_api_key: "ELEVENLABS_API_KEY",
  telegram_bot_token: "TELEGRAM_BOT_TOKEN",
};

const MIN_PASSWORD_LEN = 12;

export async function handleSetupApi(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  pathTail: string,
): Promise<Response> {
  switch (pathTail) {
    case "/status":
      return req.method === "GET" ? status(req, env) : methodNotAllowed("GET");
    case "/complete":
      return req.method === "POST" ? complete(req, env) : methodNotAllowed("POST");
    case "/telegram-webhook":
      return req.method === "POST" ? telegramWebhook(req, env) : methodNotAllowed("POST");
    case "/telegram-status":
      return req.method === "GET" ? telegramStatus(req, env) : methodNotAllowed("GET");
    default:
      return Response.json({ error: "unknown setup route" }, { status: 404 });
  }
}

async function isSetupComplete(env: Env): Promise<boolean> {
  try {
    const row = await env.DB.prepare(`SELECT COUNT(*) as c FROM users`).first<{ c: number }>();
    return (row?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Before setup, the bootstrap endpoints are open (the instance is unclaimed);
 *  after setup, they require a valid session/bearer. Returns a 401 Response to
 *  return as-is, or null when the caller may proceed. */
async function gateBootstrap(req: Request, env: Env): Promise<Response | null> {
  if (!(await isSetupComplete(env))) return null;
  const auth = await requireAuth(req, env);
  return auth instanceof Response ? auth : null;
}

/** Anyone can call /api/setup/status — it's the routing signal the SPA uses
 *  pre-auth to decide /login vs /setup, plus what's left to finish. */
async function status(req: Request, env: Env): Promise<Response> {
  const setup_complete = await isSetupComplete(env);
  let missing: string[] = [];
  try {
    const present = await Promise.all(REQUIRED_CREDENTIALS.map((k) => hasCredential(env, k)));
    missing = REQUIRED_CREDENTIALS.filter((_, i) => !present[i]);
  } catch {
    missing = [];
  }
  return Response.json({
    setup_complete,
    worker_url: new URL(req.url).origin,
    missing,
  } satisfies SetupStatus);
}

interface SetupInput {
  email?: string;
  password?: string;
  creator_name?: string;
  creator_timezone?: string;
  yt_account_id?: string;
  meta_app_id?: string;
  meta_ad_account_id?: string;
  meta_page_id?: string;
  telegram_chat_id?: string;
  // API keys (snake_case → KEY_FIELDS)
  anthropic_api_key?: string;
  groq_api_key?: string;
  zernio_api_key?: string;
  zernio_profile_id?: string;
  cloudflare_account_id?: string;
  r2_access_key_id?: string;
  r2_secret_access_key?: string;
  r2_bucket_name?: string;
  content_os_license_key?: string;
  kie_ai_api_key?: string;
  elevenlabs_api_key?: string;
  telegram_bot_token?: string;
}

interface SetupOutput {
  ok: boolean;
  email?: string;
  bearer_token?: string;
  worker_url?: string;
  telegram_registered?: boolean;
  license_valid?: boolean;
  license_reason?: string;
  error?: string;
  missing?: string[];
}

/** Complete the setup. ONE-SHOT: refuses if `users` already has rows. */
async function complete(req: Request, env: Env): Promise<Response> {
  if (await isSetupComplete(env)) {
    return Response.json(
      { ok: false, error: "setup already complete; sign in instead" } satisfies SetupOutput,
      { status: 409 },
    );
  }

  const body = (await safeJson<SetupInput>(req)) ?? {};
  if (!body.email?.trim() || !body.creator_name?.trim()) {
    return Response.json(
      { ok: false, error: "email and creator_name are required" } satisfies SetupOutput,
      { status: 400 },
    );
  }
  const password = (body.password ?? "").trim();
  if (password.length < MIN_PASSWORD_LEN) {
    return Response.json(
      { ok: false, error: `password must be at least ${MIN_PASSWORD_LEN} characters` } satisfies SetupOutput,
      { status: 400 },
    );
  }
  const email = body.email.trim().toLowerCase();

  // Validate the required API keys are all present in the submission.
  const missing: string[] = [];
  for (const [field, key] of Object.entries(KEY_FIELDS)) {
    if (REQUIRED_CREDENTIALS.includes(key)) {
      const v = (body[field as keyof SetupInput] as string | undefined)?.trim();
      if (!v) missing.push(field);
    }
  }
  if (missing.length) {
    return Response.json(
      { ok: false, error: `missing required keys: ${missing.join(", ")}`, missing } satisfies SetupOutput,
      { status: 400 },
    );
  }

  // The buyer chose their own password — no forced change on first login.
  const hash = await hashPassword(password);
  const bearerToken = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const workerUrl = new URL(req.url).origin;

  await env.DB.prepare(
    `INSERT INTO users (email, password_hash, password_salt, password_iters, role, must_change_password, created_at)
     VALUES (?, ?, ?, ?, 'admin', 0, ?)`,
  )
    .bind(email, hash.hash, hash.salt, hash.iters, now)
    .run();

  // Store every supplied API key in CONFIG KV (the in-app secret store).
  const keyPuts: Promise<void>[] = [];
  for (const [field, key] of Object.entries(KEY_FIELDS)) {
    const v = (body[field as keyof SetupInput] as string | undefined)?.trim();
    if (v) keyPuts.push(env.CONFIG.put(key, v));
  }

  // Seed the creator profile + bearer token (read via src/profile.ts).
  await Promise.all([
    ...keyPuts,
    env.CONFIG.put("CREATOR_NAME", body.creator_name.trim()),
    env.CONFIG.put("CREATOR_TIMEZONE", (body.creator_timezone || "UTC").trim()),
    env.CONFIG.put("APPROVAL_EMAIL", email),
    env.CONFIG.put("WORKER_URL", workerUrl),
    env.CONFIG.put("CONTENT_OS_API_TOKEN", bearerToken),
    body.yt_account_id ? env.CONFIG.put("YT_ACCOUNT_ID", body.yt_account_id.trim()) : Promise.resolve(),
    body.meta_app_id ? env.CONFIG.put("META_APP_ID", body.meta_app_id.trim()) : Promise.resolve(),
    body.meta_ad_account_id ? env.CONFIG.put("META_AD_ACCOUNT_ID", body.meta_ad_account_id.trim()) : Promise.resolve(),
    body.meta_page_id ? env.CONFIG.put("META_PAGE_ID", body.meta_page_id.trim()) : Promise.resolve(),
    body.telegram_chat_id ? env.CONFIG.put("TELEGRAM_CHAT_ID", body.telegram_chat_id.trim()) : Promise.resolve(),
  ]);

  // Register the Telegram webhook now that the token is stored.
  let telegram_registered = false;
  if (body.telegram_bot_token?.trim()) {
    telegram_registered = (await registerTelegramWebhook(env, workerUrl)).ok;
  }

  // Validate the license (non-blocking — let them into the dashboard to fix it).
  let license_valid = false;
  let license_reason: string | undefined;
  try {
    const lic = await checkLicense(env);
    license_valid = lic.valid;
    license_reason = lic.reason;
  } catch {
    license_reason = "Couldn't verify the license right now; you can re-check from Settings.";
  }

  return Response.json({
    ok: true,
    email,
    bearer_token: bearerToken,
    worker_url: workerUrl,
    telegram_registered,
    license_valid,
    license_reason,
  } satisfies SetupOutput);
}

/** Register (or re-register) the Telegram webhook against this Worker's URL,
 *  using the bot token from CONFIG/env. Reused by the wizard, the Settings
 *  "Connect Telegram" card, and the /complete flow. */
export async function registerTelegramWebhook(
  env: Env,
  workerUrl?: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = await getCredential(env, "TELEGRAM_BOT_TOKEN");
  if (!token) return { ok: false, error: "no Telegram bot token set" };
  const base = (workerUrl || (await env.CONFIG.get("WORKER_URL")) || "").replace(/\/+$/, "");
  if (!base) return { ok: false, error: "worker URL unknown" };
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(`${base}/trigger/telegram`)}`,
    );
    const d = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    return { ok: !!d.ok, error: d.ok ? undefined : d.description || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 160) };
  }
}

/** POST /api/setup/telegram-webhook — store an (optional) supplied token then
 *  (re)register the webhook. Open pre-setup; authed after. */
async function telegramWebhook(req: Request, env: Env): Promise<Response> {
  const guard = await gateBootstrap(req, env);
  if (guard) return guard;
  const body = (await safeJson<{ telegram_bot_token?: string }>(req)) ?? {};
  if (body.telegram_bot_token?.trim()) {
    await env.CONFIG.put("TELEGRAM_BOT_TOKEN", body.telegram_bot_token.trim());
  }
  const result = await registerTelegramWebhook(env, new URL(req.url).origin);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

/** GET /api/setup/telegram-status — { token_set, webhook_registered, owner_linked }
 *  so the wizard can show a live "✅ /start received". */
async function telegramStatus(req: Request, env: Env): Promise<Response> {
  const guard = await gateBootstrap(req, env);
  if (guard) return guard;
  const token = await getCredential(env, "TELEGRAM_BOT_TOKEN");
  const token_set = !!token;

  let webhook_registered = false;
  if (token_set) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const d = (await res.json().catch(() => ({}))) as { result?: { url?: string } };
      webhook_registered = !!d.result?.url && d.result.url.includes("/trigger/telegram");
    } catch {
      webhook_registered = false;
    }
  }

  let owner_linked = false;
  try {
    const row = await env.DB.prepare(`SELECT 1 FROM tg_owner WHERE id = 1`).first();
    owner_linked = !!row;
  } catch {
    owner_linked = false;
  }

  return Response.json({ token_set, webhook_registered, owner_linked });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function safeJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}
