import type { Env } from "../env";
import {
  tgSendMessage,
  tgSendChatAction,
  tgSendMediaGroup,
  tgDownloadFile,
} from "../telegram/api";
import { isAuthorizedChat, touchChat } from "../telegram/auth";
import { transcribeVoice } from "../telegram/transcribe";
import { runTelegramTurn, type TgContentBlock } from "../telegram/agent";
import { handleCommand } from "../telegram/commands";

interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TgVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

interface TgVideo {
  file_id: string;
  file_size?: number;
  mime_type?: string;
  duration?: number;
}

interface TgDocument {
  file_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
}

interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  caption?: string;
  voice?: TgVoice;
  photo?: TgPhotoSize[];
  audio?: TgVoice;
  video?: TgVideo;
  document?: TgDocument;
}

interface TgCallbackQuery {
  id: string;
  from: { id: number; username?: string };
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
  data?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export async function handleTelegram(
  req: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (req.method !== "POST") return new Response("POST required", { status: 405 });

  const update = (await req.json()) as TgUpdate;

  // Callback queries (inline-button taps) take a different path — no
  // message-history persistence, no agent invocation. Route to the
  // dedicated handler in src/telegram/callbacks.ts.
  if (update.callback_query) {
    const { handleCallbackQuery } = await import("../telegram/callbacks");
    ctx.waitUntil(handleCallbackQuery(env, update.callback_query));
    return Response.json({ ok: true });
  }

  const msg = update.message;
  if (!msg) return Response.json({ ok: true, skip: "no message" });

  const chat_id = msg.chat.id;
  const user_id = msg.from?.id ?? chat_id;

  if (!(await isAuthorizedChat(env, chat_id, user_id))) {
    return Response.json({ ok: false, error: "unauthorized chat" }, { status: 403 });
  }
  await touchChat(env, chat_id);

  // Dedupe Telegram webhook retries. Telegram resends the same update_id when
  // it doesn't get a fast 200 back, so processMessage was firing N times per
  // user message. INSERT OR IGNORE returns 0 rows changed for duplicates.
  const dedupe = await env.DB.prepare(
    `INSERT OR IGNORE INTO tg_seen_updates (update_id, seen_at) VALUES (?, ?)`
  )
    .bind(update.update_id, Date.now())
    .run();
  if ((dedupe.meta?.changes ?? 0) === 0) {
    return Response.json({ ok: true, deduped: true });
  }

  // Return 200 to Telegram FAST so it doesn't retry-spam. The actual work
  // runs in the background via waitUntil. Workers paid plan keeps the worker
  // alive for several minutes of background fetch I/O after the response.
  ctx.waitUntil(processMessage(env, chat_id, msg));
  return Response.json({ ok: true });
}

async function processMessage(env: Env, chat_id: number, msg: TgMessage): Promise<void> {
  const stage = async (label: string) => {
    console.log(`[tg ${chat_id}] ${label}`);
  };

  try {
    await stage("processMessage start");
    const text = (msg.text ?? msg.caption ?? "").trim();
    await stage(`text="${text.slice(0, 60)}"`);

    if (text.startsWith("/")) {
      if (await handleCommand(env, chat_id, text, msg.message_id)) {
        await stage("slash command handled");
        return;
      }
    }

    // Asset-library interception — runs BEFORE reel ingest so a prefixed
    // attachment (logo: / meme: / sound: ...) becomes an asset, NOT a reel.
    const { isAssetMessage, handleAssetIngest } = await import("../telegram/asset-ingest");
    if (isAssetMessage(msg)) {
      await stage("asset ingest");
      await handleAssetIngest(env, chat_id, msg);
      return;
    }

    // Reel pipeline interception — runs BEFORE the agent turn.
    // 1. A video attachment / pasted .mp4|.mov URL starts a new reel.
    // 2. A plain-text reply continues an in-flight B-roll conversation
    //    (topic -> key points).
    const { isReelVideoMessage, handleReelIngest, maybeHandleReelText } = await import(
      "../telegram/reel-ingest"
    );
    if (isReelVideoMessage(msg)) {
      await stage("reel ingest");
      await handleReelIngest(env, chat_id, msg);
      return;
    }
    if (text && !text.startsWith("/") && (await maybeHandleReelText(env, chat_id, text))) {
      await stage("reel b-roll text consumed");
      return;
    }

    await tgSendChatAction(env, chat_id, "typing");
    // Contextual ack based on the request shape so it doesn't feel like a
    // generic auto-reply. Skip the ack for very short messages (<8 chars)
    // since those round-trip fast enough that an ack adds noise.
    if (text.length >= 8 || msg.voice || msg.audio || (msg.photo && msg.photo.length > 0)) {
      await tgSendMessage(env, chat_id, ackHint(text, msg));
      await stage("ack sent");
    }

    const blocks: TgContentBlock[] = [];

    const voice = msg.voice ?? msg.audio;
    if (voice) {
      try {
        await stage("voice download start");
        const audio = await tgDownloadFile(env, voice.file_id);
        await stage(`voice downloaded ${audio.byteLength} bytes`);
        const transcript = await transcribeVoice(env, audio);
        await stage(`transcript="${transcript.slice(0, 60)}"`);
        if (transcript) blocks.push({ type: "text", text: `[voice transcript] ${transcript}` });
      } catch (e) {
        console.error("voice transcription failed", e);
        await tgSendMessage(env, chat_id, "I couldn't transcribe that voice note. Please try again, or send your idea as text.");
        return;
      }
    }

    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo.reduce((a, b) => (a.width >= b.width ? a : b));
      try {
        const bytes = await tgDownloadFile(env, largest.file_id);
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: arrayBufferToBase64(bytes) },
        });
      } catch (e) {
        await tgSendMessage(env, chat_id, `photo download failed: ${e}`);
      }
    }

    if (text && !text.startsWith("/")) {
      blocks.push({ type: "text", text });
    }

    if (blocks.length === 0) {
      await tgSendMessage(env, chat_id, "Send me text, a voice note, or a photo with a caption.");
      return;
    }

    await stage(`runTelegramTurn start (${blocks.length} blocks)`);
    const result = await runTelegramTurn(env, chat_id, blocks);
    await stage(
      `runTelegramTurn done: text=${result.finalText.length}c, toolCalls=${result.toolCalls.length}, images=${result.imagesProduced.length}, tokensIn=${result.tokensIn}, tokensOut=${result.tokensOut}`
    );

    // Rendered media handling depends on slide count:
    // - 0 images: just send the text reply
    // - 1 image: send text (Telegram auto-previews the URL inline as a thumbnail)
    // - 2+ images (carousel): send the text reply + a Telegram media group album
    //   so all slides are visible at once instead of just slide 1's preview.
    const images = result.imagesProduced;
    if (result.finalText) {
      await tgSendMessage(env, chat_id, result.finalText);
      await stage("final text sent");
    } else if (images.length === 0) {
      await tgSendMessage(env, chat_id, "(agent returned empty response — check logs)");
    }
    if (images.length >= 2) {
      await tgSendMediaGroup(env, chat_id, images);
      await stage(`album sent (${images.length} slides)`);
    }
    await stage("done");
  } catch (e) {
    const msg = `error: ${String(e).slice(0, 500)}`;
    console.error(`[tg ${chat_id}] ${msg}`, e);
    try {
      await tgSendMessage(env, chat_id, msg);
    } catch (sendErr) {
      console.error(`[tg ${chat_id}] also failed to send error to user:`, sendErr);
    }
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Pick a contextual ack message based on what the user sent.
 *  Voice + photo win over text. Within text, look for content-type keywords
 *  so the ack tells the creator what's coming. */
function ackHint(text: string, msg: TgMessage): string {
  if (msg.voice || msg.audio) return "🎙️  Heard you. Transcribing and thinking…";
  if (msg.photo && msg.photo.length > 0) return "🖼️  Got the photo. Looking + thinking…";

  const t = text.toLowerCase();
  if (/\bcarousel\b/.test(t)) return "🎠  Carousel coming up — multi-slide takes ~30–60s. Rendering…";
  if (/\bquote\b/.test(t)) return "✍️  Drafting your quote post…";
  if (/\bthumbnail\b/.test(t)) return "🖼️  Designing the thumbnail…";
  if (/\breel\b/.test(t) || /\bvideo\b/.test(t)) return "🎬  Reel pipeline kicking in…";
  if (/\b(youtube|long.?form)\b/.test(t)) return "📺  YouTube long-form mode. Transcript + chapters + titles incoming…";
  if (/\b(ad|ads|meta)\b/.test(t)) return "📣  Meta Ads draft kicking off…";
  if (/\bship\b/.test(t)) return "🚀  Publishing now…";

  // Generic fallback — pick from a small variety so it doesn't feel templated
  const variants = [
    "🤖  On it.",
    "🤖  Drafting now…",
    "🤖  Thinking on this one…",
    "🤖  Working on it…",
  ];
  const idx = Math.abs(hashString(text)) % variants.length;
  return variants[idx]!;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
