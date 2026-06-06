/**
 * Cost tracking — log every billable external call in microdollars
 * (integer, no float drift) and gate workflows on a daily cap so a
 * runaway autopilot can't burn the buyer's API budgets unattended.
 *
 * Wired into the Anthropic call site in src/agent.ts and (in future
 * phases) every external client in src/clients/prospecting/*.
 *
 * Daily cap = `CONFIG.DAILY_SPEND_CAP_USD` (default $25). Buyer can raise
 * it via /settings/integrations or /settings/config.
 */

import type { Env } from "../env";

const MICRO_PER_USD = 1_000_000;
const DEFAULT_DAILY_CAP_USD = 25;

export type CostProvider =
  | "anthropic"
  | "zernio"
  | "apollo"
  | "instantly"
  | "heyreach"
  | "apify"
  | "serper"
  | "jina"
  | "neverbounce"
  | "meta"
  | "kie"
  | "elevenlabs";

export interface LogApiCostInput {
  provider: CostProvider;
  operation: string;
  usd: number;
  context?: Record<string, unknown>;
}

/** Fire-and-forget — never throws. A failed log should never break the
 *  surrounding workflow. Bad DB state surfaces in /settings/health. */
export async function logApiCost(
  env: Env,
  input: LogApiCostInput,
): Promise<void> {
  const microDollars = Math.round(input.usd * MICRO_PER_USD);
  try {
    await env.DB.prepare(
      `INSERT INTO api_costs (created_at, provider, operation, micro_dollars, context_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        Date.now(),
        input.provider,
        input.operation,
        microDollars,
        input.context == null ? null : JSON.stringify(input.context),
      )
      .run();
  } catch (e) {
    console.warn(
      `logApiCost failed (${input.provider}/${input.operation}): ${String(e).slice(0, 200)}`,
    );
  }
}

export interface SpendSnapshot {
  spent_usd: number;
  cap_usd: number;
  pct: number;
  over_cap: boolean;
}

export async function getDailySpend(env: Env): Promise<SpendSnapshot> {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(micro_dollars), 0) AS micro FROM api_costs WHERE created_at >= ?`,
  )
    .bind(since)
    .first<{ micro: number }>();
  const microSpent = row?.micro ?? 0;
  const spent_usd = microSpent / MICRO_PER_USD;
  const cap_usd = await getDailyCapUsd(env);
  return {
    spent_usd,
    cap_usd,
    pct: cap_usd > 0 ? spent_usd / cap_usd : 0,
    over_cap: spent_usd >= cap_usd,
  };
}

export async function getDailyCapUsd(env: Env): Promise<number> {
  const raw = await env.CONFIG.get("DAILY_SPEND_CAP_USD");
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_CAP_USD;
}

export class DailySpendCapExceededError extends Error {
  constructor(public snapshot: SpendSnapshot) {
    super(
      `daily spend cap exceeded: $${snapshot.spent_usd.toFixed(2)} of $${snapshot.cap_usd.toFixed(2)}`,
    );
    this.name = "DailySpendCapExceededError";
  }
}

/** Throws if the buyer's 24h API spend is at or above their daily cap.
 *  Call this at the top of every workflow step + the agent loop. */
export async function assertUnderDailySpendCap(env: Env): Promise<void> {
  const snap = await getDailySpend(env);
  if (snap.over_cap) throw new DailySpendCapExceededError(snap);
}

// ─── Per-model Anthropic pricing (USD per million tokens) ──────────────────
// Source: https://www.anthropic.com/pricing — kept inline so cost tracking
// doesn't require a network call. Update on model launches.

interface ModelPricing {
  input_per_mtok: number;
  output_per_mtok: number;
  cached_input_per_mtok?: number;
}

const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  // Claude 4.x family
  "claude-opus-4-7": { input_per_mtok: 15, output_per_mtok: 75 },
  "claude-sonnet-4-6": { input_per_mtok: 3, output_per_mtok: 15 },
  "claude-haiku-4-5": { input_per_mtok: 1, output_per_mtok: 5 },
  // Common aliases / older
  "claude-3-5-sonnet-latest": { input_per_mtok: 3, output_per_mtok: 15 },
  "claude-3-5-haiku-latest": { input_per_mtok: 0.8, output_per_mtok: 4 },
};

interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function estimateAnthropicCostUsd(
  model: string,
  usage: AnthropicUsage,
): number {
  // Conservative fallback — falls back to Sonnet pricing so unknown models
  // bias the cap to trigger sooner rather than silently undercharge.
  const pricing =
    ANTHROPIC_PRICING[model] ?? ANTHROPIC_PRICING["claude-sonnet-4-6"]!;
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  if (inTok == null || outTok == null) return 0;
  const inputUsd = (inTok / 1_000_000) * pricing.input_per_mtok;
  const outputUsd = (outTok / 1_000_000) * pricing.output_per_mtok;
  return inputUsd + outputUsd;
}

/** Convenience wrapper for the agent loop: log one Anthropic message. */
export async function logAnthropicCost(
  env: Env,
  model: string,
  usage: AnthropicUsage,
  context?: Record<string, unknown>,
): Promise<void> {
  const usd = estimateAnthropicCostUsd(model, usage);
  if (usd <= 0) return;
  await logApiCost(env, {
    provider: "anthropic",
    operation: model,
    usd,
    context: { ...usage, ...(context ?? {}) },
  });
}
