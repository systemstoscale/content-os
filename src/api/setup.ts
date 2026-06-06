import type { Env } from "../env";
import { hashPassword } from "../lib/password";
import { methodNotAllowed } from "./auth";

/** /api/setup/* — Deploy-button first-visit bootstrap.
 *
 *  A fresh Deploy-button install has an empty `users` table — no operator
 *  has run `install.sh` to seed it. The SPA detects this state via
 *  `GET /api/setup/status` and routes the visitor to `/setup` instead of
 *  `/login`. The wizard then POSTs `/api/setup/complete` which atomically:
 *
 *    - inserts the admin user row (with hashed initial password)
 *    - seeds CONFIG KV from the form values
 *    - generates CONTENT_OS_API_TOKEN (writes to CONFIG for read access
 *      by /trigger/* — we can't write Worker secrets from inside a Worker)
 *    - self-detects WORKER_URL from request.url and persists to CONFIG
 *
 *  After this completes the visitor can immediately log in with the
 *  printed password and use the system. */

export interface SetupStatus {
  setup_complete: boolean;
  worker_url: string;
}

export async function handleSetupApi(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  pathTail: string,
): Promise<Response> {
  if (pathTail === "/status") {
    if (req.method !== "GET") return methodNotAllowed("GET");
    return status(req, env);
  }
  if (pathTail === "/complete") {
    if (req.method !== "POST") return methodNotAllowed("POST");
    return complete(req, env);
  }
  return Response.json({ error: "unknown setup route" }, { status: 404 });
}

/** Anyone can call /api/setup/status — it's the routing signal the SPA uses
 *  pre-auth to decide whether to show /login or /setup. */
async function status(req: Request, env: Env): Promise<Response> {
  let setup_complete = false;
  try {
    const row = await env.DB.prepare(`SELECT COUNT(*) as c FROM users`).first<{ c: number }>();
    setup_complete = (row?.c ?? 0) > 0;
  } catch {
    // users table doesn't exist — migrations haven't been applied yet (rare
    // edge case where the first request races the migration runner).
    setup_complete = false;
  }
  return Response.json({
    setup_complete,
    worker_url: new URL(req.url).origin,
  } satisfies SetupStatus);
}

interface SetupInput {
  email?: string;
  creator_name?: string;
  creator_timezone?: string;
  zernio_profile_id?: string;
  yt_account_id?: string;
  meta_app_id?: string;
  meta_ad_account_id?: string;
  meta_page_id?: string;
  telegram_chat_id?: string;
}

interface SetupOutput {
  ok: boolean;
  email?: string;
  initial_password?: string;
  bearer_token?: string;
  worker_url?: string;
  error?: string;
}

/** Complete the setup. ONE-SHOT: the endpoint refuses if `users` already
 *  has rows (so a curious unauth visitor can't blow away an existing
 *  install by POSTing). */
async function complete(req: Request, env: Env): Promise<Response> {
  // Re-check the gate atomically — between status() and complete() somebody
  // could already have run setup. We won't second-seed.
  const existing = await env.DB.prepare(`SELECT COUNT(*) as c FROM users`)
    .first<{ c: number }>()
    .catch(() => ({ c: 0 }));
  if ((existing?.c ?? 0) > 0) {
    return Response.json(
      { ok: false, error: "setup already complete; sign in instead" } satisfies SetupOutput,
      { status: 409 },
    );
  }

  const body = await safeJson<SetupInput>(req);
  if (!body?.email?.trim() || !body?.creator_name?.trim()) {
    return Response.json(
      { ok: false, error: "email and creator_name are required" } satisfies SetupOutput,
      { status: 400 },
    );
  }
  const email = body.email.trim().toLowerCase();

  // Generate a memorable initial password (same diceware-style as install.sh).
  const initialPassword = generateMemorablePassword();
  const hash = await hashPassword(initialPassword);

  // Generate an auto-rotated Bearer token (replaces the install.sh secret).
  // Stored in CONFIG so /trigger/* can read it; we can't write Worker secrets
  // from inside a Worker. The Bearer auth path falls back to CONFIG when the
  // env.CONTENT_OS_API_TOKEN secret isn't set (Deploy-button installs).
  const bearerToken = toHex(crypto.getRandomValues(new Uint8Array(32)));

  const now = Date.now();
  const workerUrl = new URL(req.url).origin;

  // Single batched D1 insert + a parallel KV seed.
  await env.DB.prepare(
    `INSERT INTO users (email, password_hash, password_salt, password_iters, role, must_change_password, created_at)
     VALUES (?, ?, ?, ?, 'admin', 1, ?)`,
  )
    .bind(email, hash.hash, hash.salt, hash.iters, now)
    .run();

  await Promise.all([
    env.CONFIG.put("CREATOR_NAME", body.creator_name.trim()),
    env.CONFIG.put("CREATOR_TIMEZONE", (body.creator_timezone || "UTC").trim()),
    env.CONFIG.put("APPROVAL_EMAIL", email),
    env.CONFIG.put("WORKER_URL", workerUrl),
    env.CONFIG.put("CONTENT_OS_API_TOKEN", bearerToken),
    body.zernio_profile_id ? env.CONFIG.put("ZERNIO_PROFILE_ID", body.zernio_profile_id.trim()) : Promise.resolve(),
    body.yt_account_id ? env.CONFIG.put("YT_ACCOUNT_ID", body.yt_account_id.trim()) : Promise.resolve(),
    body.meta_app_id ? env.CONFIG.put("META_APP_ID", body.meta_app_id.trim()) : Promise.resolve(),
    body.meta_ad_account_id ? env.CONFIG.put("META_AD_ACCOUNT_ID", body.meta_ad_account_id.trim()) : Promise.resolve(),
    body.meta_page_id ? env.CONFIG.put("META_PAGE_ID", body.meta_page_id.trim()) : Promise.resolve(),
    body.telegram_chat_id ? env.CONFIG.put("TELEGRAM_CHAT_ID", body.telegram_chat_id.trim()) : Promise.resolve(),
  ]);

  // Auto-register the Telegram webhook against this Worker URL. Without
  // this, the student would have to manually curl Telegram's setWebhook
  // endpoint after install — exactly the kind of friction the Deploy
  // button is meant to remove. Failure here is non-fatal (user can re-run
  // later from /settings).
  if (env.TELEGRAM_BOT_TOKEN) {
    try {
      await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(
          `${workerUrl}/trigger/telegram`,
        )}`,
      );
    } catch {
      // Bot token might be wrong / Telegram unreachable; non-fatal.
    }
  }

  return Response.json({
    ok: true,
    email,
    initial_password: initialPassword,
    bearer_token: bearerToken,
    worker_url: workerUrl,
  } satisfies SetupOutput);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WORDS = [
  "amber", "arctic", "aspen", "birch", "breeze", "bronze", "cedar", "clever",
  "cobalt", "coral", "cosmic", "crystal", "dawn", "delta", "dune", "ember",
  "falcon", "fern", "flux", "forest", "forge", "gale", "glade", "gravel",
  "haven", "horizon", "hunter", "ivory", "jade", "lake", "lichen", "lumen",
  "marble", "meadow", "moss", "nebula", "nova", "oak", "orbit", "otter",
  "peak", "pine", "quartz", "raven", "river", "rune", "sable", "sage",
  "solar", "spark", "spruce", "stone", "storm", "summit", "thicket", "tide",
  "totem", "tundra", "umber", "valley", "velvet", "vortex", "willow", "zenith",
];

function generateMemorablePassword(): string {
  const pick = () => WORDS[crypto.getRandomValues(new Uint32Array(1))[0]! % WORDS.length]!;
  const digits = (crypto.getRandomValues(new Uint16Array(1))[0]! % 9000) + 1000;
  return `${pick()}-${pick()}-${pick()}-${digits}`;
}

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
