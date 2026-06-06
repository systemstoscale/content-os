import type { Env } from "../env";
import { recentAssets, searchAssets, type AssetRow } from "../db";

// Agent tools over the asset library. The creator drops files into Telegram
// with a prefix caption (handled by src/telegram/asset-ingest.ts) — these tools
// let the agent FIND those assets and pull their public URLs into an edit
// (e.g. compositing a logo into a thumbnail, sourcing b-roll for a reel).

export interface SearchAssetsInput {
  query: string;
  limit?: number;
}

export interface ListAssetsInput {
  kind?: string;
  limit?: number;
}

export interface AssetSummary {
  id: string;
  kind: string;
  name: string | null;
  category: string | null;
  project: string | null;
  description: string | null;
  public_url: string | null;
  mime_type: string | null;
}

export interface AssetsOutput {
  assets: AssetSummary[];
}

function toSummary(a: AssetRow): AssetSummary {
  return {
    id: a.id,
    kind: a.kind,
    name: a.name,
    category: a.category,
    project: a.project,
    description: a.description,
    public_url: a.public_url,
    mime_type: a.mime_type,
  };
}

/** Keyword search across name / description / tags / category. Use when the
 *  brief references a saved asset ("use my logo", "the rooftop b-roll"). */
export async function searchAssetsTool(env: Env, input: SearchAssetsInput): Promise<AssetsOutput> {
  const q = (input.query ?? "").trim();
  if (!q) return { assets: [] };
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 50);
  const rows = await searchAssets(env, q, limit);
  return { assets: rows.map(toSummary) };
}

/** Browse the most-recent assets, optionally filtered by kind. Use when the
 *  creator asks "what assets do I have" or you want to scan a kind (logo). */
export async function listAssetsTool(env: Env, input: ListAssetsInput): Promise<AssetsOutput> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const kind = input.kind?.trim() || undefined;
  const rows = await recentAssets(env, limit, kind);
  return { assets: rows.map(toSummary) };
}
