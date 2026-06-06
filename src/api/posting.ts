import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env";
import { runSession } from "../agent";
import { requireBearer, methodNotAllowed } from "./auth";
import { getDraft } from "../db";
import { callZernioMcpTool } from "../clients/zernio-mcp";
import { zernioPublish, type ZernioPlatform } from "../tools/zernio";
import { topPerformers } from "./ideas";
import { getAgentModel } from "../lib/model";
import { logAnthropicCost } from "../lib/cost-tracking";

/** /api/posting/* — Posting surface operations not covered by /api/drafts.
 *
 *  Today this is just `POST /manual` — the SPA's "create a new draft from a
 *  brief" form. Wraps the existing /trigger/manual handler with a slightly
 *  richer input shape (brief + format + pillar) so the SPA doesn't have to
 *  construct the raw intent string itself. */

export type DraftFormat =
  | "carousel"
  | "quote_post"
  | "single_image"
  | "thumbnail"
  | "reel"
  | "youtube";

interface ManualInput {
  brief?: string;
  format?: DraftFormat;
  pillar?: string;
}

export async function handlePostingApi(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  pathTail: string,
): Promise<Response> {
  const guard = await requireBearer(req, env);
  if (guard) return guard;

  if (pathTail === "/manual") {
    if (req.method !== "POST") return methodNotAllowed("POST");
    return manual(req, env);
  }
  if (pathTail === "/cross-post") {
    if (req.method !== "POST") return methodNotAllowed("POST");
    return crossPost(req, env);
  }
  if (pathTail === "/review") {
    if (req.method !== "GET") return methodNotAllowed("GET");
    return contentReview(env);
  }
  return Response.json({ error: "unknown posting route" }, { status: 404 });
}

interface CrossPostInput {
  draft_id?: string;
  platforms?: string[]; // e.g. ['twitter', 'linkedin', 'bluesky']
  account_ids?: string[]; // optional, parallel to platforms
  publish_now?: boolean;
  is_draft?: boolean; // save to Zernio as draft without scheduling/publishing
}

interface CrossPostResult {
  _raw?: string;
  result?: string;
}

/** Reels/long-form are video; everything else (carousels, quotes, single
 *  images, thumbnails) is image. Fall back to a file-extension sniff for any
 *  asset that doesn't follow the format convention. */
function inferMediaType(format: string, urls: string[]): "image" | "video" {
  if (format === "reel" || format === "youtube") return "video";
  if (urls.some((u) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u))) return "video";
  return "image";
}

/** POST /api/posting/cross-post
 *
 *  Take an existing draft + fan it out to N other platforms via Zernio.
 *
 *  - When the draft has rendered assets AND an account id is known for every
 *    selected platform, the real MEDIA (image/video) is published through the
 *    same /posts pipeline the main publish flow uses (carries thumbnail too).
 *  - Otherwise (no assets, or accounts unresolved, or save-as-draft) it falls
 *    back to the TEXT-only `posts_cross_post` path.
 *
 *  Default behavior: schedule ~1 hour out. publish_now=true fires immediately;
 *  is_draft=true saves a Zernio draft (text path only — Zernio drafts can't
 *  carry custom media). */
async function crossPost(req: Request, env: Env): Promise<Response> {
  const body = await safeJson<CrossPostInput>(req);
  if (!body?.draft_id) return Response.json({ error: "draft_id required" }, { status: 400 });
  if (!Array.isArray(body.platforms) || body.platforms.length === 0) {
    return Response.json({ error: "platforms[] required (at least one)" }, { status: 400 });
  }

  const draft = await getDraft(env, body.draft_id);
  if (!draft) return Response.json({ error: "draft not found" }, { status: 404 });
  if (!draft.caption?.trim()) {
    return Response.json({ error: "draft has no caption to cross-post" }, { status: 400 });
  }

  const mediaUrls = (draft.payload.asset_urls ?? []).filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0,
  );
  const accountIds = body.account_ids ?? [];
  const haveAllAccounts =
    accountIds.length >= body.platforms.length &&
    body.platforms.every((_, i) => (accountIds[i] ?? "").trim().length > 0);

  // ── Media fan-out — publish the real asset, not just the caption. ──
  if (mediaUrls.length > 0 && haveAllAccounts && !body.is_draft) {
    const mediaType = inferMediaType(draft.format, mediaUrls);
    const platforms: ZernioPlatform[] = body.platforms.map((p, i) => ({
      platform: p.toLowerCase() as ZernioPlatform["platform"],
      accountId: accountIds[i]!.trim(),
      media_urls: mediaUrls,
      media_type: mediaType,
    }));
    const scheduled_for = body.publish_now
      ? undefined
      : new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await zernioPublish(env, {
      content: draft.caption,
      platforms,
      ...(scheduled_for ? { scheduled_for } : {}),
      ...(draft.payload.thumbnail_url ? { thumbnail_url: draft.payload.thumbnail_url } : {}),
    });
    if (!res.ok) {
      return Response.json({ ok: false, error: res.error ?? "zernio publish failed" }, { status: 502 });
    }
    return Response.json({
      ok: true,
      message: body.publish_now
        ? `Published with ${mediaType} to ${body.platforms.join(", ")}`
        : `Scheduled with ${mediaType} to ${body.platforms.join(", ")} in ~1 hour`,
      platforms: body.platforms,
      post_id: res.postId ?? null,
      media: true,
    });
  }

  // ── Text-only fan-out (no assets / accounts unresolved / save-as-draft). ──
  // Zernio's posts_cross_post takes COMMA-SEPARATED strings, not arrays.
  const platformsCsv = body.platforms.join(",");
  const accountIdsCsv = accountIds.join(",");

  try {
    const args: Record<string, unknown> = {
      content: draft.caption,
      platforms: platformsCsv,
    };
    if (accountIdsCsv) args.account_ids = accountIdsCsv;
    if (body.publish_now) args.publish_now = true;
    if (body.is_draft) args.is_draft = true;

    const result = await callZernioMcpTool<CrossPostResult>(env, "posts_cross_post", args);
    // The Zernio response is a status string — surface it verbatim so the
    // UI can show "Scheduled to twitter, linkedin in 1 hour" or whatever.
    return Response.json({
      ok: true,
      message: result.result ?? result._raw ?? "OK",
      platforms: body.platforms,
      media: false,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e).slice(0, 500) },
      { status: 502 },
    );
  }
}

async function manual(req: Request, env: Env): Promise<Response> {
  const body = await safeJson<ManualInput>(req);
  if (!body?.brief?.trim()) {
    return Response.json({ error: "missing brief" }, { status: 400 });
  }
  const brief = body.brief.trim();
  const format = body.format ?? "carousel";
  const pillar = body.pillar?.trim();

  // Compose a tight intent string. The agent's system prompt already
  // knows how each format flows — we just give it the brief + format
  // hint + pillar (if set) and let it dispatch the right tools.
  const intent = [
    `Manual content brief from the web UI.`,
    `Brief: ${brief}`,
    `Target format: ${format}.`,
    pillar ? `Pillar: ${pillar}.` : null,
    ``,
    `STEP 1 — Design the post in the requested format.`,
    `STEP 2 — Render assets (carousel slides, quote image, reel post-production, or YouTube thumbnails as appropriate).`,
    `STEP 3 — Call save_draft (or save_youtube_draft for long-form).`,
    `STEP 4 — Call send_preview_email + send_preview_telegram with the draft id.`,
    `STEP 5 — STOP. Do NOT publish — the creator approves from /posting/drafts in the UI.`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await runSession(env, {
    intent,
    source: "manual",
    approval_channel: "email",
  });
  return Response.json({
    ok: !result.error,
    sessionId: result.sessionId,
    error: result.error ?? null,
  });
}

/** GET /api/posting/review — the weekly "what worked / do more of" digest.
 *  Pulls top-engaging published posts (Zernio) and asks Claude to extract the
 *  winning patterns + concrete "do more of X" takeaways + next angles. The
 *  founder's content-team review meeting, automated. */
async function contentReview(env: Env): Promise<Response> {
  const top = await topPerformers(env, 8);
  if (top.length === 0) {
    return Response.json({
      ok: true,
      top: [],
      takeaways:
        "No published-post analytics yet. Publish a few posts (and connect Zernio) — then this digest will tell you what's working and what to do more of.",
      generated: false,
    });
  }

  const model = await getAgentModel(env);
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const prompt = [
    `You are the content strategist reviewing this brand's best-performing posts.`,
    `Below are the top posts by engagement (format: "(N engagements) caption").`,
    ``,
    ...top.map((t, i) => `${i + 1}. ${t}`),
    ``,
    `Write a tight review in Markdown:`,
    `## What's working`,
    `- 3-5 bullets naming the concrete pattern (hook shape, angle, format, topic) that earned attention.`,
    `## Do more of`,
    `- 3-5 specific, actionable "make more like X" instructions.`,
    `## Next 3 angles`,
    `- 3 fresh post angles that extend the winners.`,
    `No hype, no clichés, no em-dashes. Be specific to THESE posts, not generic advice.`,
  ].join("\n");

  let takeaways = "";
  try {
    const resp = await anthropic.messages.create({
      model,
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });
    void logAnthropicCost(env, model, resp.usage ?? {}, { stage: "content_review" });
    takeaways = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (e) {
    return Response.json({ ok: true, top, takeaways: `Review generation failed: ${String(e).slice(0, 160)}`, generated: false });
  }

  return Response.json({ ok: true, top, takeaways, generated: true });
}

async function safeJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}
