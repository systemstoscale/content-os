import type { Env } from "../env";
import { requireBearer, methodNotAllowed } from "./auth";
import { getDailySpend } from "../lib/cost-tracking";

/** /api/today — single-screen dashboard aggregator.
 *
 *  Returns count+preview cards for everything the buyer might need to act
 *  on right now, across the four Ps. Cards for surfaces that aren't yet
 *  populated (Prospecting / Dream 100 if those tables don't exist yet, or
 *  exist with zero rows) return zero counts cleanly — the UI surfaces a
 *  "Connect X" CTA when its corresponding integration key is missing. */
export async function handleTodayApi(
  req: Request,
  env: Env,
): Promise<Response> {
  const guard = await requireBearer(req, env);
  if (guard) return guard;
  if (req.method !== "GET") return methodNotAllowed("GET");

  const since24h = Date.now() - 24 * 60 * 60 * 1000;

  const [
    draftsPending,
    draftsPendingFirst,
    paidCampaigns24h,
    paidCampaignsPreview,
    prospectingPending,
    prospectingPreview,
    dreamTouchesDue,
    dreamTouchesPreview,
    dreamTargetsCount,
    apolloKey,
    instantlyKey,
    spend,
    recsPending,
    followupsDue,
    unmatchedCount,
    stalledCount,
    bookingsToday,
  ] = await Promise.all([
    countOrZero(env, `SELECT COUNT(*) AS c FROM drafts WHERE status = 'pending'`),
    listOrEmpty<{ id: string; format: string; caption: string }>(
      env,
      `SELECT id, format, caption FROM drafts WHERE status = 'pending'
       ORDER BY created_at DESC LIMIT 3`,
    ),
    countOrZero(
      env,
      `SELECT COUNT(*) AS c FROM campaigns WHERE channel = 'meta_ads' AND created_at >= ?`,
      [since24h],
    ),
    listOrEmpty<{ id: string; source_brief: string | null; external_id: string | null }>(
      env,
      `SELECT id, source_brief, external_id FROM campaigns
       WHERE channel = 'meta_ads' AND created_at >= ?
       ORDER BY created_at DESC LIMIT 3`,
      [since24h],
    ),
    // Prospecting + Dream 100 tables don't exist yet on a Phase-13-only
    // install — countOrZero swallows "no such table" so the dashboard
    // works regardless.
    countOrZero(
      env,
      `SELECT COUNT(*) AS c FROM conversations WHERE pending_draft IS NOT NULL`,
    ),
    listOrEmpty<{ id: string; last_inbound_text: string | null; pending_draft: string | null }>(
      env,
      `SELECT id, last_inbound_text, pending_draft FROM conversations
       WHERE pending_draft IS NOT NULL
       ORDER BY pending_draft_at DESC LIMIT 3`,
    ),
    countOrZero(
      env,
      `SELECT COUNT(*) AS c FROM dream_touches
       WHERE status = 'pending' AND scheduled_for <= ?`,
      [Date.now()],
    ),
    listOrEmpty<{ id: string; touch_type: string; name: string }>(
      env,
      `SELECT t.id, t.touch_type, dt.name
         FROM dream_touches t
         JOIN dream_targets dt ON dt.id = t.target_id
         WHERE t.status = 'pending' AND t.scheduled_for <= ?
         ORDER BY t.scheduled_for ASC LIMIT 3`,
      [Date.now()],
    ),
    countOrZero(env, `SELECT COUNT(*) AS c FROM dream_targets`),
    env.CONFIG.get("APOLLO_API_KEY"),
    env.CONFIG.get("INSTANTLY_API_KEY"),
    getDailySpend(env).catch(() => ({ spent_usd: 0, cap_usd: 25, pct: 0, over_cap: false })),
    // Cross-pillar "needs you now" counts (cockpit).
    countOrZero(env, `SELECT COUNT(*) AS c FROM ads_recommendations WHERE status = 'pending'`),
    countOrZero(env, `SELECT COUNT(*) AS c FROM follow_ups WHERE status = 'pending' AND due_at <= ?`, [Date.now()]),
    countOrZero(env, `SELECT COUNT(*) AS c FROM inbound_unmatched WHERE status = 'pending'`),
    countOrZero(env, `SELECT COUNT(*) AS c FROM conversations WHERE status = 'active' AND pending_draft IS NULL AND last_inbound_at IS NOT NULL AND last_inbound_at < ?`, [Date.now() - 3 * 86400000]),
    countOrZero(env, `SELECT COUNT(*) AS c FROM conversations WHERE status = 'booked' AND booked_at >= ?`, [since24h]),
  ]);

  const prospectingEnabled = !!apolloKey || !!instantlyKey || prospectingPending > 0;
  const dreamEnabled = dreamTargetsCount > 0 || dreamTouchesDue > 0;

  return Response.json({
    drafts: {
      pending_count: draftsPending,
      preview: draftsPendingFirst,
    },
    paid: {
      campaigns_24h: paidCampaigns24h,
      preview: paidCampaignsPreview,
    },
    prospecting: {
      replies_pending: prospectingPending,
      preview: prospectingPreview,
      enabled: prospectingEnabled,
    },
    dream_100: {
      touches_due: dreamTouchesDue,
      targets_count: dreamTargetsCount,
      preview: dreamTouchesPreview,
      enabled: dreamEnabled,
    },
    spend,
    // Cross-pillar action strip — the "what needs me right now" cockpit.
    actions: {
      recs_pending: recsPending,
      followups_due: followupsDue,
      unmatched: unmatchedCount,
      stalled: stalledCount,
      bookings_today: bookingsToday,
    },
  });
}

async function countOrZero(
  env: Env,
  sql: string,
  binds: unknown[] = [],
): Promise<number> {
  try {
    const stmt = env.DB.prepare(sql);
    const bound = binds.length > 0 ? stmt.bind(...binds) : stmt;
    const row = await bound.first<{ c: number }>();
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

async function listOrEmpty<T extends Record<string, unknown>>(
  env: Env,
  sql: string,
  binds: unknown[] = [],
): Promise<T[]> {
  try {
    const stmt = env.DB.prepare(sql);
    const bound = binds.length > 0 ? stmt.bind(...binds) : stmt;
    const rs = await bound.all<T>();
    return rs.results ?? [];
  } catch {
    return [];
  }
}
