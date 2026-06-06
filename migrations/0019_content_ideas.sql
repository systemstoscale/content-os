-- Content idea bank (Phase 3 — content team: ideation stage).
-- The AI generates post ideas from the brand kit (voice + pillars + hook bank);
-- the founder reviews them, dismisses the weak ones, and one-taps "Draft this"
-- to hand a winner to the content pipeline. This is the ideation surface that
-- sits before creation/generation.

CREATE TABLE IF NOT EXISTS content_ideas (
  id           TEXT PRIMARY KEY,                 -- "idea_..."
  created_at   INTEGER NOT NULL,
  hook         TEXT NOT NULL,                    -- the scroll-stopping opener
  angle        TEXT,                             -- the take / what it argues
  pillar       TEXT,                             -- which content pillar
  format_hint  TEXT,                             -- carousel | quote_post | reel | text_post | youtube
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | used | dismissed
  source       TEXT NOT NULL DEFAULT 'ai'        -- ai | manual
);

CREATE INDEX IF NOT EXISTS idx_content_ideas_status ON content_ideas(status, created_at DESC);
