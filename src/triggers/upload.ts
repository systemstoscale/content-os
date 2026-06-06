import type { Env } from "../env";
import { runSession } from "../agent";
import { requireBearer } from "../api/auth";

const MAX_BYTES = 200 * 1024 * 1024;

export async function handleUpload(
  req: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  if (req.method !== "POST") return new Response("POST required", { status: 405 });

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
  const slug = (url.searchParams.get("slug") ?? `reel-${Date.now()}`).replace(/[^a-z0-9-]/gi, "-");
  const ext = contentType.split("/")[1]?.split(";")[0] ?? "mp4";
  const r2_key = `uploads/${slug}.${ext}`;

  const body = await req.arrayBuffer();
  await env.ASSETS.put(r2_key, body, { httpMetadata: { contentType } });

  const intent = [
    `Talking-head reel post-production.`,
    `Raw video stored at r2_key="${r2_key}". Call process_reel({ r2_key }) first.`,
    briefParam ? `Creator note: ${briefParam}` : null,
    `Then write platform captions for instagram, tiktok, linkedin, youtube based on the transcript.`,
    `Render a 1080x1080 thumbnail using render_thumbnail with the headline derived from the strongest hook in the transcript.`,
    `Call save_draft with format="carousel" → NO, format="reel". Include all platforms the creator has connected.`,
    `Then send_preview_email with the processed video link, thumbnail, and draft_id. STOP — never publish a reel without approval.`,
  ]
    .filter(Boolean)
    .join(" ");

  const result = await runSession(env, {
    intent,
    source: "manual",
    approval_channel: "email",
  });

  return Response.json({
    ok: true,
    r2_key,
    sessionId: result.sessionId,
    error: result.error,
  });
}
