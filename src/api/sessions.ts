import type { Env } from "../env";
import { requireBearer, methodNotAllowed } from "./auth";

/** /api/sessions — list + detail for the agent execution log.
 *
 *  Backs /settings/sessions in the SPA. Useful for the founder to debug
 *  "why didn't yesterday's draft fire?" without SSH-ing into D1 with
 *  wrangler.  */

export async function handleSessionsApi(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  pathTail: string,
): Promise<Response> {
  const guard = await requireBearer(req, env);
  if (guard) return guard;

  if (pathTail === "" || pathTail === "/") {
    if (req.method !== "GET") return methodNotAllowed("GET");
    return listSessions(req, env);
  }

  const id = pathTail.replace(/^\//, "");
  if (!id) return Response.json({ error: "session id required" }, { status: 400 });
  if (req.method !== "GET") return methodNotAllowed("GET");
  return getSession(env, id);
}

interface SessionRow {
  id: string;
  created_at: number;
  source: string;
  intent: string;
  outcome: string | null;
  tool_calls: number;
  error: string | null;
}

async function listSessions(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const source = url.searchParams.get("source"); // 'manual' | 'cron' | 'telegram' | 'upload' | …
  const onlyErrors = url.searchParams.get("errors") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  const where: string[] = [];
  const binds: unknown[] = [];
  if (source) {
    where.push("source = ?");
    binds.push(source);
  }
  if (onlyErrors) where.push("error IS NOT NULL");
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await env.DB.prepare(
    `SELECT id, created_at, source, substr(intent, 1, 120) as intent_preview,
            tool_calls, error,
            CASE WHEN outcome IS NULL THEN 0 ELSE 1 END as completed
     FROM sessions ${whereSql}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<{
      id: string;
      created_at: number;
      source: string;
      intent_preview: string;
      tool_calls: number;
      error: string | null;
      completed: number;
    }>();

  const count = await env.DB.prepare(`SELECT COUNT(*) as c FROM sessions ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();

  return Response.json({
    sessions: (rows.results ?? []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      source: r.source,
      intent_preview: r.intent_preview,
      tool_calls: r.tool_calls,
      error: r.error,
      completed: r.completed === 1,
    })),
    total: count?.c ?? 0,
    limit,
    offset,
  });
}

async function getSession(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, created_at, source, intent, outcome, tool_calls, error
     FROM sessions WHERE id = ?`,
  )
    .bind(id)
    .first<SessionRow>();
  if (!row) return Response.json({ error: "session not found" }, { status: 404 });
  return Response.json({ session: row });
}
