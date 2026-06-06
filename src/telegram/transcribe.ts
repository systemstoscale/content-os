import type { Env } from "../env";

/** Transcribe a Telegram voice note via Workers AI Whisper.
 *  Telegram voice notes are OGG/Opus; Whisper accepts them directly. */
export async function transcribeVoice(env: Env, audio: ArrayBuffer): Promise<string> {
  const bytes = [...new Uint8Array(audio)];
  const result = (await env.AI.run("@cf/openai/whisper-large-v3-turbo" as never, {
    audio: bytes,
  } as never)) as { text?: string };
  return (result.text ?? "").trim();
}
