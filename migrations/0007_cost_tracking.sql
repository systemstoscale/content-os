-- Cost tracking — per-call API spend in microdollars (integer, no float drift).
--
-- Wired by src/lib/cost-tracking.ts. Every billable external call
-- (Anthropic, Zernio, Apollo, Instantly, Serper, Jina, Apify, ...) fires
-- `logApiCost()` after success/failure. The 24h sum is read by
-- `assertUnderDailySpendCap(env)` at the entry point of every workflow
-- + the agent loop, so a runaway autopilot can't burn through the buyer's
-- API budgets unattended.
--
-- 1 USD = 1_000_000 micro_dollars. Integer arithmetic avoids float
-- precision bugs that bit the EE prospecting-system before they moved to
-- this scheme.
--
-- Daily cap default lives in CONFIG.DAILY_SPEND_CAP_USD (single value).
-- $25/day is the sensible per-buyer default — generous enough for a
-- normal day, restrictive enough to catch an infinite loop.

CREATE TABLE IF NOT EXISTS api_costs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     INTEGER NOT NULL,                  -- ms epoch
  provider       TEXT NOT NULL,                     -- anthropic | zernio | apollo | instantly | heyreach | apify | serper | jina | neverbounce | meta | etc.
  operation      TEXT NOT NULL,                     -- model id ("claude-haiku-4-5") or endpoint ("apollo/people_match")
  micro_dollars  INTEGER NOT NULL,                  -- 1_000_000 = $1.00
  context_json   TEXT                               -- optional payload context (input_tokens, output_tokens, lead_id, etc.)
);

-- The 24h sum query is the only hot path: WHERE created_at >= ?.
-- A single index on created_at covers it.
CREATE INDEX IF NOT EXISTS idx_api_costs_created_at ON api_costs(created_at DESC);
