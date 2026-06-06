-- Dedupe Telegram webhook retries.
-- Telegram retries the same update_id when it doesn't get a fast 200 back,
-- which (before the fix) caused processMessage to fire multiple times per
-- user message. We INSERT OR IGNORE on update_id to skip duplicates.

CREATE TABLE IF NOT EXISTS tg_seen_updates (
  update_id  INTEGER PRIMARY KEY,
  seen_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tg_seen_updates_seen_at
  ON tg_seen_updates (seen_at DESC);
