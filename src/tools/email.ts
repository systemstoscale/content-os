import { EmailMessage } from "cloudflare:email";
import type { Env } from "../env";

export interface SendPreviewEmailInput {
  subject: string;
  body_text: string;
  asset_urls?: string[];
}

export interface SendPreviewEmailOutput {
  ok: boolean;
  error?: string;
}

export async function sendPreviewEmail(
  env: Env,
  input: SendPreviewEmailInput
): Promise<SendPreviewEmailOutput> {
  if (!env.EMAIL) {
    // Deploy-button installs don't have the Email Routing binding (they don't
    // ship with a verified sending domain). Telegram + the in-Worker drafts
    // list are the only approval surfaces in that case.
    return { ok: false, error: "EMAIL binding not configured (set up Email Routing to enable)" };
  }
  if (!env.APPROVAL_EMAIL || env.APPROVAL_EMAIL.startsWith("REPLACE_ME")) {
    return { ok: false, error: "APPROVAL_EMAIL not configured" };
  }

  // APPROVAL_EMAIL can be a comma-separated list of aliases. The first entry
  // is used as the TO; it MUST match the verified destination_address in
  // wrangler.toml's [[send_email]] binding.
  const approvalTo = env.APPROVAL_EMAIL.split(",")[0]!.trim();

  // FROM domain MUST be a zone with Email Routing enabled on this Cloudflare
  // account. Falls back to scalers.email (our agent-mail domain) by default.
  const fromDomain = (await env.CONFIG.get("AGENT_FROM_DOMAIN")) ?? "scalers.email";
  const from = `agent@${fromDomain}`;
  const assetBlock = (input.asset_urls ?? []).map((u) => `- ${u}`).join("\n");

  const body =
    `${input.body_text}\n\n` +
    (assetBlock ? `Assets:\n${assetBlock}\n\n` : "") +
    `Reply "ship" to publish or "no" to discard.`;

  const rfc822 =
    `From: Content OS <${from}>\r\n` +
    `To: ${approvalTo}\r\n` +
    `Subject: ${input.subject}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `\r\n` +
    body;

  try {
    const msg = new EmailMessage(from, approvalTo, rfc822);
    await env.EMAIL.send(msg);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
