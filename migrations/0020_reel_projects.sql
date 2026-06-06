-- ContentOS — the one-tap reel pipeline state.
-- Ported from the Railway/Supabase `reel_projects` table (skalers/backend/
-- ai-systems/systems/reels.py) into D1. One row per reel a creator drops into
-- the Telegram bot: ingest -> format pick -> render (workflow + container) ->
-- preview card -> publish/schedule via Zernio.
--
-- Status machine:
--   uploaded -> editing -> ready -> scheduled -> publishing -> published
--   (+ terminal: failed, cancelled)
--
-- Timestamps are INTEGER epoch-ms (Date.now()), matching the rest of the D1
-- schema. `scheduled_for` is ALSO epoch-ms (UTC) so the per-minute cron can fire
-- due reels with a plain `<= ?` comparison — no tz-string parsing. The buyer's
-- timezone only matters when COMPUTING that instant (Telegram schedule presets)
-- and when formatting a human label for chat.

CREATE TABLE IF NOT EXISTS reel_projects (
  id                    TEXT PRIMARY KEY,                  -- "reel_..."
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  source                TEXT NOT NULL DEFAULT 'telegram',  -- telegram | shortcut | api
  status                TEXT NOT NULL DEFAULT 'uploaded',  -- uploaded|editing|ready|scheduled|publishing|published|failed|cancelled
  format                TEXT,                              -- talking_head | raw | broll
  awaiting_input        TEXT,                              -- format | th_style | topic | content | NULL

  raw_video_url         TEXT,                              -- R2 public URL of the source clip ('pending' until upload lands)
  telegram_chat_id      TEXT,
  telegram_message_id   INTEGER,

  topic                 TEXT,                              -- b-roll format: the reel topic
  key_points            TEXT,                              -- b-roll format: the post-body key points

  edited_url            TEXT,                              -- finished reel.mp4 (R2 public URL)
  thumbnail_url         TEXT,
  transcript_url        TEXT,
  caption_payload_json  TEXT,                              -- {headline, body, hashtags, cta, gold_phrase}
  cut_log_url           TEXT,                              -- debug artifact
  broll_plan_url        TEXT,                              -- debug artifact

  scheduled_for         INTEGER,                           -- epoch-ms (UTC) the reel should publish; NULL if not scheduled
  zernio_post_id        TEXT,
  zernio_profile_id     TEXT,

  draft_id              TEXT,                              -- linked drafts.id; reels publish via the proven publishDraftById path
  workflow_id           TEXT,                              -- REEL_RENDER_WORKFLOW instance id (observability / re-render)
  error_message         TEXT
);

-- Recent reels for a chat (/reel_status) + global recency.
CREATE INDEX IF NOT EXISTS idx_reel_projects_status_created
  ON reel_projects (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reel_projects_chat
  ON reel_projects (telegram_chat_id, created_at DESC);

-- The per-minute scheduler scans this: status='scheduled' AND scheduled_for <= now.
CREATE INDEX IF NOT EXISTS idx_reel_projects_due
  ON reel_projects (status, scheduled_for);
