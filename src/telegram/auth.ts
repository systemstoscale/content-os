import type { Env } from "../env";

/** Returns true if this chat_id is allowed to use the bot.
 *  First-user-wins: the very first message captures the owner. All later
 *  messages from other chat_ids are silently dropped. */
export async function isAuthorizedChat(
  env: Env,
  chat_id: number,
  user_id: number
): Promise<boolean> {
  // If TELEGRAM_CHAT_ID is set explicitly, use that as the strict allowlist.
  if (env.TELEGRAM_CHAT_ID && env.TELEGRAM_CHAT_ID.trim() !== "") {
    return String(chat_id) === env.TELEGRAM_CHAT_ID.trim();
  }

  // Otherwise, lazy-capture the first chat_id to write any message.
  const owner = await env.DB.prepare(`SELECT chat_id FROM tg_owner WHERE id = 1`)
    .first<{ chat_id: number }>();
  if (owner) return owner.chat_id === chat_id;

  // No owner yet — capture this one.
  await env.DB.prepare(
    `INSERT INTO tg_owner (id, chat_id, user_id, captured_at) VALUES (1, ?, ?, ?)`
  )
    .bind(chat_id, user_id, Date.now())
    .run();
  return true;
}

export async function touchChat(env: Env, chat_id: number): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO tg_chats (chat_id, first_seen_at, last_active_at)
     VALUES (?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET last_active_at = excluded.last_active_at`
  )
    .bind(chat_id, now, now)
    .run();
}
