-- ContentOS — the asset library.
-- Ported from the Railway asset system (skalers/backend/ai-systems/systems/
-- assets.py). The creator drops a meme / logo / sound / screenshot / b-roll clip
-- into Telegram with a caption prefix (asset: / save: / meme: / logo: / sound:),
-- and it's stored in R2 + indexed here so the agent can pull it into an edit.

CREATE TABLE IF NOT EXISTS assets (
  id                 TEXT PRIMARY KEY,                   -- "asset_..."
  created_at         INTEGER NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'other',      -- meme | logo | sound | screenshot | broll | image | video | other
  category           TEXT,                               -- free-text bucket (from `category=` directive)
  project            TEXT,                               -- optional grouping (from `project=` directive)
  name               TEXT,                               -- display name (from `name=` directive or filename)
  description        TEXT,                               -- AI/looked-up description, powers retrieval
  tags               TEXT,                               -- space-separated tags for search
  r2_key             TEXT NOT NULL,                      -- where the bytes live in the ASSETS bucket
  public_url         TEXT,                               -- public URL for the asset
  mime_type          TEXT,
  source             TEXT NOT NULL DEFAULT 'telegram',
  telegram_chat_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets (project, created_at DESC);
