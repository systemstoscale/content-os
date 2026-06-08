import type { Env } from "../env";
import { logApiCost } from "../lib/cost-tracking";
import { DEFAULT_IMAGE_MODEL, getMediaConfig, withCreatorLook } from "../lib/media-config";
import { r2PublicUrl } from "../lib/r2-url";

/** KIE.AI image generation (Worker-side).
 *
 *  Ported from the proven content-skill client
 *  (.claude/skills/2-video-editing/kie_ai_image.py and
 *  skalers/frontend/src/lib/kie-ai.ts) and adapted to the Worker: takes `env`,
 *  reads env.KIE_AI_API_KEY, re-hosts the result to our R2 so we own the
 *  lifetime/CDN, and logs the spend.
 *
 *  Single credential (Bearer KIE_AI_API_KEY) — no OAuth, no per-buyer model
 *  training. Default model nano-banana-pro; overridable per buyer via
 *  CONFIG.KIE_IMAGE_MODEL (see src/lib/media-config.ts). Pass a headshot URL as
 *  `image_reference` to make the output resemble the creator (~75-85% likeness,
 *  reference-conditioned — NOT a trained face-lock). */

const BASE_URL = "https://api.kie.ai/api/v1";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

export type KieAspectRatio =
  | "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9" | "auto";
export type KieResolution = "1K" | "2K" | "4K";

export interface KieImageInput {
  prompt: string;
  /** Aspect ratio (replaces Higgsfield's width_and_height enum). Default 1:1. */
  aspect_ratio?: KieAspectRatio;
  resolution?: KieResolution;
  asset_prefix: string;
  /** Single public reference image URL (e.g. the creator's headshot). */
  image_reference?: string;
  /** Multiple reference URLs (up to 8). Merged with image_reference. */
  image_references?: string[];
  output_format?: "png" | "jpg";
  /** Model slug. Default nano-banana-pro; pass CONFIG.KIE_IMAGE_MODEL. */
  model?: string;
}

export interface KieImageOutput {
  r2_key: string;
  public_url: string;
  width: number;
  height: number;
  task_id: string;
}

interface CreateTaskResponse {
  code: number;
  msg: string;
  data?: { taskId: string };
}
interface TaskStatusResponse {
  code: number;
  msg: string;
  data?: { taskId: string; state: string; resultJson?: string; failMsg?: string };
}

function apiKey(env: Env): string {
  if (!env.KIE_AI_API_KEY) {
    throw new Error("KIE.AI not configured — set KIE_AI_API_KEY via `wrangler secret put KIE_AI_API_KEY`");
  }
  return env.KIE_AI_API_KEY;
}

async function publicUrlFor(env: Env, r2_key: string): Promise<string> {
  // Route through this Worker's own /r2/ origin (R2_PUBLIC_BASE || WORKER_URL).
  // Never hardcode a host — every Deploy-button buyer runs on their own
  // subdomain, so a hardcoded operator host would 404 their generated images.
  return r2PublicUrl(env, r2_key);
}

/** Rough nano-banana-pro spend so the daily cap accounts for image gen. */
function estimateImageUsd(resolution: KieResolution): number {
  return resolution === "4K" ? 0.12 : resolution === "1K" ? 0.03 : 0.06;
}

/** Map an aspect ratio to nominal pixel dims (for the returned width/height —
 *  the renderer/Meta only need approximate proportions). */
function dimsFor(aspect: KieAspectRatio, resolution: KieResolution): { width: number; height: number } {
  const long = resolution === "4K" ? 4096 : resolution === "1K" ? 1024 : 2048;
  const short = Math.round(
    aspect === "9:16" ? long * (9 / 16)
      : aspect === "16:9" ? long * (9 / 16)
      : aspect === "4:5" ? long * (4 / 5)
      : aspect === "3:4" || aspect === "4:3" ? long * (3 / 4)
      : long,
  );
  if (aspect === "9:16" || aspect === "3:4" || aspect === "2:3" || aspect === "4:5") {
    return { width: short, height: long };
  }
  if (aspect === "16:9" || aspect === "3:2" || aspect === "21:9" || aspect === "5:4" || aspect === "4:3") {
    return { width: long, height: short };
  }
  return { width: long, height: long };
}

async function createTask(env: Env, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE_URL}/jobs/createTask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`kie createTask ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as CreateTaskResponse;
  const taskId = json.data?.taskId;
  if (json.code !== 200 || !taskId) {
    throw new Error(`kie createTask failed: ${json.msg ?? "no taskId"} (code ${json.code})`);
  }
  return taskId;
}

/** Poll /jobs/recordInfo until state=success, returning the first result URL. */
async function pollTask(env: Env, taskId: string, timeoutMs = POLL_TIMEOUT_MS): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${BASE_URL}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey(env)}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`kie recordInfo ${res.status}: ${text.slice(0, 400)}`);
    }
    const json = (await res.json()) as TaskStatusResponse;
    const state = (json.data?.state ?? "").toLowerCase();
    if (state === "success") {
      const url = firstResultUrl(json.data?.resultJson);
      if (!url) throw new Error(`kie task ${taskId} success but no result url`);
      return url;
    }
    if (state === "fail") {
      throw new Error(`kie task ${taskId} failed: ${json.data?.failMsg ?? "no message"}`);
    }
  }
  throw new Error(`kie task ${taskId} timed out after ${timeoutMs / 1000}s`);
}

/** Parse resultJson → resultUrls[0]. Shared by image + avatar clients. */
export function firstResultUrl(resultJson: string | undefined): string | null {
  if (!resultJson) return null;
  try {
    const parsed = JSON.parse(resultJson) as { resultUrls?: string[] };
    return parsed.resultUrls?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Generate an image and re-host it on our R2. Returns a public URL. */
export async function kieImage(env: Env, input: KieImageInput): Promise<KieImageOutput> {
  const aspect = input.aspect_ratio ?? "1:1";
  const resolution = input.resolution ?? "2K";
  const refs = [input.image_reference, ...(input.image_references ?? [])].filter(Boolean) as string[];

  const taskId = await createTask(env, {
    model: input.model || DEFAULT_IMAGE_MODEL,
    input: {
      prompt: input.prompt,
      aspect_ratio: aspect,
      resolution,
      output_format: input.output_format ?? "png",
      ...(refs.length ? { image_input: refs.slice(0, 8) } : {}),
    },
  });

  const cdnUrl = await pollTask(env, taskId);

  // Re-host on our R2 so we control lifetime/CDN.
  const fetched = await fetch(cdnUrl);
  if (!fetched.ok) throw new Error(`kie asset fetch ${fetched.status}`);
  const bytes = await fetched.arrayBuffer();
  const ext = cdnUrl.match(/\.([a-z0-9]+)(\?|$)/i)?.[1]?.toLowerCase() ?? "png";
  const contentType = ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  const r2_key = `kie/${input.asset_prefix}-${Date.now()}.${ext}`;
  await env.ASSETS.put(r2_key, bytes, { httpMetadata: { contentType } });

  void logApiCost(env, { provider: "kie", operation: "image", usd: estimateImageUsd(resolution), context: { model: input.model || DEFAULT_IMAGE_MODEL, resolution } });

  const { width, height } = dimsFor(aspect, resolution);
  return { r2_key, public_url: await publicUrlFor(env, r2_key), width, height, task_id: taskId };
}

export interface KieCreatorImageInput {
  prompt: string;
  aspect_ratio?: KieAspectRatio;
  resolution?: KieResolution;
  asset_prefix: string;
}

/** Generate an image OF THE CREATOR — reads the buyer's headshot
 *  (CONFIG.SOUL_REFERENCE_URL) and look (CONFIG.CREATOR_LOOK) from CONFIG and
 *  conditions the generation on them (~75-85% likeness, reference-conditioned,
 *  not a trained face-lock). Nothing creator-specific is hardcoded. */
export async function kieCreatorImage(env: Env, input: KieCreatorImageInput): Promise<KieImageOutput> {
  const media = await getMediaConfig(env);
  return kieImage(env, {
    prompt: withCreatorLook(media.creatorLook, input.prompt),
    aspect_ratio: input.aspect_ratio,
    resolution: input.resolution,
    asset_prefix: input.asset_prefix,
    image_reference: media.soulReferenceUrl ?? undefined,
    model: media.imageModel,
  });
}
