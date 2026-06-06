import type { Env } from "../env";
import { runSession } from "../agent";
import { requireBearer } from "../api/auth";

const MAX_BYTES = 500 * 1024 * 1024;

function ingestIntent(env: Env, r2_key: string, brief: string | undefined, zernio_account_id: string): string {
  // Same anti-step-skipping structure as /trigger/meta-ad and /trigger/meta-ad-from-draft —
  // PHASES + HARD RULES section. Haiku 4.5 has been observed to skip save_youtube_draft
  // when the step list grew long, so we pin it as non-skippable.
  return [
    `YouTube long-form post-production. You MUST complete all 6 phases in order.`,
    `Raw video stored at r2_key="${r2_key}".`,
    brief ? `Creator brief: ${brief}` : null,
    `Zernio YouTube account ID: ${zernio_account_id}.`,
    ``,
    `PHASE 1 — TRANSCRIBE`,
    `Call transcribe_video({ r2_key: "${r2_key}" }). Do NOT call process_reel — long-form keeps natural pacing.`,
    `The result includes a text transcript and time-coded segments. Read both before phase 2.`,
    ``,
    `PHASE 2 — CHAPTER THE VIDEO`,
    `Design 5–10 chapters of roughly 30–90s each. Use segment boundaries as chapter starts.`,
    `First chapter MUST start at 0:00 (the "Intro").`,
    `For very short videos (<3 min), 2–4 chapters is acceptable.`,
    ``,
    `PHASE 3 — WRITE TITLES + DESCRIPTION`,
    `Author 3 title variants (each <70 chars, curiosity + benefit). titles[0] = primary, used as the live title.`,
    `Write a YouTube SEO description with:`,
    `  - Hook line at top (~1 sentence, quote-worthy)`,
    `  - 1–2 paragraph summary of what's covered`,
    `  - Chapter list in YouTube format: "0:00 Intro" / "1:23 The first system" / ...`,
    `  - The 3 alternate SEO titles printed at the bottom (for YouTube's search ranking)`,
    `  - A hashtag block: 3–5 #tags from content pillars`,
    ``,
    `PHASE 4 — RENDER THUMBNAILS`,
    `Render 3 thumbnail variants via render_thumbnail.`,
    `Each MUST use a different headline angle: contrarian, numbered, question, curiosity-gap.`,
    `Asset prefixes: yt-thumb-A, yt-thumb-B, yt-thumb-C.`,
    `Each render returns a public_url — save them; phase 5 needs all 3.`,
    ``,
    `PHASE 5 — SAVE THE DRAFT (DO NOT SKIP)`,
    `Call save_youtube_draft with:`,
    `  - titles: array of 3 title variants from phase 3 (titles[0] is the live title)`,
    `  - thumbnail_urls: array of 3 public_urls from phase 4`,
    `  - chapters: array of { start_seconds, label } from phase 2`,
    `  - tags: 10–15 SEO tags (lowercase, no #, comma-separable)`,
    `  - description: full description from phase 3`,
    `  - video_url: "/r2/${r2_key}" (the Worker proxies R2 reads — Zernio downloads it from here)`,
    `  - zernio_account_id: "${zernio_account_id}"`,
    `Returns { draft_id }. Save it; phase 6 needs it.`,
    ``,
    `PHASE 6 — PREVIEW TO THE CREATOR`,
    `Call send_preview_email with subject "[<draft_id>] YOUTUBE — <titles[0]>" and a body that includes:`,
    `  - All 3 titles, labeled A/B/C`,
    `  - Links to all 3 thumbnail URLs (so the creator can pick the one to upload to YouTube Studio)`,
    `  - The full description (for paste-into-Studio)`,
    `  - The chapter list`,
    `  - The instruction: "Reply 'ship <draft_id>' to publish via Zernio. Then add the 3 titles + 3 thumbnails as A/B variants in YouTube Studio for testing."`,
    `Then STOP.`,
    ``,
    `HARD RULES`,
    `  - You CANNOT skip phase 5. If you find yourself about to send the preview email without having called save_youtube_draft and received a draft_id, STOP and call save_youtube_draft first.`,
    `  - YouTube drafts NEVER auto-publish. The creator must reply "ship dft_xxxx" — never call publish_draft_by_id from this flow.`,
    `  - If transcribe_video returns an empty transcript, abort and email the creator with the error. Don't fabricate chapters.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function handleYoutubeUpload(
  req: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  if (req.method !== "POST") return new Response("POST required", { status: 405 });

  // Accepts cookie session OR Bearer CONTENT_OS_API_TOKEN.
  const guard = await requireBearer(req, env);
  if (guard) return guard;

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.startsWith("video/")) {
    return Response.json({ error: "expected video/* content-type" }, { status: 400 });
  }
  const sizeHeader = Number(req.headers.get("content-length") ?? "0");
  if (sizeHeader > MAX_BYTES) {
    return Response.json({ error: `max ${MAX_BYTES} bytes` }, { status: 413 });
  }

  const url = new URL(req.url);
  const briefParam = url.searchParams.get("brief") ?? undefined;
  const slug = (url.searchParams.get("slug") ?? `yt-${Date.now()}`).replace(/[^a-z0-9-]/gi, "-");
  const accountId =
    url.searchParams.get("yt_account_id") ?? (await env.CONFIG.get("YT_ACCOUNT_ID")) ?? "";
  if (!accountId) {
    return Response.json(
      { error: "yt_account_id param required or set CONFIG.YT_ACCOUNT_ID" },
      { status: 400 }
    );
  }

  const ext = contentType.split("/")[1]?.split(";")[0] ?? "mp4";
  const r2_key = `uploads/${slug}.${ext}`;
  await env.ASSETS.put(r2_key, await req.arrayBuffer(), { httpMetadata: { contentType } });

  const result = await runSession(env, {
    intent: ingestIntent(env, r2_key, briefParam, accountId),
    source: "manual",
    approval_channel: "email",
  });
  return Response.json({ ok: true, r2_key, sessionId: result.sessionId, error: result.error });
}

export async function handleYoutube(
  req: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  if (req.method !== "POST") return new Response("POST required", { status: 405 });

  // Accepts cookie session OR Bearer CONTENT_OS_API_TOKEN.
  const guard = await requireBearer(req, env);
  if (guard) return guard;

  const body = (await req.json()) as {
    r2_key?: string;
    brief?: string;
    yt_account_id?: string;
  };
  if (!body.r2_key) return Response.json({ error: "missing 'r2_key'" }, { status: 400 });

  const head = await env.ASSETS.head(body.r2_key);
  if (!head) return Response.json({ error: `r2 object not found: ${body.r2_key}` }, { status: 404 });

  const accountId = body.yt_account_id ?? (await env.CONFIG.get("YT_ACCOUNT_ID")) ?? "";
  if (!accountId) {
    return Response.json(
      { error: "yt_account_id required or set CONFIG.YT_ACCOUNT_ID" },
      { status: 400 }
    );
  }

  const result = await runSession(env, {
    intent: ingestIntent(env, body.r2_key, body.brief, accountId),
    source: "manual",
    approval_channel: "email",
  });
  return Response.json({ ok: true, sessionId: result.sessionId, error: result.error });
}
