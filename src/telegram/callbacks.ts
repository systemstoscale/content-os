import type { Env } from "../env";
import { getDraft, markDraftStatus } from "../db";
import { tgAnswerCallbackQuery, tgEditMessageText } from "./api";

/** Telegram callback_query handler.
 *
 *  When the user taps an Approve / Reject / Publish button on a "draft
 *  ready" message, Telegram sends us a callback_query update. The button's
 *  `callback_data` is a colon-separated `action:draft_id` payload — we
 *  parse it, validate the chat owner against `tg_owner`, flip the draft's
 *  status (or publish it), then edit the original message in place to
 *  reflect the new state.
 *
 *  The 64-byte callback_data limit is comfortable for `approve:dft_<16hex>`. */

interface CallbackQuery {
  id: string;
  from: { id: number; username?: string };
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
  data?: string; // "approve:dft_xxx" / "reject:dft_xxx" / "publish:dft_xxx"
}

export async function handleCallbackQuery(
  env: Env,
  cq: CallbackQuery,
): Promise<void> {
  if (!cq.message || !cq.data) {
    // Malformed update — nothing actionable. Dismiss the spinner.
    await tgAnswerCallbackQuery(env, cq.id);
    return;
  }

  // Reel pipeline buttons (format pick / publish / schedule / queue / re-render
  // / cancel) have their own dispatch + owner gate. Route before the draft path.
  if (cq.data.startsWith("reel_")) {
    const { handleReelCallback } = await import("./reel-callbacks");
    await handleReelCallback(env, cq);
    return;
  }

  // Brand-kit wizard buttons (caption/motion/thumbnail preset pickers + previews).
  if (cq.data.startsWith("brand_")) {
    const { handleBrandCallback } = await import("./brand-wizard");
    await handleBrandCallback(env, cq);
    return;
  }

  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;

  // Owner check — only the bot owner (the user captured in tg_owner) can
  // act on a draft. Stranger taps get a polite rejection without changing
  // any state. (Bot is single-tenant in v1.)
  const owner = await env.DB.prepare(`SELECT user_id FROM tg_owner WHERE chat_id = ?`)
    .bind(chatId)
    .first<{ user_id: number }>();
  if (!owner || owner.user_id !== cq.from.id) {
    await tgAnswerCallbackQuery(env, cq.id, "Only the bot owner can approve drafts.");
    return;
  }

  const [actionRaw, ...rest] = cq.data.split(":");
  const action = (actionRaw ?? "").toLowerCase();
  const draftId = rest.join(":");
  if (!action || !draftId) {
    await tgAnswerCallbackQuery(env, cq.id, "Malformed callback data.");
    return;
  }

  const draft = await getDraft(env, draftId);
  if (!draft) {
    await tgAnswerCallbackQuery(env, cq.id, `Draft ${draftId} not found.`);
    await tgEditMessageText(env, chatId, messageId, `❌ Draft ${draftId} not found (deleted?).`);
    return;
  }
  if (draft.status === "published") {
    await tgAnswerCallbackQuery(env, cq.id, "Already published.");
    return;
  }

  const ts = new Date().toLocaleString("en-US", { timeStyle: "short", dateStyle: "short" });

  try {
    if (action === "approve") {
      await markDraftStatus(env, draftId, "approved");
      await tgEditMessageText(
        env,
        chatId,
        messageId,
        `✓ Approved by you · ${ts}\n\nDraft: <code>${draftId}</code>\nCron will publish it next; tap "Publish now" if you want to ship immediately.`,
        [[{ text: "🚀 Publish now", callback_data: `publish:${draftId}` }]],
      );
      await tgAnswerCallbackQuery(env, cq.id, "Approved ✓");
      return;
    }

    if (action === "reject") {
      await markDraftStatus(env, draftId, "rejected");
      await tgEditMessageText(
        env,
        chatId,
        messageId,
        `✗ Rejected by you · ${ts}\n\nDraft: <code>${draftId}</code>`,
      );
      await tgAnswerCallbackQuery(env, cq.id, "Rejected ✗");
      return;
    }

    if (action === "publish") {
      // Lazy import to keep this module light.
      const { publishDraftById } = await import("../tools/drafts");
      const result = await publishDraftById(env, draftId).catch(
        (e) => ({ ok: false as const, draft_id: draftId, error: String(e) }),
      );
      if (result.ok) {
        await tgEditMessageText(
          env,
          chatId,
          messageId,
          `🚀 Published · ${ts}\n\nDraft: <code>${draftId}</code>\nZernio: <code>${result.zernio_post_id ?? "—"}</code>`,
        );
        await tgAnswerCallbackQuery(env, cq.id, "Published 🚀");
      } else {
        await tgEditMessageText(
          env,
          chatId,
          messageId,
          `❌ Publish failed · ${ts}\n\nDraft: <code>${draftId}</code>\n<code>${(result.error ?? "unknown").slice(0, 300)}</code>`,
        );
        await tgAnswerCallbackQuery(env, cq.id, "Publish failed");
      }
      return;
    }

    await tgAnswerCallbackQuery(env, cq.id, `Unknown action: ${action}`);
  } catch (e) {
    await tgAnswerCallbackQuery(env, cq.id, "Internal error");
    console.error("[tg callback]", String(e));
  }
}
