import type { Env } from "./env";
import type { ZernioPlatform } from "./tools/zernio";

export type DraftFormat =
  | "carousel"
  | "quote_post"
  | "single_image"
  | "thumbnail"
  | "reel"
  | "youtube"
  | "meta_ads"
  | "text_post";
export type DraftStatus = "pending" | "approved" | "published" | "rejected" | "failed";

export interface YouTubeMetadata {
  zernio_account_id: string;
  titles: string[];
  description: string;
  chapters: Array<{ start_seconds: number; label: string }>;
  tags: string[];
  category?: string;
  visibility?: "public" | "unlisted" | "private";
  thumbnail_urls: string[];
  video_url: string;
}

export interface DraftPayload {
  asset_urls: string[];
  platforms: ZernioPlatform[];
  thumbnail_url?: string;
  scheduled_for?: string;
  youtube?: YouTubeMetadata;
}

export interface DraftRow {
  id: string;
  created_at: number;
  source: string;
  status: DraftStatus;
  format: DraftFormat;
  caption: string;
  pillar: string | null;
  payload: DraftPayload;
  published_at: number | null;
  zernio_post_id: string | null;
}

export async function insertDraft(
  env: Env,
  row: Omit<DraftRow, "created_at" | "published_at" | "zernio_post_id" | "status"> & {
    status?: DraftStatus;
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO drafts
       (id, created_at, source, status, format, caption, pillar, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id,
      Date.now(),
      row.source,
      row.status ?? "pending",
      row.format,
      row.caption,
      row.pillar,
      JSON.stringify(row.payload)
    )
    .run();
}

export async function getDraft(env: Env, id: string): Promise<DraftRow | null> {
  const row = await env.DB.prepare(`SELECT * FROM drafts WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? toDraftRow(row) : null;
}

export async function latestPendingDraft(env: Env): Promise<DraftRow | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM drafts WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`
  ).first<Record<string, unknown>>();
  return row ? toDraftRow(row) : null;
}

export async function markDraftPublished(
  env: Env,
  id: string,
  zernioPostId: string | undefined
): Promise<void> {
  await env.DB.prepare(
    `UPDATE drafts SET status = 'published', published_at = ?, zernio_post_id = ? WHERE id = ?`
  )
    .bind(Date.now(), zernioPostId ?? null, id)
    .run();
}

export async function markDraftStatus(
  env: Env,
  id: string,
  status: DraftStatus
): Promise<void> {
  await env.DB.prepare(`UPDATE drafts SET status = ? WHERE id = ?`).bind(status, id).run();
}

export async function logPillar(
  env: Env,
  pillar: string,
  draftId: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pillar_log (pillar, posted_at, draft_id) VALUES (?, ?, ?)`
  )
    .bind(pillar, Date.now(), draftId)
    .run();
}

export async function pillarsUsedSince(
  env: Env,
  sinceMs: number
): Promise<string[]> {
  const rs = await env.DB.prepare(
    `SELECT DISTINCT pillar FROM pillar_log WHERE posted_at >= ? ORDER BY posted_at DESC`
  )
    .bind(sinceMs)
    .all<{ pillar: string }>();
  return (rs.results ?? []).map((r) => r.pillar);
}

export async function logSession(
  env: Env,
  row: { id: string; source: string; intent: string; outcome?: string; toolCalls: number; error?: string }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sessions (id, created_at, source, intent, outcome, tool_calls, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id,
      Date.now(),
      row.source,
      row.intent.slice(0, 1000),
      row.outcome ?? null,
      row.toolCalls,
      row.error ?? null
    )
    .run();
}

// ─── Drafts ─────────────────────────────────────────────────────────────────

function toDraftRow(r: Record<string, unknown>): DraftRow {
  return {
    id: String(r["id"]),
    created_at: Number(r["created_at"]),
    source: String(r["source"]),
    status: r["status"] as DraftStatus,
    format: r["format"] as DraftFormat,
    caption: String(r["caption"]),
    pillar: r["pillar"] == null ? null : String(r["pillar"]),
    payload: JSON.parse(String(r["payload_json"])) as DraftPayload,
    published_at: r["published_at"] == null ? null : Number(r["published_at"]),
    zernio_post_id: r["zernio_post_id"] == null ? null : String(r["zernio_post_id"]),
  };
}

// ─── Reel projects (the one-tap reel pipeline) ───────────────────────────────

export type ReelStatus =
  | "uploaded"     // row created, source video known, awaiting format pick
  | "editing"      // render workflow running (container job in flight)
  | "ready"        // rendered, preview card shown, awaiting publish decision
  | "scheduled"    // scheduled_for set; the per-minute cron will publish it
  | "publishing"   // cron picked it up, Zernio call in flight
  | "published"
  | "failed"
  | "cancelled";

export type ReelFormat = "talking_head" | "raw" | "broll";
export type ReelAwaiting = "format" | "th_style" | "topic" | "content";

/** Framework-aware caption block produced by the renderer (matches the shape
 *  `_publish_to_zernio` expects on the Railway side). */
export interface CaptionPayload {
  headline: string;
  body: string;
  hashtags: string;
  cta: string;
  gold_phrase?: string;
}

export interface ReelProjectRow {
  id: string;
  created_at: number;
  updated_at: number;
  source: string;
  status: ReelStatus;
  format: ReelFormat | null;
  awaiting_input: ReelAwaiting | null;
  raw_video_url: string | null;
  telegram_chat_id: string | null;
  telegram_message_id: number | null;
  topic: string | null;
  key_points: string | null;
  edited_url: string | null;
  thumbnail_url: string | null;
  transcript_url: string | null;
  caption_payload: CaptionPayload | null;
  cut_log_url: string | null;
  broll_plan_url: string | null;
  scheduled_for: number | null;
  zernio_post_id: string | null;
  zernio_profile_id: string | null;
  draft_id: string | null;
  workflow_id: string | null;
  error_message: string | null;
}

export async function insertReelProject(
  env: Env,
  row: {
    id: string;
    source?: string;
    status?: ReelStatus;
    raw_video_url?: string | null;
    telegram_chat_id?: string | null;
    telegram_message_id?: number | null;
  }
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO reel_projects
       (id, created_at, updated_at, source, status, raw_video_url,
        telegram_chat_id, telegram_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id,
      now,
      now,
      row.source ?? "telegram",
      row.status ?? "uploaded",
      row.raw_video_url ?? null,
      row.telegram_chat_id ?? null,
      row.telegram_message_id ?? null
    )
    .run();
}

export async function getReelProject(env: Env, id: string): Promise<ReelProjectRow | null> {
  const row = await env.DB.prepare(`SELECT * FROM reel_projects WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? toReelProjectRow(row) : null;
}

/** Mutable columns a caller may patch. `caption_payload` is serialized to the
 *  `caption_payload_json` column. `updated_at` is always bumped. */
export type ReelProjectPatch = Partial<{
  status: ReelStatus;
  format: ReelFormat | null;
  awaiting_input: ReelAwaiting | null;
  raw_video_url: string | null;
  telegram_message_id: number | null;
  topic: string | null;
  key_points: string | null;
  edited_url: string | null;
  thumbnail_url: string | null;
  transcript_url: string | null;
  caption_payload: CaptionPayload | null;
  cut_log_url: string | null;
  broll_plan_url: string | null;
  scheduled_for: number | null;
  zernio_post_id: string | null;
  zernio_profile_id: string | null;
  draft_id: string | null;
  workflow_id: string | null;
  error_message: string | null;
}>;

// Patch-key → DB column. `caption_payload` maps to the *_json column with a
// JSON.stringify transform; everything else is a passthrough.
const REEL_PATCH_COLUMNS: Record<string, string> = {
  status: "status",
  format: "format",
  awaiting_input: "awaiting_input",
  raw_video_url: "raw_video_url",
  telegram_message_id: "telegram_message_id",
  topic: "topic",
  key_points: "key_points",
  edited_url: "edited_url",
  thumbnail_url: "thumbnail_url",
  transcript_url: "transcript_url",
  caption_payload: "caption_payload_json",
  cut_log_url: "cut_log_url",
  broll_plan_url: "broll_plan_url",
  scheduled_for: "scheduled_for",
  zernio_post_id: "zernio_post_id",
  zernio_profile_id: "zernio_profile_id",
  draft_id: "draft_id",
  workflow_id: "workflow_id",
  error_message: "error_message",
};

export async function updateReelProject(
  env: Env,
  id: string,
  patch: ReelProjectPatch
): Promise<void> {
  const sets: string[] = ["updated_at = ?"];
  const binds: unknown[] = [Date.now()];
  for (const [key, col] of Object.entries(REEL_PATCH_COLUMNS)) {
    if (!(key in patch)) continue;
    const value = (patch as Record<string, unknown>)[key];
    sets.push(`${col} = ?`);
    binds.push(key === "caption_payload" ? (value == null ? null : JSON.stringify(value)) : value);
  }
  if (sets.length === 1) return; // nothing but updated_at — skip the write
  binds.push(id);
  await env.DB.prepare(`UPDATE reel_projects SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
}

export async function recentReelsForChat(
  env: Env,
  chatId: string,
  limit = 5
): Promise<ReelProjectRow[]> {
  const rs = await env.DB.prepare(
    `SELECT * FROM reel_projects WHERE telegram_chat_id = ? ORDER BY created_at DESC LIMIT ?`
  )
    .bind(chatId, limit)
    .all<Record<string, unknown>>();
  return (rs.results ?? []).map(toReelProjectRow);
}

/** Newest reel for a chat that's mid b-roll conversation (awaiting free text).
 *  Drives the topic -> key_points state machine. */
export async function pendingTextReelForChat(
  env: Env,
  chatId: string
): Promise<ReelProjectRow | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM reel_projects
      WHERE telegram_chat_id = ? AND awaiting_input IN ('topic','content')
      ORDER BY created_at DESC LIMIT 1`
  )
    .bind(chatId)
    .first<Record<string, unknown>>();
  return row ? toReelProjectRow(row) : null;
}

/** Scheduled reels whose time has arrived — the per-minute cron publishes these. */
export async function dueReels(env: Env, nowMs: number, limit = 10): Promise<ReelProjectRow[]> {
  const rs = await env.DB.prepare(
    `SELECT * FROM reel_projects
      WHERE status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= ?
      ORDER BY scheduled_for ASC LIMIT ?`
  )
    .bind(nowMs, limit)
    .all<Record<string, unknown>>();
  return (rs.results ?? []).map(toReelProjectRow);
}

/** Latest scheduled_for across a chat's reels — used to stack queue slots. */
export async function latestScheduledForChat(env: Env, chatId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT scheduled_for FROM reel_projects
      WHERE telegram_chat_id = ? AND scheduled_for IS NOT NULL
      ORDER BY scheduled_for DESC LIMIT 1`
  )
    .bind(chatId)
    .first<{ scheduled_for: number }>();
  return row?.scheduled_for ?? null;
}

function toReelProjectRow(r: Record<string, unknown>): ReelProjectRow {
  const str = (k: string) => (r[k] == null ? null : String(r[k]));
  const num = (k: string) => (r[k] == null ? null : Number(r[k]));
  let caption: CaptionPayload | null = null;
  if (r["caption_payload_json"] != null) {
    try {
      caption = JSON.parse(String(r["caption_payload_json"])) as CaptionPayload;
    } catch {
      caption = null;
    }
  }
  return {
    id: String(r["id"]),
    created_at: Number(r["created_at"]),
    updated_at: Number(r["updated_at"]),
    source: String(r["source"]),
    status: r["status"] as ReelStatus,
    format: (r["format"] as ReelFormat) ?? null,
    awaiting_input: (r["awaiting_input"] as ReelAwaiting) ?? null,
    raw_video_url: str("raw_video_url"),
    telegram_chat_id: str("telegram_chat_id"),
    telegram_message_id: num("telegram_message_id"),
    topic: str("topic"),
    key_points: str("key_points"),
    edited_url: str("edited_url"),
    thumbnail_url: str("thumbnail_url"),
    transcript_url: str("transcript_url"),
    caption_payload: caption,
    cut_log_url: str("cut_log_url"),
    broll_plan_url: str("broll_plan_url"),
    scheduled_for: num("scheduled_for"),
    zernio_post_id: str("zernio_post_id"),
    zernio_profile_id: str("zernio_profile_id"),
    draft_id: str("draft_id"),
    workflow_id: str("workflow_id"),
    error_message: str("error_message"),
  };
}

// ─── Asset library ───────────────────────────────────────────────────────────

export interface AssetRow {
  id: string;
  created_at: number;
  kind: string;
  category: string | null;
  project: string | null;
  name: string | null;
  description: string | null;
  tags: string | null;
  r2_key: string;
  public_url: string | null;
  mime_type: string | null;
  source: string;
  telegram_chat_id: string | null;
}

export async function insertAsset(
  env: Env,
  row: Omit<AssetRow, "created_at"> & { created_at?: number }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO assets
       (id, created_at, kind, category, project, name, description, tags,
        r2_key, public_url, mime_type, source, telegram_chat_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id,
      row.created_at ?? Date.now(),
      row.kind,
      row.category ?? null,
      row.project ?? null,
      row.name ?? null,
      row.description ?? null,
      row.tags ?? null,
      row.r2_key,
      row.public_url ?? null,
      row.mime_type ?? null,
      row.source ?? "telegram",
      row.telegram_chat_id ?? null
    )
    .run();
}

export async function recentAssets(env: Env, limit = 20, kind?: string): Promise<AssetRow[]> {
  const rs = kind
    ? await env.DB.prepare(
        `SELECT * FROM assets WHERE kind = ? ORDER BY created_at DESC LIMIT ?`
      )
        .bind(kind, limit)
        .all<Record<string, unknown>>()
    : await env.DB.prepare(`SELECT * FROM assets ORDER BY created_at DESC LIMIT ?`)
        .bind(limit)
        .all<Record<string, unknown>>();
  return (rs.results ?? []).map(toAssetRow);
}

/** Keyword search across name/description/tags for the agent to pull an asset. */
export async function searchAssets(env: Env, query: string, limit = 12): Promise<AssetRow[]> {
  const like = `%${query.trim()}%`;
  const rs = await env.DB.prepare(
    `SELECT * FROM assets
      WHERE name LIKE ? OR description LIKE ? OR tags LIKE ? OR category LIKE ?
      ORDER BY created_at DESC LIMIT ?`
  )
    .bind(like, like, like, like, limit)
    .all<Record<string, unknown>>();
  return (rs.results ?? []).map(toAssetRow);
}

function toAssetRow(r: Record<string, unknown>): AssetRow {
  const str = (k: string) => (r[k] == null ? null : String(r[k]));
  return {
    id: String(r["id"]),
    created_at: Number(r["created_at"]),
    kind: String(r["kind"]),
    category: str("category"),
    project: str("project"),
    name: str("name"),
    description: str("description"),
    tags: str("tags"),
    r2_key: String(r["r2_key"]),
    public_url: str("public_url"),
    mime_type: str("mime_type"),
    source: String(r["source"]),
    telegram_chat_id: str("telegram_chat_id"),
  };
}

// ─── Content ideas (the idea bank — migration 0019) ──────────────────────────

export async function insertContentIdea(
  env: Env,
  input: { hook: string; angle?: string; pillar?: string; format_hint?: string; source?: string }
): Promise<{ id: string }> {
  const id = `idea_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  await env.DB.prepare(
    `INSERT INTO content_ideas (id, created_at, hook, angle, pillar, format_hint, status, source)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  )
    .bind(
      id,
      Date.now(),
      input.hook.trim().slice(0, 280),
      (input.angle ?? "").trim().slice(0, 500) || null,
      (input.pillar ?? "").trim().slice(0, 80) || null,
      (input.format_hint ?? "").trim().slice(0, 40) || null,
      input.source ?? "manual"
    )
    .run();
  return { id };
}
