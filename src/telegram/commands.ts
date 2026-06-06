import type { Env } from "../env";
import { tgSendMessage } from "./api";
import { resetHistory, getChatStats } from "./agent";
import { latestPendingDraft, getDraft, recentReelsForChat } from "../db";
import { publishDraftById, rejectDraft } from "../tools/drafts";
import { draftGlyph, formatGlyph } from "../lib/labels";
import { shortPid } from "./reel-ui";
import { handleBrandCommand } from "./brand-wizard";

const HELP = `🤖 *Content OS Bot*

Send a message, voice note, or photo and I'll run your whole content motion.

*Reels*
Drop a video (or paste an R2 link) and pick a format. I edit, caption, and thumbnail it, then you tap Publish / Schedule / Queue.
\`/reels\` — recent reels (last 5) + status
\`/brand\` — customize fonts, colors, caption + motion + thumbnail style

*Drafts*
\`/list\` — recent drafts (last 5)
\`/draft <id>\` — show a draft by id
\`/ship <id>\` — publish a draft now
\`/no <id>\` — reject a draft
(or just tap the Approve / Reject / Publish buttons on the draft DM)

*System*
\`/model\` — view or switch your AI model (haiku/sonnet/opus)
\`/sessions\` — last 5 agent runs with status + tool-call count
\`/status\` — token usage stats for this chat
\`/new\`, \`/reset\` — clear conversation memory and start fresh
\`/help\` — this message

*Things I can do:*
• Carousel / quote / single-image posts
• YouTube long-form (transcribe + chapters + 3 thumbnails)
• Reels (caption-burn + cover)
• AI images + avatar reels (KIE.AI)

Just describe what you want — for example: "carousel about firing your VAs" or "quote post on the offer trap".`;

export async function handleCommand(
  env: Env,
  chat_id: number,
  text: string
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return false;

  const [cmd, ...args] = trimmed.split(/\s+/);
  const arg = args.join(" ").trim();

  switch (cmd?.toLowerCase()) {
    case "/start":
    case "/help":
      await tgSendMessage(env, chat_id, HELP, { parse_mode: "Markdown" });
      return true;

    case "/new":
    case "/reset":
      await resetHistory(env, chat_id);
      await tgSendMessage(env, chat_id, "Memory cleared. Fresh start.");
      return true;

    case "/status": {
      const stats = await getChatStats(env, chat_id);
      if (!stats) {
        await tgSendMessage(env, chat_id, "No activity yet.");
      } else {
        await tgSendMessage(
          env,
          chat_id,
          `Turns: ${stats.turn_count}\nTokens in: ${stats.tokens_in.toLocaleString()}\nTokens out: ${stats.tokens_out.toLocaleString()}\nCost (rough): \\$${cost(stats.tokens_in, stats.tokens_out)}`,
          { parse_mode: "Markdown" }
        );
      }
      return true;
    }

    case "/list": {
      const rs = await env.DB.prepare(
        `SELECT id, status, format, substr(caption, 1, 60) as cap,
                datetime(created_at/1000, 'unixepoch') as ts
         FROM drafts ORDER BY created_at DESC LIMIT 5`
      ).all<{ id: string; status: string; format: string; cap: string; ts: string }>();
      const rows = rs.results ?? [];
      if (rows.length === 0) {
        await tgSendMessage(env, chat_id, "No drafts yet.");
      } else {
        const lines = rows.map(
          (r) =>
            `${r.id} — ${draftGlyph(r.status)} ${r.status} ${formatGlyph(r.format)} ${r.format} — ${r.ts}\n  ${r.cap || "(no caption)"}`
        );
        await tgSendMessage(env, chat_id, lines.join("\n\n"));
      }
      return true;
    }

    case "/draft": {
      const id = arg || (await latestPendingDraft(env))?.id;
      if (!id) {
        await tgSendMessage(env, chat_id, "No pending drafts.");
        return true;
      }
      const d = await getDraft(env, id);
      if (!d) {
        await tgSendMessage(env, chat_id, `Draft not found: ${id}`);
        return true;
      }
      await tgSendMessage(
        env,
        chat_id,
        `${d.id} — ${d.status} ${d.format}\n\n${d.caption}\n\nAssets: ${d.payload.asset_urls.join(", ")}\nPlatforms: ${d.payload.platforms.map((p) => p.platform).join(", ")}`
      );
      return true;
    }

    case "/ship": {
      const id = arg || (await latestPendingDraft(env))?.id;
      if (!id) {
        await tgSendMessage(env, chat_id, "No draft to ship.");
        return true;
      }
      const r = await publishDraftById(env, id);
      if (r.ok) {
        await tgSendMessage(
          env,
          chat_id,
          `✅ Shipped ${id} (zernio post: ${r.zernio_post_id ?? "—"})${r.reminder ? `\n\n${r.reminder}` : ""}`
        );
      } else {
        await tgSendMessage(env, chat_id, `❌ Ship failed: ${r.error}`);
      }
      return true;
    }

    case "/no":
    case "/reject": {
      const id = arg || (await latestPendingDraft(env))?.id;
      if (!id) {
        await tgSendMessage(env, chat_id, "No draft to reject.");
        return true;
      }
      await rejectDraft(env, id);
      await tgSendMessage(env, chat_id, `Rejected ${id}.`);
      return true;
    }

    case "/reels": {
      const reels = await recentReelsForChat(env, String(chat_id), 5);
      if (reels.length === 0) {
        await tgSendMessage(env, chat_id, "No reels yet. Send a video or paste an R2 link.");
        return true;
      }
      const lines = reels.map((r) => {
        const when =
          r.status === "scheduled" && r.scheduled_for
            ? ` → ${new Date(r.scheduled_for).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}`
            : "";
        const preview = r.edited_url ? `\n  ${r.edited_url}` : "";
        return `<code>${shortPid(r.id)}</code> · ${r.status}${r.format ? ` · ${r.format}` : ""}${when}${preview}`;
      });
      await tgSendMessage(env, chat_id, lines.join("\n\n"), { parse_mode: "HTML" });
      return true;
    }

    case "/brand": {
      await handleBrandCommand(env, chat_id, arg);
      return true;
    }

    case "/sessions": {
      await listRecentSessions(env, chat_id);
      return true;
    }

    case "/model": {
      await handleModelCommand(env, chat_id, arg.toLowerCase());
      return true;
    }

    case "/resetpassword":
    case "/newpassword": {
      await handlePasswordReset(env, chat_id);
      return true;
    }

    default:
      await tgSendMessage(env, chat_id, `Unknown command: ${cmd}\n\nTry /help`);
      return true;
  }
}

function cost(tokensIn: number, tokensOut: number): string {
  // Rough Opus 4.7 pricing: $15/M in, $75/M out
  const usd = (tokensIn / 1_000_000) * 15 + (tokensOut / 1_000_000) * 75;
  return usd.toFixed(3);
}

// ─── /sessions ───────────────────────────────────────────────────────────────

async function listRecentSessions(env: Env, chat_id: number): Promise<void> {
  const rs = await env.DB.prepare(
    `SELECT id, source, created_at, tool_calls, error,
            CASE WHEN outcome IS NULL THEN 0 ELSE 1 END as completed
     FROM sessions ORDER BY created_at DESC LIMIT 5`,
  ).all<{
    id: string;
    source: string;
    created_at: number;
    tool_calls: number;
    error: string | null;
    completed: number;
  }>();
  const rows = rs.results ?? [];
  if (rows.length === 0) {
    await tgSendMessage(env, chat_id, "No sessions yet.");
    return;
  }
  const lines = rows.map((s) => {
    const t = new Date(s.created_at).toLocaleString("en-US", {
      timeStyle: "short",
      dateStyle: "short",
    });
    const status = s.error ? "❌ error" : s.completed === 1 ? "✅ done" : "⏳ pending";
    return `<code>${s.id}</code> · ${s.source} · ${t}\n  ${status} · ${s.tool_calls} tool call${s.tool_calls === 1 ? "" : "s"}${s.error ? `\n  <i>${escapeHtml(s.error.slice(0, 120))}</i>` : ""}`;
  });
  await tgSendMessage(env, chat_id, lines.join("\n\n"), { parse_mode: "HTML" });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── /model (Phase 21) — view or switch the daily-driver model ──────────────

async function handleModelCommand(env: Env, chat_id: number, arg: string): Promise<void> {
  const { MODEL_OPTIONS, getAgentModel, aliasForModel } = await import("../lib/model");
  if (!arg) {
    const current = await getAgentModel(env);
    const lines = ["*Agent model*", `Current: \`${aliasForModel(current)}\``, ""];
    for (const [alias, o] of Object.entries(MODEL_OPTIONS)) {
      lines.push(`• \`${alias}\` — ${o.label}\n  ${o.cost_hint}`);
    }
    lines.push("", "Switch with e.g. `/model opus`.");
    await tgSendMessage(env, chat_id, lines.join("\n"), { parse_mode: "Markdown" });
    return;
  }
  if (!MODEL_OPTIONS[arg]) {
    await tgSendMessage(
      env,
      chat_id,
      `Unknown model "${arg}". Choose: ${Object.keys(MODEL_OPTIONS).join(", ")}`,
    );
    return;
  }
  await env.CONFIG.put("AGENT_MODEL", MODEL_OPTIONS[arg]!.id);
  await tgSendMessage(
    env,
    chat_id,
    `✓ Model set to *${MODEL_OPTIONS[arg]!.label}*.\n${MODEL_OPTIONS[arg]!.cost_hint}`,
    { parse_mode: "Markdown" },
  );
}

// ─── /resetpassword (Phase 22) — self-service, phone-native ─────────────────
// Owner-gated (only the captured tg_owner reaches commands). Generates a new
// temporary password, DMs it, and forces a change on next login. No email
// infra needed — the founder always has Telegram.

const RESET_WORDS = [
  "amber", "arctic", "aspen", "birch", "bronze", "cedar", "cobalt", "coral",
  "cosmic", "crystal", "delta", "ember", "falcon", "forge", "gale", "haven",
  "horizon", "ivory", "jade", "lumen", "marble", "meadow", "nebula", "nova",
  "orbit", "quartz", "raven", "river", "sable", "solar", "spruce", "summit",
  "thicket", "tundra", "velvet", "vortex", "willow", "zenith",
];

async function handlePasswordReset(env: Env, chat_id: number): Promise<void> {
  const user = await env.DB.prepare(
    `SELECT email FROM users ORDER BY created_at ASC LIMIT 1`,
  )
    .first<{ email: string }>()
    .catch(() => null);
  if (!user?.email) {
    await tgSendMessage(env, chat_id, "No account found to reset. Finish /setup first.");
    return;
  }

  const pick = () => RESET_WORDS[crypto.getRandomValues(new Uint32Array(1))[0]! % RESET_WORDS.length]!;
  const digits = (crypto.getRandomValues(new Uint16Array(1))[0]! % 9000) + 1000;
  const newPassword = `${pick()}-${pick()}-${pick()}-${digits}`;

  const { hashPassword } = await import("../lib/password");
  const hash = await hashPassword(newPassword);

  await env.DB.prepare(
    `UPDATE users
       SET password_hash = ?, password_salt = ?, password_iters = ?, must_change_password = 1
       WHERE email = ?`,
  )
    .bind(hash.hash, hash.salt, hash.iters, user.email)
    .run();

  const workerUrl = (await env.CONFIG.get("WORKER_URL")) ?? "";
  await tgSendMessage(
    env,
    chat_id,
    [
      "🔑 *Password reset*",
      `Email: \`${user.email}\``,
      `New password: \`${newPassword}\``,
      "",
      `Sign in${workerUrl ? ` at ${workerUrl}/login` : ""} — you'll be asked to set a permanent one.`,
    ].join("\n"),
    { parse_mode: "Markdown" },
  );
}

