-- Content OS — Phase 1 schema
-- Apply with: wrangler d1 execute content-os --file=migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS drafts (
  id           TEXT PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  source       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  format       TEXT NOT NULL,
  caption      TEXT NOT NULL,
  pillar       TEXT,
  payload_json TEXT NOT NULL,
  published_at INTEGER,
  zernio_post_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_drafts_status_created
  ON drafts (status, created_at DESC);

CREATE TABLE IF NOT EXISTS pillar_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pillar     TEXT NOT NULL,
  posted_at  INTEGER NOT NULL,
  draft_id   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pillar_log_posted_at
  ON pillar_log (posted_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  source     TEXT NOT NULL,
  intent     TEXT NOT NULL,
  outcome    TEXT,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  error      TEXT
);
