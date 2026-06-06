import type { Env } from "../env";
import {
  tgSendMessage,
  tgSendPhoto,
  tgSendMediaGroup,
  tgSendDocument,
  tgSendMessageWithKeyboard,
} from "../telegram/api";

export interface SendPreviewTelegramInput {
  message: string;
  asset_urls?: string[];
  /** Optional video URL — sent as a document attachment so the creator can
   *  download/inspect locally instead of relying on Telegram's video preview. */
  video_url?: string;
}

export interface SendPreviewTelegramOutput {
  ok: boolean;
  chat_id?: number;
  error?: string;
}

/** Resolve the chat to notify. Order:
 *    1. env.TELEGRAM_CHAT_ID if set (operator override).
 *    2. tg_owner row in D1 (the first user who claimed the bot).
 *  Returns null if neither is set — caller should treat as "no telegram path". */
async function resolveChatId(env: Env): Promise<number | null> {
  const envChat = env.TELEGRAM_CHAT_ID;
  if (envChat && envChat.trim()) {
    const n = Number(envChat);
    if (Number.isFinite(n)) return n;
  }
  const row = (await env.DB.prepare(`SELECT chat_id FROM tg_owner LIMIT 1`).first<{ chat_id: number }>()) ?? null;
  return row?.chat_id ?? null;
}

export async function sendPreviewTelegram(
  env: Env,
  input: SendPreviewTelegramInput
): Promise<SendPreviewTelegramOutput> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN not set — bot not configured" };
  }
  const chat_id = await resolveChatId(env);
  if (chat_id == null) {
    return { ok: false, error: "no telegram chat captured yet (DM the bot once to claim ownership)" };
  }

  try {
    await tgSendMessage(env, chat_id, input.message);

    const images = (input.asset_urls ?? []).filter((u) => /\.(png|jpg|jpeg|webp)(\?|$)/i.test(u));
    if (images.length === 1) {
      // Single thumbnail / single static image — sendPhoto renders larger than
      // a media group of 1, and Telegram rejects mediaGroup with <2 items anyway.
      await tgSendPhoto(env, chat_id, images[0]!);
    } else if (images.length >= 2) {
      await tgSendMediaGroup(env, chat_id, images);
    }

    if (input.video_url) {
      await tgSendDocument(env, chat_id, input.video_url);
    }
    return { ok: true, chat_id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── notify_draft_ready ──────────────────────────────────────────────────────

export interface NotifyDraftReadyInput {
  draft_id: string;
  /** Optional human summary line under the headline. The agent's "what
   *  did you make" sentence — kept short so the inline keyboard stays
   *  the visual focus. */
  summary?: string;
}

export interface NotifyDraftReadyOutput {
  ok: boolean;
  message_id?: number;
  chat_id?: number;
  error?: string;
}

/** Send the owner a draft-ready DM with [Approve] [Reject] [Publish] inline
 *  buttons. Replaces the old "ask the user to manually `/list` then `/ship`"
 *  discovery flow. Callback handler lives in src/telegram/callbacks.ts. */
export async function notifyDraftReady(
  env: Env,
  input: NotifyDraftReadyInput,
): Promise<NotifyDraftReadyOutput> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    // Bot not configured — this is a no-op, NOT a failure. Posting flow
    // still completes via email preview.
    return { ok: false, error: "telegram bot not configured" };
  }
  const chat_id = await resolveChatId(env);
  if (chat_id == null) {
    return { ok: false, error: "no telegram chat captured yet" };
  }

  const text = [
    `📝 <b>Draft ready</b>: <code>${input.draft_id}</code>`,
    input.summary ? `\n${input.summary.slice(0, 600)}` : null,
  ]
    .filter(Boolean)
    .join("");

  try {
    const result = await tgSendMessageWithKeyboard(env, chat_id, text, [
      [
        { text: "✓ Approve", callback_data: `approve:${input.draft_id}` },
        { text: "✗ Reject", callback_data: `reject:${input.draft_id}` },
      ],
      [{ text: "🚀 Publish now", callback_data: `publish:${input.draft_id}` }],
    ]);
    return { ok: true, chat_id, message_id: result?.message_id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
