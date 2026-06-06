import type { Env } from "../env";
import { insertReelProject, updateReelProject, pendingTextReelForChat } from "../db";
import { tgSendMessage, tgSendMessageWithKeyboard, tgDownloadFile } from "./api";
import { formatPickerKeyboard, shortPid } from "./reel-ui";
import { r2PublicUrl } from "../lib/r2-url";
import { startReelRender } from "../triggers/reel";

// Reel ingest — the front door of the pipeline. A creator either pastes an R2
// video URL (iPhone Shortcut, any size) or attaches a video (<=20 MB via the
// Telegram bot API; bigger files must go through the Shortcut). Either way we
// create a reel_projects row and ask for the format.

const VIDEO_URL_RE = /^https?:\/\/\S+\.(mp4|mov)(\?\S*)?$/i;
const TG_GETFILE_LIMIT = 20 * 1024 * 1024; // api.telegram.org getFile cap

interface TgVideoAttachment {
  file_id: string;
  file_size?: number;
  mime_type?: string;
}

export interface ReelIngestMessage {
  message_id: number;
  text?: string;
  caption?: string;
  video?: TgVideoAttachment;
  document?: TgVideoAttachment & { file_name?: string };
}

/** True if this message should enter the reel pipeline (video attachment or a
 *  pasted .mp4/.mov URL). Checked BEFORE the agent turn in processMessage. */
export function isReelVideoMessage(msg: ReelIngestMessage): boolean {
  if (msg.video) return true;
  if (msg.document?.mime_type?.startsWith("video/")) return true;
  const text = (msg.text ?? msg.caption ?? "").trim();
  return VIDEO_URL_RE.test(text);
}

function newReelId(): string {
  return `reel_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

async function askFormat(env: Env, chatId: number, pid: string): Promise<void> {
  await updateReelProject(env, pid, { awaiting_input: "format" });
  await tgSendMessageWithKeyboard(
    env,
    chatId,
    `Got it. Reel \`${shortPid(pid)}\` uploaded.\n\n**What format?**`,
    formatPickerKeyboard(pid),
  );
}

export async function handleReelIngest(env: Env, chatId: number, msg: ReelIngestMessage): Promise<void> {
  const text = (msg.text ?? msg.caption ?? "").trim();

  // 1. Pasted video URL (iPhone Shortcut path) — any size.
  if (VIDEO_URL_RE.test(text)) {
    const pid = newReelId();
    await insertReelProject(env, {
      id: pid,
      source: "shortcut",
      raw_video_url: text,
      telegram_chat_id: String(chatId),
      telegram_message_id: msg.message_id,
    });
    await askFormat(env, chatId, pid);
    return;
  }

  // 2. Telegram-attached video / video document (<=20 MB).
  const att: TgVideoAttachment | undefined =
    msg.video ?? (msg.document?.mime_type?.startsWith("video/") ? msg.document : undefined);
  if (!att) return;

  if ((att.file_size ?? 0) > TG_GETFILE_LIMIT) {
    await tgSendMessage(
      env,
      chatId,
      "That clip is over 20 MB — past Telegram's bot download limit. Use the iPhone Shortcut to upload it to R2, then paste the link here.",
    );
    return;
  }

  const pid = newReelId();
  await insertReelProject(env, {
    id: pid,
    source: "telegram",
    raw_video_url: "pending",
    telegram_chat_id: String(chatId),
    telegram_message_id: msg.message_id,
  });
  await tgSendMessage(env, chatId, `Got it. Uploading reel \`${shortPid(pid)}\`…`);

  try {
    const buf = await tgDownloadFile(env, att.file_id);
    const ext = att.mime_type === "video/quicktime" ? "mov" : "mp4";
    const key = `reels/${pid}/raw.${ext}`;
    await env.ASSETS.put(key, buf, { httpMetadata: { contentType: att.mime_type ?? "video/mp4" } });
    const url = await r2PublicUrl(env, key);
    await updateReelProject(env, pid, { raw_video_url: url });
    await askFormat(env, chatId, pid);
  } catch (e) {
    await updateReelProject(env, pid, {
      status: "failed",
      error_message: `ingest failed: ${String(e).slice(0, 200)}`,
    });
    await tgSendMessage(
      env,
      chatId,
      "Couldn't pull that video from Telegram (probably over 20 MB). Use the iPhone Shortcut to upload to R2, then paste the URL.",
    );
  }
}

/** Feed a plain-text message into an in-flight B-roll conversation
 *  (topic -> key_points). Returns true if it consumed the message — the caller
 *  must then short-circuit the normal agent turn. */
export async function maybeHandleReelText(env: Env, chatId: number, text: string): Promise<boolean> {
  const t = text.trim();
  if (!t || t.startsWith("/")) return false;
  const pending = await pendingTextReelForChat(env, String(chatId));
  if (!pending) return false;

  if (pending.awaiting_input === "topic") {
    await updateReelProject(env, pending.id, { topic: t.slice(0, 600), awaiting_input: "content" });
    await tgSendMessage(
      env,
      chatId,
      "Got it. What do you want to say? (bullets, key ideas — anything you'd put in the post body.)",
    );
    return true;
  }

  if (pending.awaiting_input === "content") {
    await updateReelProject(env, pending.id, { key_points: t.slice(0, 4000), awaiting_input: null });
    await tgSendMessage(env, chatId, `Generating headline + caption… ✨\nReel \`${shortPid(pending.id)}\``);
    await startReelRender(env, pending.id);
    return true;
  }

  return false;
}
