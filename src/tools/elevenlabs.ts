import type { Env } from "../env";
import { processorFetch } from "../processor";
import { getCredential } from "../lib/credentials";
import { r2PublicUrl } from "../lib/r2-url";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1";

export interface TtsInput {
  text: string;
  /** Voice id from ElevenLabs. If omitted, uses CONFIG.ELEVENLABS_DEFAULT_VOICE_ID. */
  voice_id?: string;
  /** ElevenLabs output format id. Common: mp3_44100_128 (default-quality
   *  MP3), mp3_44100_192 (higher-quality), pcm_44100 (raw 16-bit PCM, WAV
   *  wrapped before use). */
  output_format?: "mp3_44100_128" | "mp3_44100_192" | "pcm_44100";
  /** If true, transcode the resulting MP3 to WAV via the ffmpeg container
   *  before storing in R2. Kept as a safe default for the KIE avatar lipsync
   *  step; MP3-direct is a tested follow-up that would drop this hop. */
  transcode_to_wav?: boolean;
  model_id?: string; // default eleven_multilingual_v2
  asset_prefix: string;
}

export interface TtsOutput {
  r2_key: string;
  public_url: string;
  /** Approximate duration in seconds, computed from byte count + bitrate.
   *  The agent uses it to pick video duration. */
  duration_seconds_estimate: number;
}

async function publicUrlFor(env: Env, r2_key: string): Promise<string> {
  // Canonical helper: WORKER_URL fallback + /r2/ prefix so the URL is
  // absolute and fetchable by external services (Zernio/KIE) on a fresh install.
  return r2PublicUrl(env, r2_key);
}

/** Wrap raw PCM samples in a 44-byte WAV RIFF header. Used because ElevenLabs
 *  returns headerless PCM under `output_format: "pcm_*"` but downstream
 *  consumers want a real RIFF/WAVE container. */
function wrapPcmAsWav(pcm: Uint8Array, sampleRate: number, channels: number, bitsPerSample: number): ArrayBuffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true); // file size - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"
  // fmt sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // PCM = 16
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);
  // copy samples
  new Uint8Array(buf, 44).set(pcm);
  return buf;
}

/** Synthesize text to speech with the creator's cloned voice and store the
 *  resulting audio in R2. The avatar-reel pipeline passes the returned public
 *  URL to the KIE avatar lipsync model as the audio track. */
export async function elevenlabsTts(env: Env, input: TtsInput): Promise<TtsOutput> {
  const elevenlabsKey = await getCredential(env, "ELEVENLABS_API_KEY");
  if (!elevenlabsKey) {
    throw new Error("ELEVENLABS_API_KEY not set on the Worker — wrangler secret put ELEVENLABS_API_KEY");
  }
  const voiceId = input.voice_id ?? (await env.CONFIG.get("ELEVENLABS_DEFAULT_VOICE_ID"));
  if (!voiceId) throw new Error("no voice_id provided and CONFIG.ELEVENLABS_DEFAULT_VOICE_ID is empty");

  const fmt = input.output_format ?? "mp3_44100_192";
  const modelId = input.model_id ?? "eleven_multilingual_v2";

  const acceptHeader = fmt === "pcm_44100" ? "audio/pcm" : "audio/mpeg";
  const res = await fetch(`${ELEVENLABS_API}/text-to-speech/${voiceId}?output_format=${fmt}`, {
    method: "POST",
    headers: {
      "xi-api-key": elevenlabsKey,
      "Content-Type": "application/json",
      "Accept": acceptHeader,
    },
    body: JSON.stringify({
      text: input.text,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`elevenlabs TTS ${res.status}: ${body.slice(0, 400)}`);
  }
  let bytes = await res.arrayBuffer();
  let ext = fmt.startsWith("mp3") ? "mp3" : "wav";
  let contentType = fmt.startsWith("mp3") ? "audio/mpeg" : "audio/wav";
  // PCM from ElevenLabs is raw 16-bit little-endian samples with no header.
  // Downstream consumers need a real WAV container — wrap PCM in a 44-byte
  // WAV header so the file is a valid RIFF/WAVE.
  if (fmt === "pcm_44100") {
    bytes = wrapPcmAsWav(new Uint8Array(bytes), 44100, 1, 16);
  }

  // Transcode MP3 → PCM-16 WAV via the ffmpeg container for consumers that
  // reject MP3 (kept as a safe default for the KIE avatar lipsync step).
  if (input.transcode_to_wav && fmt.startsWith("mp3")) {
    const form = new FormData();
    form.append("audio", new Blob([bytes], { type: "audio/mpeg" }), "in.mp3");
    const wavRes = await processorFetch(env, "/audio-to-wav", { method: "POST", body: form });
    if (!wavRes.ok) {
      const text = await wavRes.text();
      throw new Error(`audio-to-wav ${wavRes.status}: ${text.slice(0, 300)}`);
    }
    bytes = await wavRes.arrayBuffer();
    ext = "wav";
    contentType = "audio/wav";
  }

  const r2_key = `tts/${input.asset_prefix}-${Date.now()}.${ext}`;
  await env.ASSETS.put(r2_key, bytes, { httpMetadata: { contentType } });

  // 192kbps mp3 ≈ 24KB/s; 16-bit 44.1kHz PCM = 88200 B/s.
  const bitrateBytesPerSec = fmt === "mp3_44100_128" ? 16_000 : fmt === "pcm_44100" ? 88_200 : 24_000;
  const duration = Math.max(1, Math.round(bytes.byteLength / bitrateBytesPerSec));

  return {
    r2_key,
    public_url: await publicUrlFor(env, r2_key),
    duration_seconds_estimate: duration,
  };
}
