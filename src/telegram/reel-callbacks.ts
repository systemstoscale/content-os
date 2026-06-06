import type { Env } from "../env";
import { getReelProject, updateReelProject } from "../db";
import { tgAnswerCallbackQuery, tgEditMessageText, tgSendMessage } from "./api";
import { thStyleKeyboard, scheduleKeyboard, shortPid } from "./reel-ui";
import { startReelRender } from "../triggers/reel";
import { publishReel } from "../tools/reel-publish";
import { schedulePresets, nextQueueSlotMs, formatSlotLabel, creatorTimezone } from "../lib/schedule";

// Inline-button handlers for the reel pipeline. Dispatched from
// handleCallbackQuery ahead of the generic draft path whenever the
// callback_data starts with "reel_".
//
//   reel_fmt:th|br|thfull|thraw:<pid>   reel_pub:<pid>   reel_q:<pid>
//   reel_sch:<pid>   reel_at:<pid>:<epoch_ms>   reel_rr:<pid>   reel_cx:<pid>

interface CallbackQuery {
  id: string;
  from: { id: number; username?: string };
  message?: { message_id: number; chat: { id: number }; text?: string };
  data?: string;
}

export function isReelCallback(data: string | undefined): boolean {
  return !!data && data.startsWith("reel_");
}

export async function handleReelCallback(env: Env, cq: CallbackQuery): Promise<void> {
  if (!cq.message || !cq.data) {
    await tgAnswerCallbackQuery(env, cq.id);
    return;
  }
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;

  // Owner gate — single-tenant bot; only the paired owner manages reels.
  const owner = await env.DB.prepare(`SELECT user_id FROM tg_owner WHERE chat_id = ?`)
    .bind(chatId)
    .first<{ user_id: number }>();
  if (!owner || owner.user_id !== cq.from.id) {
    await tgAnswerCallbackQuery(env, cq.id, "Only the bot owner can manage reels.");
    return;
  }

  const parts = cq.data.split(":");
  const prefix = parts[0];

  try {
    if (prefix === "reel_fmt") {
      await handleFormatPick(env, cq, chatId, messageId, parts[1] ?? "", parts[2] ?? "");
      return;
    }
    if (prefix === "reel_at") {
      await handleScheduleAt(env, cq, chatId, messageId, parts[1] ?? "", Number(parts[2]));
      return;
    }
    const pid = parts[1] ?? "";
    switch (prefix) {
      case "reel_pub":
        return await handlePublishNow(env, cq, chatId, messageId, pid);
      case "reel_q":
        return await handleQueue(env, cq, chatId, messageId, pid);
      case "reel_sch":
        return await handleScheduleOpen(env, cq, chatId, messageId, pid);
      case "reel_rr":
        return await handleRerender(env, cq, chatId, messageId, pid);
      case "reel_cx":
        return await handleCancel(env, cq, chatId, messageId, pid);
      default:
        await tgAnswerCallbackQuery(env, cq.id, "Unknown action");
    }
  } catch (e) {
    await tgAnswerCallbackQuery(env, cq.id, "Internal error");
    console.error("[reel callback]", String(e));
  }
}

async function handleFormatPick(
  env: Env,
  cq: CallbackQuery,
  chatId: number,
  messageId: number,
  code: string,
  pid: string,
): Promise<void> {
  const project = await getReelProject(env, pid);
  if (!project) {
    await tgAnswerCallbackQuery(env, cq.id, "Reel not found");
    return;
  }
  if (!project.raw_video_url || project.raw_video_url === "pending") {
    await tgAnswerCallbackQuery(env, cq.id, "No source video");
    return;
  }

  if (code === "th") {
    await updateReelProject(env, pid, { format: "talking_head", awaiting_input: "th_style" });
    await tgAnswerCallbackQuery(env, cq.id, "Talking head");
    await tgEditMessageText(
      env,
      chatId,
      messageId,
      `🎤 Talking head, reel \`${shortPid(pid)}\`.\n\nBurn captions + add motion graphics, or post the raw video as-is?`,
      thStyleKeyboard(pid),
    );
    return;
  }

  if (code === "thfull" || code === "thraw") {
    const format = code === "thraw" ? "raw" : "talking_head";
    await updateReelProject(env, pid, { format, awaiting_input: null });
    await tgAnswerCallbackQuery(
      env,
      cq.id,
      code === "thraw" ? "Raw — writing caption…" : "Editing…",
    );
    await tgEditMessageText(
      env,
      chatId,
      messageId,
      code === "thraw"
        ? `📤 Raw post. Nothing added on top — transcribing to write the caption for reel \`${shortPid(pid)}\`…`
        : `✨ Full edit. Editing reel \`${shortPid(pid)}\`…`,
    );
    await startReelRender(env, pid);
    return;
  }

  if (code === "br") {
    await updateReelProject(env, pid, { format: "broll", awaiting_input: "topic" });
    await tgAnswerCallbackQuery(env, cq.id, "B-roll");
    await tgEditMessageText(
      env,
      chatId,
      messageId,
      `📹 B-roll, reel \`${shortPid(pid)}\`.\n\nWhat's the topic of this reel?`,
    );
    return;
  }

  await tgAnswerCallbackQuery(env, cq.id, "Unknown format");
}

async function handlePublishNow(
  env: Env,
  cq: CallbackQuery,
  chatId: number,
  messageId: number,
  pid: string,
): Promise<void> {
  await tgAnswerCallbackQuery(env, cq.id, "Publishing…");
  await tgEditMessageText(env, chatId, messageId, `🚀 Publishing reel \`${shortPid(pid)}\`…`);
  const res = await publishReel(env, pid);
  if (res.ok) {
    await tgEditMessageText(
      env,
      chatId,
      messageId,
      `✅ Published reel \`${shortPid(pid)}\`.\nZernio post: \`${res.zernio_post_id ?? "—"}\``,
    );
  } else {
    await tgEditMessageText(
      env,
      chatId,
      messageId,
      `❌ Publish failed for \`${shortPid(pid)}\`: ${(res.error ?? "unknown").slice(0, 300)}`,
    );
  }
}

async function handleQueue(
  env: Env,
  cq: CallbackQuery,
  chatId: number,
  messageId: number,
  pid: string,
): Promise<void> {
  const ms = await nextQueueSlotMs(env, String(chatId), Date.now());
  const tz = await creatorTimezone(env);
  await updateReelProject(env, pid, { status: "scheduled", scheduled_for: ms, error_message: null });
  await tgAnswerCallbackQuery(env, cq.id, "Queued");
  await tgEditMessageText(
    env,
    chatId,
    messageId,
    `📋 Reel \`${shortPid(pid)}\` queued for ${formatSlotLabel(ms, tz)} (${tz}).`,
  );
}

async function handleScheduleOpen(
  env: Env,
  cq: CallbackQuery,
  chatId: number,
  messageId: number,
  pid: string,
): Promise<void> {
  const presets = await schedulePresets(env, Date.now());
  await tgAnswerCallbackQuery(env, cq.id);
  await tgEditMessageText(
    env,
    chatId,
    messageId,
    `When should reel \`${shortPid(pid)}\` go out?`,
    scheduleKeyboard(pid, presets),
  );
}

async function handleScheduleAt(
  env: Env,
  cq: CallbackQuery,
  chatId: number,
  messageId: number,
  pid: string,
  ms: number,
): Promise<void> {
  if (!Number.isFinite(ms)) {
    await tgAnswerCallbackQuery(env, cq.id, "Bad time");
    return;
  }
  const tz = await creatorTimezone(env);
  await updateReelProject(env, pid, { status: "scheduled", scheduled_for: ms, error_message: null });
  await tgAnswerCallbackQuery(env, cq.id, "Scheduled");
  await tgEditMessageText(
    env,
    chatId,
    messageId,
    `📅 Reel \`${shortPid(pid)}\` scheduled for ${formatSlotLabel(ms, tz)} (${tz}).`,
  );
}

async function handleRerender(
  env: Env,
  cq: CallbackQuery,
  chatId: number,
  messageId: number,
  pid: string,
): Promise<void> {
  const project = await getReelProject(env, pid);
  if (!project || !project.raw_video_url || project.raw_video_url === "pending") {
    await tgAnswerCallbackQuery(env, cq.id, "No source");
    return;
  }
  await tgAnswerCallbackQuery(env, cq.id, "Re-rendering…");
  await tgEditMessageText(env, chatId, messageId, `🔁 Re-rendering reel \`${shortPid(pid)}\`…`);
  // startReelRender re-uses the row's stored format / topic / key_points.
  await startReelRender(env, pid);
}

async function handleCancel(
  env: Env,
  cq: CallbackQuery,
  chatId: number,
  messageId: number,
  pid: string,
): Promise<void> {
  await updateReelProject(env, pid, { status: "cancelled" });
  await tgAnswerCallbackQuery(env, cq.id, "Cancelled");
  await tgEditMessageText(env, chatId, messageId, `✖ Reel \`${shortPid(pid)}\` cancelled.`);
}
