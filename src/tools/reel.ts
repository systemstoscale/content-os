import type { Env } from "../env";
import { processorFetch } from "../processor";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
}

export interface ReelTranscript {
  text: string;
  language: string;
  duration_seconds: number;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
}

export interface ProcessReelInput {
  r2_key: string;
  caption_style?: "opus" | "minimal" | "off";
}

export interface ProcessReelOutput {
  processed_r2_key: string;
  processed_public_url: string;
  /** JPEG frame extracted from ~1.5s into the processed video. Use as the
   *  background_image_url on render_thumbnail so the cover is visually
   *  rooted in the actual reel. Empty string if extraction failed. */
  cover_frame_url: string;
  transcript: ReelTranscript;
  duration_seconds: number;
}

export async function processReel(
  env: Env,
  input: ProcessReelInput
): Promise<ProcessReelOutput> {
  const obj = await env.ASSETS.get(input.r2_key);
  if (!obj) throw new Error(`r2 object not found: ${input.r2_key}`);

  const filename = input.r2_key.split("/").pop() ?? "input.mp4";
  const contentType = obj.httpMetadata?.contentType ?? "video/mp4";

  const form = new FormData();
  form.append("video", new Blob([await obj.arrayBuffer()], { type: contentType }), filename);
  form.append("caption_style", input.caption_style ?? "opus");

  const res = await processorFetch(env, "/process-reel", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`processor ${res.status}: ${text.slice(0, 500)}`);
  }

  const transcriptHeader = res.headers.get("x-transcript-base64");
  const duration = Number(res.headers.get("x-duration-seconds") ?? "0");
  if (!transcriptHeader) {
    throw new Error("processor response missing X-Transcript-Base64 header");
  }
  const transcript = JSON.parse(atob(transcriptHeader)) as ReelTranscript;

  const fullBytes = await res.arrayBuffer();
  // The container packs [video bytes][frame bytes]. x-video-size tells us
  // where the split is. x-frame-size = 0 means no frame extracted (very
  // short clip or ffmpeg quirk) — fall back gracefully.
  const videoSize = Number(res.headers.get("x-video-size") ?? `${fullBytes.byteLength}`);
  const frameSize = Number(res.headers.get("x-frame-size") ?? "0");
  const videoBytes = fullBytes.slice(0, videoSize);
  const frameBytes = frameSize > 0 ? fullBytes.slice(videoSize, videoSize + frameSize) : null;

  const stem = stripExt(input.r2_key);
  const ts = Date.now();
  const processed_r2_key = `reels/${stem}-processed-${ts}.mp4`;
  await env.ASSETS.put(processed_r2_key, videoBytes, {
    httpMetadata: { contentType: "video/mp4" },
  });

  let cover_frame_url = "";
  if (frameBytes) {
    const frame_r2_key = `frames/${stem}-frame-${ts}.jpg`;
    await env.ASSETS.put(frame_r2_key, frameBytes, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    cover_frame_url = await publicUrlFor(env, frame_r2_key);
  }

  return {
    processed_r2_key,
    processed_public_url: await publicUrlFor(env, processed_r2_key),
    cover_frame_url,
    transcript,
    duration_seconds: duration || transcript.duration_seconds,
  };
}

function stripExt(key: string): string {
  return key.replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, "");
}

async function publicUrlFor(env: Env, r2_key: string): Promise<string> {
  const base = await env.CONFIG.get("R2_PUBLIC_BASE");
  if (base) return `${base.replace(/\/$/, "")}/${r2_key}`;
  return `/r2/${r2_key}`;
}
