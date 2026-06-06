import type { Env } from "../env";
import { kieImage } from "./kie";
import { kieLipsync } from "./kie-avatar";
import { elevenlabsTts } from "./elevenlabs";
import { processReel } from "./reel";
import { getMediaConfig, withCreatorLook } from "../lib/media-config";

export interface AvatarReelInput {
  /** The talking-head script. Sent to ElevenLabs verbatim, so write it the
   *  way the creator actually speaks. ~120 words for 30s, ~240 for 60s. */
  script: string;
  /** Visual scene description for the portrait. Examples: "indoor studio
   *  with soft ring light, neutral grey backdrop", "rooftop golden hour". */
  setting: string;
  /** Aspect ratio of the output. Default 9:16 (Reels/Shorts/TikTok). */
  aspect_ratio?: "9:16" | "1:1" | "16:9";
  /** R2 asset prefix. */
  asset_prefix: string;
  /** Optional override for the ElevenLabs voice id. Falls back to
   *  CONFIG.ELEVENLABS_DEFAULT_VOICE_ID. */
  voice_id?: string;
}

export interface AvatarReelOutput {
  /** FINAL processed video URL (opus captions burned in, ready to publish). */
  video_url: string;
  /** Cover frame extracted from the processed video. */
  cover_frame_url: string;
  /** The conditioned portrait the lipsync animated. */
  portrait_url: string;
  /** Public URL of the ElevenLabs audio fed to the lipsync. */
  audio_url: string;
  /** Word-level transcript from the captions pass. */
  transcript_text: string;
  /** Approximate duration in seconds (from TTS byte estimate). */
  duration_seconds: number;
}

/** Generate a voice-cloned talking-head reel of the creator, fully on KIE.AI.
 *
 *  Pipeline:
 *    1. Portrait — KIE image (nano-banana-pro) conditioned on the creator's
 *       headshot (CONFIG.SOUL_REFERENCE_URL) + look (CONFIG.CREATOR_LOOK).
 *    2. ElevenLabs TTS in the creator's cloned voice.
 *    3. KIE avatar model lipsyncs the portrait to the audio.
 *    4. Post-production: opus captions + cover frame.
 *
 *  Everything creator-specific (look, headshot, voice, models) is read from
 *  CONFIG so each buyer customises it for themselves — nothing is hardcoded.
 *
 *  Total run time: ~3-6 minutes. Caller should invoke under ctx.waitUntil. */
export async function generateAvatarReel(
  env: Env,
  input: AvatarReelInput
): Promise<AvatarReelOutput> {
  const aspect = input.aspect_ratio ?? "9:16";
  const media = await getMediaConfig(env);

  // 1 — Portrait via KIE, conditioned on the creator's headshot + look.
  let portrait_url: string;
  try {
    const portrait = await kieImage(env, {
      prompt: withCreatorLook(
        media.creatorLook,
        `looking confidently at camera, neutral expression, ${input.setting}, broadcast-quality lighting, photorealistic, sharp focus`,
      ),
      aspect_ratio: aspect,
      resolution: "2K",
      asset_prefix: `${input.asset_prefix}-portrait`,
      image_reference: media.soulReferenceUrl ?? undefined,
      model: media.imageModel,
    });
    portrait_url = portrait.public_url;
  } catch (e) {
    throw new Error(`[avatar:portrait] ${String(e).slice(0, 300)}`);
  }

  // 2 — ElevenLabs TTS in the cloned voice. Keep the WAV transcode for now;
  //     KIE avatar models accept a public audio URL (MP3-direct is a tested
  //     follow-up that would let us drop the container round-trip).
  let tts;
  try {
    tts = await elevenlabsTts(env, {
      text: input.script,
      voice_id: input.voice_id,
      asset_prefix: `${input.asset_prefix}-voice`,
      output_format: "mp3_44100_128",
      transcode_to_wav: true,
    });
  } catch (e) {
    throw new Error(`[avatar:tts] ${String(e).slice(0, 300)}`);
  }

  // 3 — Lipsync via the KIE avatar model. The face stays locked to the
  //     portrait throughout (the model animates whatever portrait it's given).
  let speak;
  try {
    speak = await kieLipsync(env, {
      portrait_url,
      audio_url: tts.public_url,
      prompt: withCreatorLook(media.creatorLook, `talking-head shot. ${input.setting}. natural head and lip motion synchronized to the audio. broadcast-quality.`),
      resolution: media.avatarResolution,
      asset_prefix: `${input.asset_prefix}-reel`,
      model: media.avatarModel,
    });
  } catch (e) {
    throw new Error(`[avatar:lipsync] ${String(e).slice(0, 300)}`);
  }

  // 4 — Post-production: opus captions + cover frame.
  let processed;
  try {
    processed = await processReel(env, {
      r2_key: speak.r2_key,
      caption_style: "opus",
    });
  } catch (e) {
    console.error(`[avatar:captions] failed, returning raw video:`, String(e).slice(0, 200));
    return {
      video_url: speak.public_url,
      cover_frame_url: portrait_url,
      portrait_url,
      audio_url: tts.public_url,
      transcript_text: input.script,
      duration_seconds: tts.duration_seconds_estimate,
    };
  }

  return {
    video_url: processed.processed_public_url,
    cover_frame_url: processed.cover_frame_url || portrait_url,
    portrait_url,
    audio_url: tts.public_url,
    transcript_text: processed.transcript?.text ?? input.script,
    duration_seconds: processed.duration_seconds || tts.duration_seconds_estimate,
  };
}
