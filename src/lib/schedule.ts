import type { Env } from "../env";
import { profileField } from "../profile";
import { latestScheduledForChat } from "../db";

// Timezone-aware schedule math for the reel pipeline. Everything is computed
// in the creator's timezone (CONFIG.CREATOR_TIMEZONE) and returned as epoch-ms
// (UTC) so the per-minute cron fires due reels with a plain `<= now` compare.
// No external date lib — we use Intl.DateTimeFormat for the tz conversion.

const DAY_MS = 86_400_000;

export async function creatorTimezone(env: Env): Promise<string> {
  return (await profileField(env, "creator_timezone")) || "UTC";
}

/** How far ahead of UTC `tz` is (ms) at instant `atMs`. */
function tzOffsetMs(tz: string, atMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const m: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(atMs))) {
    if (p.type !== "literal") m[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(m["year"]!, m["month"]! - 1, m["day"]!, m["hour"]!, m["minute"]!, m["second"]!);
  return asUTC - atMs;
}

/** Wall-clock Y/M/D in `tz` for instant `ms`. */
function datePartsInTz(tz: string, ms: number): { y: number; mo: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const m: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(ms))) {
    if (p.type !== "literal") m[p.type] = Number(p.value);
  }
  return { y: m["year"]!, mo: m["month"]!, d: m["day"]! };
}

/** Epoch ms for the wall-clock instant Y-M-D h:mi:00 in `tz`. */
function zonedWallClockToMs(tz: string, y: number, mo: number, d: number, h: number, mi: number): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  // One correction pass is exact except across the DST transition hour, which
  // is acceptable for a posting scheduler (worst case ±1h on two days/year).
  return guess - tzOffsetMs(tz, guess);
}

/** A wall-clock slot at h:mi on (today + addDays) in `tz`, as epoch ms. */
function slotMs(tz: string, nowMs: number, addDays: number, h: number, mi: number): number {
  const p = datePartsInTz(tz, nowMs + addDays * DAY_MS);
  return zonedWallClockToMs(tz, p.y, p.mo, p.d, h, mi);
}

/** Human label for a scheduled instant, in the creator's tz. */
export function formatSlotLabel(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

/** The 4 default schedule presets, relative to `nowMs`, in the creator's tz. */
export async function schedulePresets(
  env: Env,
  nowMs: number,
): Promise<Array<{ label: string; ms: number }>> {
  const tz = await creatorTimezone(env);
  let today18 = slotMs(tz, nowMs, 0, 18, 0);
  if (today18 <= nowMs) today18 = slotMs(tz, nowMs, 1, 18, 0); // rolled past 18:00 -> tomorrow
  const candidates = [
    today18,
    slotMs(tz, nowMs, 1, 9, 0),
    slotMs(tz, nowMs, 1, 18, 0),
    slotMs(tz, nowMs, 2, 9, 0),
  ];
  const seen = new Set<number>();
  return candidates
    .filter((ms) => (seen.has(ms) ? false : (seen.add(ms), true)))
    .map((ms) => ({ label: formatSlotLabel(ms, tz), ms }));
}

/** Next daily queue slot (CONFIG.REEL_QUEUE_HOUR, default 09:00) in the
 *  creator's tz, bumped a day past the chat's latest already-scheduled reel so
 *  sequential queue adds line up day-by-day. */
export async function nextQueueSlotMs(env: Env, chatId: string, nowMs: number): Promise<number> {
  const tz = await creatorTimezone(env);
  const hourRaw = await env.CONFIG.get("REEL_QUEUE_HOUR");
  const hour = Number.isFinite(Number(hourRaw)) ? Number(hourRaw) : 9;
  let slot = slotMs(tz, nowMs, 0, hour, 0);
  if (slot <= nowMs) slot = slotMs(tz, nowMs, 1, hour, 0);
  const last = await latestScheduledForChat(env, chatId);
  if (last != null) {
    while (slot <= last) slot += DAY_MS;
  }
  return slot;
}
