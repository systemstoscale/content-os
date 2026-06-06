import type { Env } from "../env";
import { insertAsset } from "../db";
import { tgSendMessage, tgDownloadFile } from "./api";
import { r2PublicUrl } from "../lib/r2-url";

// Asset ingest — the front door of the asset library. A creator drops a meme,
// logo, sound, screenshot, or b-roll clip into Telegram with a caption prefix
// (asset: / save: / meme: / logo: / sound: / screenshot: / thumbnail: / broll:)
// AND an attachment. We store the bytes in R2 and index a row in `assets` so
// the agent can pull it into an edit later (search_assets / list_assets).
//
// Checked BEFORE the reel-ingest interception in processMessage so a `logo:`
// photo becomes an asset, not a reel.

interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TgFileAttachment {
  file_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
}

export interface AssetIngestMessage {
  message_id: number;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  video?: TgFileAttachment;
  document?: TgFileAttachment;
  audio?: TgFileAttachment;
  voice?: TgFileAttachment;
}

/** Prefix -> asset kind. The prefix must be the first token of the caption. */
const PREFIX_KIND: Record<string, string> = {
  asset: "other",
  save: "other",
  meme: "meme",
  sound: "sound",
  logo: "logo",
  screenshot: "screenshot",
  thumbnail: "thumbnail",
  broll: "broll",
};

const PREFIX_RE = new RegExp(
  `^(${Object.keys(PREFIX_KIND).join("|")})\\s*:`,
  "i",
);

/** True when the message text/caption starts with an asset prefix AND carries
 *  a photo / video / document / audio attachment. */
export function isAssetMessage(msg: AssetIngestMessage): boolean {
  const text = (msg.text ?? msg.caption ?? "").trim();
  if (!PREFIX_RE.test(text)) return false;
  return Boolean(
    (msg.photo && msg.photo.length > 0) ||
      msg.video ||
      msg.document ||
      msg.audio ||
      msg.voice,
  );
}

function newAssetId(): string {
  return `asset_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

interface PickedAttachment {
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

/** Pick the largest / most relevant attachment from the message. Photos are
 *  arrays of sizes (Telegram resends every resolution) — take the widest. */
function pickAttachment(msg: AssetIngestMessage): PickedAttachment | null {
  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo.reduce((a, b) => (a.width >= b.width ? a : b));
    return { file_id: largest.file_id, mime_type: "image/jpeg" };
  }
  if (msg.video) return { file_id: msg.video.file_id, mime_type: msg.video.mime_type, file_name: msg.video.file_name };
  if (msg.document)
    return { file_id: msg.document.file_id, mime_type: msg.document.mime_type, file_name: msg.document.file_name };
  if (msg.audio) return { file_id: msg.audio.file_id, mime_type: msg.audio.mime_type, file_name: msg.audio.file_name };
  if (msg.voice) return { file_id: msg.voice.file_id, mime_type: msg.voice.mime_type };
  return null;
}

/** Derive a file extension from a mime type / filename, defaulting to bin. */
function extFor(mime: string | undefined, fileName: string | undefined): string {
  if (fileName && fileName.includes(".")) {
    const e = fileName.split(".").pop();
    if (e && /^[a-z0-9]{1,5}$/i.test(e)) return e.toLowerCase();
  }
  const m = (mime ?? "").toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/gif") return "gif";
  if (m === "image/webp") return "webp";
  if (m === "video/mp4") return "mp4";
  if (m === "video/quicktime") return "mov";
  if (m === "audio/mpeg" || m === "audio/mp3") return "mp3";
  if (m === "audio/ogg") return "ogg";
  if (m === "audio/wav" || m === "audio/x-wav") return "wav";
  if (m.startsWith("image/")) return m.split("/")[1] ?? "img";
  if (m.startsWith("video/")) return m.split("/")[1] ?? "mp4";
  if (m.startsWith("audio/")) return m.split("/")[1] ?? "mp3";
  return "bin";
}

/** Strip the prefix token and pull inline `name=` / `project=` / `category=`
 *  directives out of the remaining caption. Returns the cleaned description
 *  (whatever's left after directives are removed) + parsed fields. */
function parseCaption(text: string): {
  kind: string;
  name: string | null;
  project: string | null;
  category: string | null;
  description: string | null;
} {
  const prefixMatch = text.match(PREFIX_RE);
  const prefix = (prefixMatch?.[1] ?? "asset").toLowerCase();
  const kind = PREFIX_KIND[prefix] ?? "other";
  let rest = text.replace(PREFIX_RE, "").trim();

  const grab = (key: string): string | null => {
    // Match `key=value` where value runs until the next ` key=` directive or end.
    const re = new RegExp(`(?:^|\\s)${key}=("[^"]*"|'[^']*'|\\S+)`, "i");
    const m = rest.match(re);
    if (!m) return null;
    rest = rest.replace(m[0], " ").trim();
    return m[1]!.replace(/^["']|["']$/g, "").trim() || null;
  };

  const name = grab("name");
  const project = grab("project");
  const category = grab("category");
  const description = rest.replace(/\s+/g, " ").trim() || null;
  return { kind, name, project, category, description };
}

/** Download the attachment, store it in R2, and index it in the assets table.
 *  Replies to the creator with a confirmation. */
export async function handleAssetIngest(
  env: Env,
  chatId: number,
  msg: AssetIngestMessage,
): Promise<void> {
  const text = (msg.text ?? msg.caption ?? "").trim();
  const { kind, name, project, category, description } = parseCaption(text);

  const att = pickAttachment(msg);
  if (!att) {
    await tgSendMessage(
      env,
      chatId,
      "I see an asset prefix but no file attached. Send the photo/video/file together with the caption.",
    );
    return;
  }

  const id = newAssetId();
  try {
    const buf = await tgDownloadFile(env, att.file_id);
    const ext = extFor(att.mime_type, att.file_name);
    const key = `assets/${kind}/${id}.${ext}`;
    await env.ASSETS.put(key, buf, {
      httpMetadata: { contentType: att.mime_type ?? "application/octet-stream" },
    });
    const publicUrl = await r2PublicUrl(env, key);

    await insertAsset(env, {
      id,
      kind,
      category,
      project,
      name: name ?? att.file_name ?? null,
      description,
      tags: null,
      r2_key: key,
      public_url: publicUrl,
      mime_type: att.mime_type ?? null,
      source: "telegram",
      telegram_chat_id: String(chatId),
    });

    const meta = [
      `**Saved to your asset library.**`,
      `Kind: \`${kind}\``,
      name ? `Name: ${name}` : null,
      project ? `Project: ${project}` : null,
      category ? `Category: ${category}` : null,
      ``,
      publicUrl,
      ``,
      `I can pull this into an edit later — just ask (\`search_assets\`).`,
    ]
      .filter(Boolean)
      .join("\n");
    await tgSendMessage(env, chatId, meta);
  } catch (e) {
    await tgSendMessage(
      env,
      chatId,
      `Couldn't save that asset: ${String(e).slice(0, 200)} (files over 20 MB exceed Telegram's bot download limit).`,
    );
  }
}
