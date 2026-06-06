/**
 * Emoji glyphs for Telegram messages — the Worker-side mirror of the SPA's
 * ui/src/lib/labels.ts. Telegram can't use Tailwind colors, so this is
 * emoji-only. Keep the two files in sync when adding enum values.
 */

const LEAD: Record<string, string> = {
  discovered: "🔍",
  enriching: "⚗️",
  ready: "✅",
  pushed: "🚀",
  replied: "💬",
  booked: "📅",
  disqualified: "⛔",
  suppressed: "🚫",
};
const DRAFT: Record<string, string> = {
  pending: "🟡",
  approved: "✅",
  published: "🚀",
  rejected: "✗",
  failed: "⚠️",
};
const FORMAT: Record<string, string> = {
  carousel: "🎠",
  quote: "💬",
  quote_post: "💬",
  single_image: "🖼️",
  image: "🖼️",
  reel: "🎬",
  youtube: "📺",
  meta_ads: "📣",
  thumbnail: "🖼️",
  text: "📝",
  thread: "🧵",
};
const CHANNEL: Record<string, string> = {
  email: "📧",
  linkedin: "💬",
  linkedin_message: "💬",
  call: "☎️",
  sms: "📱",
  dm: "💬",
};
const CAMPAIGN: Record<string, string> = {
  ACTIVE: "🟢",
  PAUSED: "⏸️",
  ARCHIVED: "🗄️",
  DELETED: "🗑️",
};

const lower = (m: Record<string, string>, k: string | null | undefined): string =>
  m[(k ?? "").toLowerCase()] ?? "•";

export const leadGlyph = (s: string | null | undefined): string => lower(LEAD, s);
export const draftGlyph = (s: string | null | undefined): string => lower(DRAFT, s);
export const formatGlyph = (s: string | null | undefined): string => lower(FORMAT, s);
export const channelGlyph = (s: string | null | undefined): string => lower(CHANNEL, s);
export const campaignGlyph = (s: string | null | undefined): string =>
  CAMPAIGN[(s ?? "").toUpperCase()] ?? "•";
