import type { Env } from "../env";
import { runSession } from "../agent";
import { pillarsUsedSince } from "../db";
import { runDueReels } from "../tools/reel-publish";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Cron dispatcher.
 *
 *  Registered crons (wrangler.toml `[triggers].crons`):
 *    "* * * * *"     → every minute → publish reels whose scheduled time arrived
 *    "0 7 * * *"     → 07:00 UTC daily → content brief
 *
 *  Cloudflare passes the matched pattern as `event.cron`; we dispatch on it. */
export async function handleCron(event: ScheduledEvent, env: Env): Promise<void> {
  if (event.cron === "* * * * *") {
    await runDueReels(env);
    return;
  }
  // 07:00 UTC daily: prune the Telegram dedupe ledger (else it grows forever),
  // then run the content brief.
  await pruneOldRows(env);
  await runDailyContentBrief(env);
}

/** Keep operational tables from growing unbounded. Best-effort. */
async function pruneOldRows(env: Env): Promise<void> {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  try {
    await env.DB.prepare("DELETE FROM tg_seen_updates WHERE seen_at < ?").bind(cutoff).run();
  } catch (e) {
    console.warn("pruneOldRows failed:", String(e).slice(0, 160));
  }
}

async function runDailyContentBrief(env: Env): Promise<void> {
  const recent = await pillarsUsedSince(env, Date.now() - SEVEN_DAYS_MS);
  const exclusionLine =
    recent.length > 0
      ? `Pillars already used in the last 7 days (avoid these): ${recent.join(", ")}.`
      : `No pillars have been used yet — pick any.`;

  const intent = [
    `Daily content brief for ${env.CREATOR_NAME}.`,
    exclusionLine,
    `Pick ONE remaining pillar from the content-pillars.md document.`,
    `Choose format: carousel (5–7 slides) OR a single quote post. Pick whichever fits the angle best.`,
    `Render via render_carousel or render_quote_post.`,
    `Then call save_draft with the assets, caption, and the pillar name in the 'pillar' field.`,
    `Then call send_preview_email AND send_preview_telegram with the draft_id.`,
    `DO NOT call publish_draft_by_id. The creator must reply "ship dft_xxxx" to authorise publishing — there is no auto-publish, ever.`,
  ].join(" ");

  await runSession(env, {
    intent,
    source: "cron",
    approval_channel: "email",
  });
}
