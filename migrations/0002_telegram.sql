-- Telegram conversation persistence — one row per turn, threaded by chat_id.
-- The agent loads the last N turns when constructing the messages array.

CREATE TABLE IF NOT EXISTS tg_turns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id      INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  role         TEXT NOT NULL,           -- 'user' | 'assistant'
  content_json TEXT NOT NULL,           -- serialized Anthropic content blocks (text + image)
  tokens_in    INTEGER,
  tokens_out   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tg_turns_chat
  ON tg_turns (chat_id, created_at DESC);

-- Per-chat metadata (token budgets, last activity, etc.)
CREATE TABLE IF NOT EXISTS tg_chats (
  chat_id          INTEGER PRIMARY KEY,
  first_seen_at    INTEGER NOT NULL,
  last_active_at   INTEGER NOT NULL,
  total_tokens_in  INTEGER NOT NULL DEFAULT 0,
  total_tokens_out INTEGER NOT NULL DEFAULT 0,
  turn_count       INTEGER NOT NULL DEFAULT 0,
  authorized       INTEGER NOT NULL DEFAULT 0  -- 1 if explicitly allowed; 0 by default (locked to first user)
);

-- First-user lock — first chat to message captures owner_id; everyone else silently dropped
CREATE TABLE IF NOT EXISTS tg_owner (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  chat_id   INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  captured_at INTEGER NOT NULL
);
