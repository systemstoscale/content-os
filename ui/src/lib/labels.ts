/**
 * The single source of truth for at-a-glance labels across the SPA: every enum
 * value → { emoji, label, cls }. Phase 0 (UI/UX) routes ALL status/format/type
 * rendering through here so a founder scans a screen in 2 seconds without
 * reading. The Worker has a parallel emoji-only mirror (src/lib/labels.ts) for
 * Telegram. Keep the two in sync when adding values.
 */

export interface LabelDef {
  emoji: string;
  label: string;
  /** Tailwind border+bg+text classes for a pill badge. */
  cls: string;
}

const NEUTRAL = "border-bg-graphite bg-bg-charcoal text-zinc-300";
const GOLD = "border-gold/40 bg-gold/10 text-gold";
const GREEN = "border-emerald-400/40 bg-emerald-400/10 text-emerald-300";
const GREEN_SOLID = "border-emerald-500/60 bg-emerald-500/20 text-emerald-200";
const RED = "border-red-500/40 bg-red-500/10 text-red-300";
const BLUE = "border-sky-400/40 bg-sky-400/10 text-sky-300";
const VIOLET = "border-violet-400/40 bg-violet-400/10 text-violet-300";
const MUTED = "border-zinc-600 bg-zinc-800 text-zinc-400";

export const LEAD_STATUS: Record<string, LabelDef> = {
  discovered: { emoji: "🔍", label: "Discovered", cls: "border-zinc-600 bg-zinc-800 text-zinc-300" },
  enriching: { emoji: "⚗️", label: "Enriching", cls: BLUE },
  ready: { emoji: "✅", label: "Ready", cls: GREEN },
  pushed: { emoji: "🚀", label: "Pushed", cls: GOLD },
  replied: { emoji: "💬", label: "Replied", cls: VIOLET },
  booked: { emoji: "📅", label: "Booked", cls: GREEN_SOLID },
  disqualified: { emoji: "⛔", label: "Disqualified", cls: "border-zinc-600 bg-zinc-800 text-zinc-500" },
  suppressed: { emoji: "🚫", label: "Suppressed", cls: RED },
};

export const DRAFT_STATUS: Record<string, LabelDef> = {
  pending: { emoji: "🟡", label: "Pending", cls: GOLD },
  approved: { emoji: "✅", label: "Approved", cls: GREEN },
  published: { emoji: "🚀", label: "Published", cls: GREEN_SOLID },
  rejected: { emoji: "✗", label: "Rejected", cls: MUTED },
  failed: { emoji: "⚠️", label: "Failed", cls: RED },
};

export const DRAFT_FORMAT: Record<string, LabelDef> = {
  carousel: { emoji: "🎠", label: "Carousel", cls: NEUTRAL },
  quote: { emoji: "💬", label: "Quote", cls: NEUTRAL },
  quote_post: { emoji: "💬", label: "Quote", cls: NEUTRAL },
  single_image: { emoji: "🖼️", label: "Image", cls: NEUTRAL },
  image: { emoji: "🖼️", label: "Image", cls: NEUTRAL },
  reel: { emoji: "🎬", label: "Reel", cls: NEUTRAL },
  youtube: { emoji: "📺", label: "YouTube", cls: NEUTRAL },
  meta_ads: { emoji: "📣", label: "Ad", cls: NEUTRAL },
  thumbnail: { emoji: "🖼️", label: "Thumbnail", cls: NEUTRAL },
  text: { emoji: "📝", label: "Text", cls: NEUTRAL },
  text_post: { emoji: "📝", label: "Text post", cls: NEUTRAL },
  thread: { emoji: "🧵", label: "Thread", cls: NEUTRAL },
};

export const REC_TYPE: Record<string, LabelDef> = {
  pause: { emoji: "🛑", label: "Pause", cls: RED },
  scale_budget: { emoji: "📈", label: "Scale", cls: GREEN },
  refresh_creative: { emoji: "🔁", label: "Refresh", cls: BLUE },
  no_delivery: { emoji: "⚠️", label: "No delivery", cls: GOLD },
  review: { emoji: "🔎", label: "Review", cls: NEUTRAL },
};

export const REPLY_TAG: Record<string, LabelDef> = {
  interested: { emoji: "🔥", label: "Interested", cls: GREEN },
  meeting_booked: { emoji: "📅", label: "Meeting booked", cls: GREEN_SOLID },
  question: { emoji: "❓", label: "Question", cls: BLUE },
  pricing: { emoji: "💲", label: "Pricing", cls: BLUE },
  referral: { emoji: "↗️", label: "Referral", cls: VIOLET },
  objection: { emoji: "🛑", label: "Objection", cls: GOLD },
  not_interested: { emoji: "👋", label: "Not interested", cls: MUTED },
  bad_timing: { emoji: "⏳", label: "Bad timing", cls: GOLD },
  ooo: { emoji: "🌴", label: "Out of office", cls: MUTED },
  bounce: { emoji: "📭", label: "Bounce", cls: RED },
  unsubscribe: { emoji: "🚫", label: "Unsubscribe", cls: RED },
  needs_human: { emoji: "🙋", label: "Needs you", cls: GOLD },
};

export const CHANNEL: Record<string, LabelDef> = {
  email: { emoji: "📧", label: "Email", cls: NEUTRAL },
  linkedin: { emoji: "💬", label: "LinkedIn", cls: NEUTRAL },
  linkedin_message: { emoji: "💬", label: "LinkedIn", cls: NEUTRAL },
  call: { emoji: "☎️", label: "Call", cls: NEUTRAL },
  sms: { emoji: "📱", label: "SMS", cls: NEUTRAL },
  dm: { emoji: "💬", label: "DM", cls: NEUTRAL },
};

export const HEALTH_STATUS: Record<string, LabelDef> = {
  ok: { emoji: "✅", label: "OK", cls: "text-emerald-300" },
  connected: { emoji: "✅", label: "Connected", cls: "text-emerald-300" },
  missing: { emoji: "⚪", label: "Not set", cls: "text-zinc-500" },
  expired: { emoji: "⚠️", label: "Expired", cls: "text-gold" },
  error: { emoji: "❌", label: "Error", cls: "text-red-400" },
};

/** Lookup with a safe fallback so an unknown value still renders something. */
export function lookup(map: Record<string, LabelDef>, key: string | null | undefined): LabelDef {
  const k = (key ?? "").toLowerCase();
  return map[k] ?? { emoji: "•", label: key ?? "—", cls: NEUTRAL };
}
