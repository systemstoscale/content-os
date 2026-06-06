import type { Env } from "../env";
import { requireBearer } from "../api/auth";
import { r2PublicUrl } from "../lib/r2-url";

/** POST /r2/upload — bearer-guarded raw video upload for the iPhone Shortcut
 *  ingest path. Streams the request body straight into R2 (no in-memory
 *  buffering, so it handles 200 MB+ clips that would blow the Worker memory
 *  cap), then returns the public URL the Shortcut pastes into Telegram. */
export async function handleR2Upload(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return new Response("POST required", { status: 405 });

  const guard = await requireBearer(req, env);
  if (guard) return guard;

  const contentType = req.headers.get("content-type") ?? "application/octet-stream";
  if (!contentType.startsWith("video/")) {
    return Response.json({ error: "expected video/* content-type" }, { status: 400 });
  }
  if (!req.body) return Response.json({ error: "empty body" }, { status: 400 });

  const url = new URL(req.url);
  const ext = contentType.includes("quicktime") ? "mov" : "mp4";
  const requested = url.searchParams.get("key");
  const key = (requested || `reels/inbox/${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}.${ext}`)
    .replace(/[^a-zA-Z0-9._/-]/g, "-");

  await env.ASSETS.put(key, req.body, { httpMetadata: { contentType } });
  const publicUrl = await r2PublicUrl(env, key);
  return Response.json({ ok: true, key, url: publicUrl });
}

export async function handleR2(req: Request, env: Env): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("GET only", { status: 405 });
  }
  const url = new URL(req.url);

  // Hosted deliverable / in-email audit (Phase G). Token maps directly to the
  // R2 key — unguessable, served as HTML. No DB lookup needed.
  if (url.pathname.startsWith("/r2/deliverable/")) {
    const token = url.pathname.slice("/r2/deliverable/".length).replace(/[^a-f0-9]/gi, "");
    if (!token) return new Response("not found", { status: 404 });
    const obj = await env.ASSETS.get(`deliverables/${token}.html`);
    if (!obj) return new Response("not found", { status: 404 });
    const dh = new Headers();
    dh.set("content-type", "text/html; charset=utf-8");
    dh.set("cache-control", "public, max-age=300");
    if (req.method === "HEAD") return new Response(null, { headers: dh });
    return new Response(obj.body, { headers: dh });
  }

  const key = url.pathname.replace(/^\/r2\//, "");
  if (!key) return new Response("not found", { status: 404 });

  const obj = await env.ASSETS.get(key);
  if (!obj) return new Response("not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=300");

  if (req.method === "HEAD") return new Response(null, { headers });
  return new Response(obj.body, { headers });
}
