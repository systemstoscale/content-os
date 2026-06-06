/**
 * Agent model selection.
 *
 * The buyer picks their daily-driver model (Haiku / Sonnet / Opus) from the
 * settings UI or the `/model` Telegram command; it's stored in CONFIG
 * `AGENT_MODEL`. Default stays Haiku 4.5 for cost. Heavy-reasoning call sites
 * (the conversational agent loop, ICP scoring, sequence + reply drafting,
 * Dream-100 curation) resolve through getAgentModel(). Genuinely cheap,
 * high-volume ops (reply classification) stay pinned to CLASSIFY_MODEL
 * regardless — quality where it matters, cost where it doesn't.
 */

import type { Env } from "../env";

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/** Reply classification + other throwaway calls — always cheapest. */
export const CLASSIFY_MODEL = "claude-haiku-4-5-20251001";

export interface ModelOption {
  id: string;
  label: string;
  /** Rough relative cost, shown in the picker so the choice is informed. */
  cost_hint: string;
}

/** The models a buyer may select. Keys are the short aliases used by the
 *  `/model <alias>` command + the settings UI radio. */
export const MODEL_OPTIONS: Record<string, ModelOption> = {
  haiku: {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5 — fast & cheap",
    cost_hint: "~$0.001 / message · best for high volume",
  },
  sonnet: {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6 — balanced",
    cost_hint: "~$0.01 / message · sharper writing",
  },
  opus: {
    id: "claude-opus-4-8",
    label: "Opus 4.8 — best quality",
    cost_hint: "~$0.05 / message · deepest reasoning",
  },
};

const ALLOWED_IDS = new Set(Object.values(MODEL_OPTIONS).map((m) => m.id));

/** Resolve the configured daily-driver model id, validated + safe-defaulted. */
export async function getAgentModel(env: Env): Promise<string> {
  const raw = (await env.CONFIG.get("AGENT_MODEL"))?.trim();
  if (raw && ALLOWED_IDS.has(raw)) return raw;
  // Accept a short alias too (so `/model opus` can store "opus" or the id).
  if (raw && MODEL_OPTIONS[raw]) return MODEL_OPTIONS[raw]!.id;
  return DEFAULT_MODEL;
}

/** Map a model id back to its short alias for display. */
export function aliasForModel(id: string): string {
  for (const [alias, opt] of Object.entries(MODEL_OPTIONS)) {
    if (opt.id === id) return alias;
  }
  return id;
}
