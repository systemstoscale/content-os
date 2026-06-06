import type { Env } from "../env";
import { tgSendMessageWithKeyboard, type InlineKeyboard } from "./api";
import type { ReelProjectRow } from "../db";

// Shared Telegram UI for the reel pipeline — the inline keyboards + the
// "Reel ready" preview card. Used by BOTH the render workflow (fires the card
// when a reel finishes) and the callback handler (rebuilds keyboards on tap).
// Keyboard text is markdown; tgSendMessageWithKeyboard converts it to Telegram
// HTML, so never hand-write HTML tags here.
//
// callback_data contract (all <64 bytes):
//   reel_fmt:th:<pid>     reel_fmt:br:<pid>
//   reel_fmt:thfull:<pid> reel_fmt:thraw:<pid>
//   reel_pub:<pid>  reel_q:<pid>  reel_sch:<pid>  reel_at:<pid>:<epoch_ms>
//   reel_rr:<pid>   reel_cx:<pid>

/** Short id for chat display (full uuid is too long for a card). */
export const shortPid = (id: string): string => id.slice(0, 8);

/** First keyboard after a video lands: pick the pipeline. */
export function formatPickerKeyboard(pid: string): InlineKeyboard {
  return [
    [
      { text: "🎤 Talking head", callback_data: `reel_fmt:th:${pid}` },
      { text: "📹 B-roll", callback_data: `reel_fmt:br:${pid}` },
    ],
    [{ text: "✖ Cancel", callback_data: `reel_cx:${pid}` }],
  ];
}

/** Second keyboard after "Talking head": full edit vs raw passthrough. */
export function thStyleKeyboard(pid: string): InlineKeyboard {
  return [
    [{ text: "✨ Captions + motion graphics", callback_data: `reel_fmt:thfull:${pid}` }],
    [{ text: "📤 Post raw (no edits)", callback_data: `reel_fmt:thraw:${pid}` }],
    [{ text: "✖ Cancel", callback_data: `reel_cx:${pid}` }],
  ];
}

/** The action card shown when a reel is rendered + ready. */
export function readyKeyboard(pid: string): InlineKeyboard {
  return [
    [
      { text: "▶ Publish now", callback_data: `reel_pub:${pid}` },
      { text: "📋 Add to queue", callback_data: `reel_q:${pid}` },
      { text: "📅 Schedule", callback_data: `reel_sch:${pid}` },
    ],
    [
      { text: "🔁 Re-render", callback_data: `reel_rr:${pid}` },
      { text: "✖ Cancel", callback_data: `reel_cx:${pid}` },
    ],
  ];
}

/** Schedule preset picker. Each preset carries its target instant as epoch-ms
 *  in the callback_data so the handler stores it verbatim (no re-derivation). */
export function scheduleKeyboard(
  pid: string,
  presets: Array<{ label: string; ms: number }>,
): InlineKeyboard {
  const rows: InlineKeyboard = presets.map((p) => [
    { text: p.label, callback_data: `reel_at:${pid}:${p.ms}` },
  ]);
  rows.push([{ text: "✖ Cancel", callback_data: `reel_cx:${pid}` }]);
  return rows;
}

/** Build the "Reel ready" card text (markdown) from a project row. */
export function reelReadyText(project: ReelProjectRow): string {
  const cap = project.caption_payload;
  const headline = (cap?.headline ?? "").trim() || "Reel ready.";
  const body = (cap?.body ?? "").trim();
  const links = [
    project.edited_url ? `[preview](${project.edited_url})` : "",
    project.thumbnail_url ? `[thumbnail](${project.thumbnail_url})` : "",
  ]
    .filter(Boolean)
    .join(" • ");
  return [
    `✨ **Reel ready**${links ? " — " + links : ""}`,
    ``,
    `**${headline}**`,
    body,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Send the ready card with the action keyboard. Returns the message_id so the
 *  workflow can store it for later in-place edits. */
export async function sendReelReadyCard(env: Env, project: ReelProjectRow): Promise<number | null> {
  if (!project.telegram_chat_id) return null;
  const chatId = Number(project.telegram_chat_id);
  if (!Number.isFinite(chatId)) return null;
  const res = await tgSendMessageWithKeyboard(
    env,
    chatId,
    reelReadyText(project),
    readyKeyboard(project.id),
  );
  return res?.message_id ?? null;
}
