import type { Env } from "../env";
import { logApiCost } from "../lib/cost-tracking";
import { firstResultUrl } from "./kie";
import { DEFAULT_AVATAR_MODEL, DEFAULT_AVATAR_RESOLUTION } from "../lib/media-config";
import { getCredential } from "../lib/credentials";

/** KIE.AI audio-driven talking-head (lipsync) — Worker-side.
 *
 *  Animates a portrait to a voice track: portrait URL + audio URL → talking
 *  mp4, keeping the face in the portrait. Replaces Higgsfield's
 *  /v1/speak/higgsfield. Same generic /jobs/createTask + /jobs/recordInfo
 *  envelope as the image client.
 *
 *  Default model: kling-ai-avatar (Kling AI Avatar 2.0) — handles full-length
 *  reels (up to ~5 min). The cheaper "infinitetalk" caps audio at 15s, so it's
 *  only suitable for short hooks. The slug is per-buyer overridable via
 *  CONFIG.KIE_AVATAR_MODEL — verify the exact slug for your KIE account at
 *  https://docs.kie.ai/market. (If KIE avatar quality disappoints, the proven
 *  off-KIE fallback is fal.ai OmniHuman 1.5 — see
 *  skalers/backend/content/kai_v3_test.py.)
 *
 *  Confirmed InfiniteTalk/Kling input fields on createTask: image_url,
 *  audio_url, prompt, resolution ("480p"|"720p"), optional seed. */

const BASE_URL = "https://api.kie.ai/api/v1";

export interface KieLipsyncInput {
  /** Public URL of the portrait whose face is animated. */
  portrait_url: string;
  /** Public URL of the voice track (WAV or MP3). */
  audio_url: string;
  /** Optional scene/style hint. */
  prompt?: string;
  resolution?: "480p" | "720p";
  asset_prefix: string;
  /** Model slug. Default kling-ai-avatar; pass CONFIG.KIE_AVATAR_MODEL. */
  model?: string;
}

export interface KieLipsyncOutput {
  r2_key: string;
  public_url: string;
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
  data?: {
    taskId: string;
    state: string;
    resultJson?: string;
    failMsg?: string;
    // Some video models surface the URL outside resultJson — handle both.
    resultUrls?: string[];
    videoInfo?: { videoUrl?: string };
  };
}

async function apiKey(env: Env): Promise<string> {
  const key = await getCredential(env, "KIE_AI_API_KEY");
  if (!key) {
    throw new Error("KIE.AI not configured — set KIE_AI_API_KEY via `wrangler secret put KIE_AI_API_KEY`");
  }
  return key;
}

async function publicUrlFor(env: Env, r2_key: string): Promise<string> {
  const base = await env.CONFIG.get("R2_PUBLIC_BASE");
  if (base) return `${base.replace(/\/$/, "")}/${r2_key}`;
  return `https://content-os.admin-2ab.workers.dev/r2/${r2_key}`;
}

/** Submit a lipsync job. Returns the taskId immediately (does NOT block on the
 *  render). The durable Workflow polls separately so the multi-minute render
 *  can sleep across step boundaries. */
export async function submitKieLipsync(env: Env, input: KieLipsyncInput): Promise<string> {
  const res = await fetch(`${BASE_URL}/jobs/createTask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await apiKey(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.model || DEFAULT_AVATAR_MODEL,
      input: {
        image_url: input.portrait_url,
        audio_url: input.audio_url,
        resolution: input.resolution ?? DEFAULT_AVATAR_RESOLUTION,
        ...(input.prompt ? { prompt: input.prompt } : {}),
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`kie lipsync submit ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as CreateTaskResponse;
  const taskId = json.data?.taskId;
  if (json.code !== 200 || !taskId) {
    throw new Error(`kie lipsync submit failed: ${json.msg ?? "no taskId"} (code ${json.code})`);
  }
  return taskId;
}

/** Single status probe. Returns current state without waiting. */
export async function probeKieLipsync(
  env: Env,
  taskId: string,
): Promise<{ status: "pending" | "completed" | "failed"; url: string | null; error: string | null }> {
  const res = await fetch(`${BASE_URL}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${await apiKey(env)}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`kie lipsync poll ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as TaskStatusResponse;
  const state = (json.data?.state ?? "").toLowerCase();
  if (state === "success") {
    const url =
      firstResultUrl(json.data?.resultJson) ??
      json.data?.resultUrls?.[0] ??
      json.data?.videoInfo?.videoUrl ??
      null;
    return { status: "completed", url, error: null };
  }
  if (state === "fail") {
    return { status: "failed", url: null, error: json.data?.failMsg ?? "no message" };
  }
  return { status: "pending", url: null, error: null };
}

/** Download the rendered mp4 from KIE's CDN to our R2 so we own lifetime/CDN.
 *  Byte-for-byte the same contract as the old downloadSpeak, so processReel
 *  reads it unchanged. */
export async function downloadKieLipsync(
  env: Env,
  cdnUrl: string,
  taskId: string,
  assetPrefix: string,
): Promise<KieLipsyncOutput> {
  const fetched = await fetch(cdnUrl);
  if (!fetched.ok) throw new Error(`kie lipsync asset fetch ${fetched.status}`);
  const bytes = await fetched.arrayBuffer();
  const r2_key = `kie/${assetPrefix}-${Date.now()}.mp4`;
  await env.ASSETS.put(r2_key, bytes, { httpMetadata: { contentType: "video/mp4" } });
  void logApiCost(env, { provider: "kie", operation: "lipsync", usd: 0.3, context: { task_id: taskId } });
  return { r2_key, public_url: await publicUrlFor(env, r2_key), task_id: taskId };
}

/** Convenience: submit + poll + download inline. Used by the non-Workflow tool
 *  path. Workflow callers use the split helpers above so each phase is its own
 *  durable, retryable step. */
export async function kieLipsync(env: Env, input: KieLipsyncInput): Promise<KieLipsyncOutput> {
  const taskId = await submitKieLipsync(env, input);
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15_000));
    const probe = await probeKieLipsync(env, taskId);
    if (probe.status === "completed") {
      if (!probe.url) throw new Error(`kie lipsync ${taskId} completed without a result url`);
      return downloadKieLipsync(env, probe.url, taskId, input.asset_prefix);
    }
    if (probe.status === "failed") {
      throw new Error(`kie lipsync ${taskId} failed: ${probe.error ?? "no message"}`);
    }
  }
  throw new Error(`kie lipsync ${taskId} timed out`);
}
