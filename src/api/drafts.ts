import type { Env } from "../env";
import { requireBearer, methodNotAllowed } from "./auth";
import { getDraft, markDraftStatus, type DraftRow } from "../db";
import { getCredential } from "../lib/credentials";

/** /api/drafts — list, get, approve, reject. Backs the Posting UI tables
 *  and detail view. All routes require the Bearer-token gate. */
export async function handleDraftsApi(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  pathTail: string, // everything after /api/drafts — "", "/<id>", "/<id>/approve", "/<id>/reject"
): Promise<Response> {
  const guard = await requireBearer(req, env);
  if (guard) return guard;

  // List endpoint: /api/drafts
  if (pathTail === "" || pathTail === "/") {
    if (req.method !== "GET") return methodNotAllowed("GET");
    return listDrafts(req, env);
  }

  // Strip leading slash and split — first segment is always the draft id.
  const segs = pathTail.replace(/^\//, "").split("/");
  const id = segs[0];
  const action = segs[1] ?? "";

  if (!id) return Response.json({ error: "draft id required" }, { status: 400 });

  // Detail endpoint: /api/drafts/:id
  if (!action) {
    if (req.method !== "GET") return methodNotAllowed("GET");
    return getDraftHandler(env, id);
  }

  // Action endpoints: /api/drafts/:id/{approve,reject}
  if (req.method !== "POST") return methodNotAllowed("POST");
  if (action === "approve") return approveDraft(req, env, id);
  if (action === "reject") return rejectDraft(req, env, id);
  return Response.json({ error: `unknown action: ${action}` }, { status: 404 });
}

interface DraftSummary {
  id: string;
  created_at: number;
  source: string;
  status: string;
  format: string;
  caption: string;
  pillar: string | null;
  published_at: number | null;
  scheduled_for: string | null;
}

/** GET /api/drafts?status=<s>&format=<f>&limit=<n>&offset=<n>  */
async function listDrafts(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const format = url.searchParams.get("format");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  // Build WHERE clause + bindings dynamically. SQLite parameter binding keeps
  // this safe from injection; we don't interpolate strings directly.
  const where: string[] = [];
  const binds: unknown[] = [];
  if (status) {
    where.push("status = ?");
    binds.push(status);
  }
  if (format) {
    where.push("format = ?");
    binds.push(format);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await env.DB.prepare(
    `SELECT id, created_at, source, status, format, caption, pillar, published_at,
            CASE WHEN json_valid(payload_json)
                 THEN json_extract(payload_json, '$.scheduled_for') END AS scheduled_for
     FROM drafts
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<DraftSummary>();

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM drafts ${whereSql}`,
  )
    .bind(...binds)
    .first<{ c: number }>();

  return Response.json({
    drafts: rows.results ?? [],
    total: countRow?.c ?? 0,
    limit,
    offset,
  });
}

/** GET /api/drafts/:id */
async function getDraftHandler(env: Env, id: string): Promise<Response> {
  const draft = await getDraft(env, id);
  if (!draft) return Response.json({ error: "draft not found" }, { status: 404 });
  return Response.json({ draft });
}

/** POST /api/drafts/:id/approve { publish?: boolean }
 *  Default: just flips status to "approved" — the cron picks it up.
 *  If publish=true, also call publish_draft_by_id immediately.
 *  Also fires a one-way Telegram DM "✓ Approved via web" so the founder
 *  sees the state change in the same channel that originally sent the
 *  inline-button DM. */
async function approveDraft(req: Request, env: Env, id: string): Promise<Response> {
  const draft = await getDraft(env, id);
  if (!draft) return Response.json({ error: "draft not found" }, { status: 404 });
  if (draft.status === "published") {
    return Response.json({ error: "already published" }, { status: 409 });
  }

  const body = await safeJson<{ publish?: boolean }>(req);
  await markDraftStatus(env, id, "approved");

  if (body?.publish) {
    // Lazy-import the publisher to keep the cold-start cost off this route
    // unless we actually publish.
    const { publishDraftById } = await import("../tools/drafts");
    try {
      const result = await publishDraftById(env, id);
      // Fire-and-forget Telegram notification; never let it block the
      // response or fail the publish.
      void notifyTelegram(env, `🚀 **Published via web**: \`${id}\``).catch(() => {});
      return Response.json({ ok: true, approved: true, published: true, result });
    } catch (e) {
      return Response.json(
        { ok: false, approved: true, published: false, error: String(e) },
        { status: 502 },
      );
    }
  }

  void notifyTelegram(env, `✓ **Approved via web**: \`${id}\``).catch(() => {});
  return Response.json({ ok: true, approved: true, published: false });
}

/** POST /api/drafts/:id/reject { reason?: string } */
async function rejectDraft(req: Request, env: Env, id: string): Promise<Response> {
  const draft = await getDraft(env, id);
  if (!draft) return Response.json({ error: "draft not found" }, { status: 404 });
  if (draft.status === "published") {
    return Response.json({ error: "cannot reject a published draft" }, { status: 409 });
  }
  const body = await safeJson<{ reason?: string }>(req);
  await markDraftStatus(env, id, "rejected");
  const msg = body?.reason
    ? `✗ **Rejected via web**: \`${id}\`\n_${body.reason.slice(0, 200)}_`
    : `✗ **Rejected via web**: \`${id}\``;
  void notifyTelegram(env, msg).catch(() => {});
  return Response.json({ ok: true, rejected: true });
}

/** Fire a one-way DM. Lazy-imports the helper so this file stays light
 *  and so non-Telegram installs don't drag in the bot code unnecessarily. */
async function notifyTelegram(env: Env, html: string): Promise<void> {
  if (!(await getCredential(env, "TELEGRAM_BOT_TOKEN"))) return;
  const { sendPreviewTelegram } = await import("../tools/telegram-preview");
  // Reuse the existing preview helper — it handles owner resolution + the
  // "no chat captured" case gracefully. We strip the HTML formatting flag
  // by passing the message as-is; sendPreviewTelegram will markdown-render
  // it via tgSendMessage's auto path.
  await sendPreviewTelegram(env, { message: html });
}

/** Small helper — Workers throws on `req.json()` when the body is empty. */
async function safeJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

export type { DraftRow };
