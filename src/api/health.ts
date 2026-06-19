import type { Env } from "../env";
import { requireBearer } from "./auth";
import { getCredential } from "../lib/credentials";
import { getProfile } from "../profile";

/** /api/health-full — surfaces every binding's health. The SPA dashboard
 *  polls this so the creator can spot a broken binding at a glance.
 *
 *  Distinct from /health (no auth, JSON only — pinged by uptime monitors). */
export async function handleHealthFull(req: Request, env: Env): Promise<Response> {
  const guard = await requireBearer(req, env);
  if (guard) return guard;

  const bindings: Record<string, "ok" | "missing" | "error"> = {
    DB: "missing",
    ASSETS: "missing",
    CONFIG: "missing",
    BROWSER: "missing",
    AI: "missing",
    PROCESSOR: "missing",
    ASSETS_STATIC: "missing",
    // Auth probe: confirms at least one row exists in `users`. A fresh
    // install with a stale schema.sql would skip the users table CREATE
    // and silently fail to seed a user — this surfaces that broken state.
    AUTH: "missing",
  };

  // Lightweight pokes — each catches its own error so one missing binding
  // doesn't tank the whole health response.
  try {
    await env.DB.prepare("SELECT 1").first();
    bindings.DB = "ok";
  } catch {
    bindings.DB = "error";
  }
  try {
    const head = await env.ASSETS.head("uploads/iphone-1965-vert.mp4");
    bindings.ASSETS = head ? "ok" : "ok"; // bucket reachable either way
  } catch {
    bindings.ASSETS = "error";
  }
  try {
    await env.CONFIG.get("CREATOR_NAME");
    bindings.CONFIG = "ok";
  } catch {
    bindings.CONFIG = "error";
  }
  bindings.BROWSER = env.BROWSER ? "ok" : "missing";
  bindings.AI = env.AI ? "ok" : "missing";
  bindings.PROCESSOR = env.PROCESSOR ? "ok" : "missing";
  bindings.ASSETS_STATIC = env.ASSETS_STATIC ? "ok" : "missing";

  // AUTH probe — must come after DB is verified ok, otherwise we double-report
  // the DB issue.
  if (bindings.DB === "ok") {
    try {
      const userCount = await env.DB.prepare(`SELECT COUNT(*) as c FROM users`).first<{ c: number }>();
      bindings.AUTH = (userCount?.c ?? 0) > 0 ? "ok" : "error";
    } catch {
      // Most likely the users table doesn't exist (stale schema.sql, broken install).
      bindings.AUTH = "error";
    }
  } else {
    bindings.AUTH = "error";
  }

  // Surface the safe-to-display CONFIG KV values so the Health page can
  // render them as a read-only table. Editable from /settings/config later.
  const CONFIG_KEYS = [
    "CREATOR_NAME",
    "CREATOR_TIMEZONE",
    "APPROVAL_EMAIL",
    "ZERNIO_PROFILE_ID",
    "YT_ACCOUNT_ID",
    "ELEVENLABS_DEFAULT_VOICE_ID",
    "TELEGRAM_CHAT_ID",
    // Per-buyer media generation (KIE.AI) — set at /setup so each creator
    // customises their own look, headshot, and model choices.
    "CREATOR_LOOK",
    "SOUL_REFERENCE_URL",
    "KIE_IMAGE_MODEL",
    "KIE_AVATAR_MODEL",
    "KIE_AVATAR_RESOLUTION",
    "BRAND_ASPECT",
  ];
  const configValues = await Promise.all(
    CONFIG_KEYS.map(async (k) => ({ key: k, value: (await env.CONFIG.get(k)) ?? null })),
  );

  // Last cron run = most-recent session row with source='cron'. Next cron
  // run is derived client-side from the schedule string; we just expose it
  // here so the UI has a single source of truth.
  const lastCron = await env.DB.prepare(
    `SELECT created_at, outcome IS NOT NULL as completed, error
     FROM sessions WHERE source = 'cron' ORDER BY created_at DESC LIMIT 1`,
  ).first<{ created_at: number; completed: number; error: string | null }>();

  // Recent 20 sessions of any source — drives the activity table.
  const recentSessions = await env.DB.prepare(
    `SELECT id, created_at, source, tool_calls, error,
            CASE WHEN outcome IS NULL THEN 0 ELSE 1 END as completed,
            substr(intent, 1, 120) as intent_preview
     FROM sessions ORDER BY created_at DESC LIMIT 20`,
  ).all<{
    id: string;
    created_at: number;
    source: string;
    tool_calls: number;
    error: string | null;
    completed: number;
    intent_preview: string;
  }>();

  // Telegram: needs a bot token + a linked owner chat (a tg_owner row from
  // the founder hitting /start, or a TELEGRAM_CHAT_ID override in CONFIG).
  let telegram: "ok" | "missing" | "error" = "missing";
  const telegramBotToken = await getCredential(env, "TELEGRAM_BOT_TOKEN");
  if (telegramBotToken) {
    const owner = await env.DB.prepare(`SELECT chat_id FROM tg_owner WHERE id = 1`)
      .first<{ chat_id: number }>()
      .catch(() => null);
    const chatCfg = await env.CONFIG.get("TELEGRAM_CHAT_ID");
    telegram = owner?.chat_id || chatCfg ? "ok" : "error";
  }

  const profile = await getProfile(env);
  return Response.json({
    ok: Object.values(bindings).every((v) => v === "ok"),
    creator: profile.creator_name,
    timezone: profile.creator_timezone,
    bindings,
    telegram,
    // Media generation runs entirely on KIE.AI (single API key, no OAuth).
    media: {
      kie: (await getCredential(env, "KIE_AI_API_KEY")) ? "ok" : "missing",
      elevenlabs: (await getCredential(env, "ELEVENLABS_API_KEY")) ? "ok" : "missing",
    },
    config: configValues,
    cron: {
      schedule_utc: "0 7 * * *", // mirrors wrangler.toml [triggers] crons[]
      last_run_at: lastCron?.created_at ?? null,
      last_run_completed: lastCron?.completed === 1,
      last_run_error: lastCron?.error ?? null,
    },
    recent_sessions: (recentSessions.results ?? []).map((s) => ({
      id: s.id,
      created_at: s.created_at,
      source: s.source,
      tool_calls: s.tool_calls,
      error: s.error,
      completed: s.completed === 1,
      intent_preview: s.intent_preview,
    })),
  });
}
