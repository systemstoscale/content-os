import type { Env } from "../env";
import { runSession } from "../agent";
import { publishDraftById, rejectDraft } from "../tools/drafts";
import { latestPendingDraft } from "../db";

const APPROVE_RE = /^\s*(ship|ok|yes|approve|go)\b/i;
const REJECT_RE = /^\s*(no|reject|discard|kill|skip)\b/i;
const DRAFT_ID_RE = /\b(dft_[a-z0-9]{6,12})\b/i;

export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env
): Promise<void> {
  const subject = message.headers.get("subject") ?? "";
  const from = message.from;

  // APPROVAL_EMAIL accepts comma-separated aliases. Useful when the verified
  // destination on Cloudflare is max@skalers.io but you reply from max@adslab.com
  // (or vice versa) via an external mail client.
  const allowedSenders = (env.APPROVAL_EMAIL || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedSenders.includes(from.toLowerCase())) {
    message.setReject(`unauthorized sender: ${from}`);
    return;
  }

  const raw = await streamToString(message.raw);
  const body = extractPlainTextBody(raw);
  const haystack = `${subject}\n${body}`;
  const draftId = (DRAFT_ID_RE.exec(haystack)?.[1] ?? "").toLowerCase() || null;

  if (APPROVE_RE.test(body) || APPROVE_RE.test(subject)) {
    const target = draftId ?? (await latestPendingDraft(env))?.id ?? null;
    if (!target) return;
    await publishDraftById(env, target);
    return;
  }

  if (REJECT_RE.test(body) || REJECT_RE.test(subject)) {
    const target = draftId ?? (await latestPendingDraft(env))?.id ?? null;
    if (target) await rejectDraft(env, target);
    return;
  }

  const intent = subject ? `${subject}\n\n${body}`.slice(0, 4000) : body.slice(0, 4000);
  await runSession(env, {
    intent,
    source: "email",
    approval_channel: "email",
  });
}

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function extractPlainTextBody(raw: string): string {
  const split = raw.split(/\r?\n\r?\n/);
  return split.slice(1).join("\n\n").slice(0, 8000);
}
