import type { Env } from "../env";
import {
  tgSendMessage,
  tgSendMessageWithKeyboard,
  tgSendPhoto,
  tgAnswerCallbackQuery,
  tgEditMessageText,
  type InlineKeyboard,
} from "./api";
import {
  loadBrandProfile,
  saveBrandProfile,
  patchBrandSection,
  CAPTION_PRESETS,
  MOTION_PRESETS,
  THUMBNAIL_MODES,
} from "../lib/brand";
import { renderPreview } from "../tools/render-reel";

// The /brand wizard — fully self-serve brand customization from Telegram
// (Captions.ai-style). Preset dimensions (caption / motion / thumbnail) are
// inline-button pickers with a live sample sent back; free-text dimensions
// (accent, fonts, voice, CTA) are `/brand <field> <value>` subcommands.
// Everything writes CONFIG.BRAND_PROFILE, which the render container reads.

function summary(p: Awaited<ReturnType<typeof loadBrandProfile>>): string {
  const cap = p.caption_style?.preset ?? "bold-karaoke (default)";
  const motion = p.motion_style?.preset ?? "skalers-cinematic (default)";
  const thumb = p.thumbnail_style?.mode ?? "overlay (default)";
  const accent = p.palette?.accent ?? "#f8d380 (default)";
  const display = p.fonts?.display ?? "Archivo Black (default)";
  const cta = p.voice?.cta ?? "(default)";
  return [
    "🎨 **Brand kit**",
    `Accent: \`${accent}\``,
    `Fonts: ${display}`,
    `Caption style: ${cap}`,
    `Motion style: ${motion}`,
    `Thumbnail: ${thumb}`,
    `CTA: ${cta}`,
  ].join("\n");
}

function menuKeyboard(): InlineKeyboard {
  return [
    [{ text: "✍️ Caption style", callback_data: "brand_menu:caption" }],
    [{ text: "🎬 Motion style", callback_data: "brand_menu:motion" }],
    [{ text: "🖼 Thumbnail mode", callback_data: "brand_menu:thumb" }],
    [
      { text: "▶ Preview caption", callback_data: "brand_prev:caption" },
      { text: "▶ Preview card", callback_data: "brand_prev:card" },
    ],
  ];
}

function presetKeyboard(prefix: string, presets: readonly string[]): InlineKeyboard {
  const rows: InlineKeyboard = presets.map((p) => [{ text: p, callback_data: `${prefix}:${p}` }]);
  rows.push([{ text: "‹ Back", callback_data: "brand_menu:root" }]);
  return rows;
}

const HELP = [
  "🎨 **Brand kit — /brand**",
  "",
  "Tap a style below to switch it (you'll get a live sample). Or set a field:",
  "`/brand accent #00e5ff` — accent color",
  "`/brand display Montserrat` — display font",
  "`/brand body Inter` — body font",
  "`/brand cta DM GROW to get the system` — call to action",
  "`/brand voice <one line describing your voice>`",
  "`/brand hashtags #ai #growth #content`",
  "`/brand show` — current kit · `/brand reset` — back to defaults",
].join("\n");

export async function handleBrandCommand(env: Env, chatId: number, arg: string): Promise<void> {
  const trimmed = arg.trim();
  const [sub, ...rest] = trimmed.split(/\s+/);
  const value = rest.join(" ").trim();
  const cmd = (sub ?? "").toLowerCase();

  if (!cmd) {
    const p = await loadBrandProfile(env);
    await tgSendMessageWithKeyboard(env, chatId, `${summary(p)}\n\n${HELP}`, menuKeyboard());
    return;
  }
  if (cmd === "show") {
    const p = await loadBrandProfile(env);
    await tgSendMessage(env, chatId, "```\n" + JSON.stringify(p, null, 2) + "\n```", { parse_mode: "Markdown" });
    return;
  }
  if (cmd === "reset") {
    await saveBrandProfile(env, {});
    await tgSendMessage(env, chatId, "Brand kit reset to defaults.");
    return;
  }
  if (cmd === "accent") {
    let hex = value.trim();
    if (hex && !hex.startsWith("#")) hex = "#" + hex;
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
      await tgSendMessage(env, chatId, "Give a hex color, e.g. `/brand accent #00e5ff`", { parse_mode: "Markdown" });
      return;
    }
    await patchBrandSection(env, "palette", { accent: hex });
    await tgSendMessage(env, chatId, `✓ Accent set to \`${hex}\`. Tap Preview to see it.`, { parse_mode: "Markdown" });
    return;
  }
  if (cmd === "display" || cmd === "body" || cmd === "sub") {
    if (!value) {
      await tgSendMessage(env, chatId, `Give a Google-Fonts family, e.g. \`/brand ${cmd} Montserrat\``, { parse_mode: "Markdown" });
      return;
    }
    await patchBrandSection(env, "fonts", { [cmd]: value });
    await tgSendMessage(env, chatId, `✓ ${cmd} font set to ${value}.`);
    return;
  }
  if (cmd === "cta" || cmd === "voice" || cmd === "hashtags") {
    if (!value) {
      await tgSendMessage(env, chatId, `Give the text, e.g. \`/brand ${cmd} ...\``, { parse_mode: "Markdown" });
      return;
    }
    const key = cmd === "cta" ? "cta" : cmd === "voice" ? "prompt" : "hashtags";
    await patchBrandSection(env, "voice", { [key]: value });
    await tgSendMessage(env, chatId, `✓ ${cmd} updated.`);
    return;
  }
  if (cmd === "preview") {
    const kind = (value || "thumbnail").toLowerCase();
    if (kind !== "caption" && kind !== "card" && kind !== "thumbnail") {
      await tgSendMessage(env, chatId, "Preview what? `/brand preview caption|card|thumbnail`", { parse_mode: "Markdown" });
      return;
    }
    await sendPreview(env, chatId, kind);
    return;
  }
  await tgSendMessage(env, chatId, `Unknown: /brand ${cmd}\n\n${HELP}`, { parse_mode: "Markdown" });
}

async function sendPreview(env: Env, chatId: number, kind: "caption" | "card" | "thumbnail"): Promise<void> {
  await tgSendMessage(env, chatId, `Rendering a ${kind} preview…`);
  try {
    const profile = await loadBrandProfile(env);
    const out = await renderPreview(env, { kind, brand_profile: profile });
    if (out.content_type.startsWith("image/")) {
      await tgSendPhoto(env, chatId, out.url, `${kind} preview`);
    } else {
      await tgSendMessage(env, chatId, `${kind} preview: ${out.url}`);
    }
  } catch (e) {
    await tgSendMessage(env, chatId, `Preview failed: ${String(e).slice(0, 200)}`);
  }
}

// ── callbacks (brand_*) ─────────────────────────────────────

interface CallbackQuery {
  id: string;
  from: { id: number };
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

export function isBrandCallback(data: string | undefined): boolean {
  return !!data && data.startsWith("brand_");
}

export async function handleBrandCallback(env: Env, cq: CallbackQuery): Promise<void> {
  if (!cq.message || !cq.data) {
    await tgAnswerCallbackQuery(env, cq.id);
    return;
  }
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;

  const owner = await env.DB.prepare(`SELECT user_id FROM tg_owner WHERE chat_id = ?`)
    .bind(chatId)
    .first<{ user_id: number }>();
  if (!owner || owner.user_id !== cq.from.id) {
    await tgAnswerCallbackQuery(env, cq.id, "Only the bot owner can edit the brand kit.");
    return;
  }

  const [prefix, val] = cq.data.split(":");
  try {
    if (prefix === "brand_menu") {
      await tgAnswerCallbackQuery(env, cq.id);
      if (val === "caption") {
        await tgEditMessageText(env, chatId, messageId, "Pick a **caption style**:", presetKeyboard("brand_cap", CAPTION_PRESETS));
      } else if (val === "motion") {
        await tgEditMessageText(env, chatId, messageId, "Pick a **motion-graphics style**:", presetKeyboard("brand_motion", MOTION_PRESETS));
      } else if (val === "thumb") {
        await tgEditMessageText(env, chatId, messageId, "Pick a **thumbnail mode**:", presetKeyboard("brand_thumb", THUMBNAIL_MODES));
      } else {
        const p = await loadBrandProfile(env);
        await tgEditMessageText(env, chatId, messageId, summary(p), menuKeyboard());
      }
      return;
    }
    if (prefix === "brand_cap") {
      await patchBrandSection(env, "caption_style", { preset: val });
      await tgAnswerCallbackQuery(env, cq.id, `Caption: ${val}`);
      await tgEditMessageText(env, chatId, messageId, `✓ Caption style set to **${val}**. Sending a sample…`);
      await sendPreview(env, chatId, "caption");
      return;
    }
    if (prefix === "brand_motion") {
      await patchBrandSection(env, "motion_style", { preset: val });
      await tgAnswerCallbackQuery(env, cq.id, `Motion: ${val}`);
      await tgEditMessageText(env, chatId, messageId, `✓ Motion style set to **${val}**. Sending a sample card…`);
      if (val !== "off") await sendPreview(env, chatId, "card");
      return;
    }
    if (prefix === "brand_thumb") {
      await patchBrandSection(env, "thumbnail_style", { mode: val as "overlay" | "ai" });
      await tgAnswerCallbackQuery(env, cq.id, `Thumbnail: ${val}`);
      if (val === "ai") {
        await tgEditMessageText(
          env,
          chatId,
          messageId,
          "✓ Thumbnail set to **AI** (Nano Banana Pro, face-accurate). It generates from your reel's cover frame on the next render.",
        );
      } else {
        await tgEditMessageText(env, chatId, messageId, "✓ Thumbnail set to **overlay**. Sending a sample…");
        await sendPreview(env, chatId, "thumbnail");
      }
      return;
    }
    if (prefix === "brand_prev") {
      await tgAnswerCallbackQuery(env, cq.id, "Rendering…");
      await sendPreview(env, chatId, (val as "caption" | "card" | "thumbnail") ?? "thumbnail");
      return;
    }
    await tgAnswerCallbackQuery(env, cq.id, "Unknown");
  } catch (e) {
    await tgAnswerCallbackQuery(env, cq.id, "Error");
    console.error("[brand callback]", String(e));
  }
}
