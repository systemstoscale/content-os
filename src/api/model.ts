import type { Env } from "../env";
import { requireBearer, methodNotAllowed } from "./auth";
import { MODEL_OPTIONS, getAgentModel, aliasForModel } from "../lib/model";

/** /api/model — read the available models + current selection, or set it.
 *
 *  GET  → { current_id, current_alias, options: [{alias, id, label, cost_hint}] }
 *  PUT  → { alias } or { id } → persists to CONFIG.AGENT_MODEL, returns current. */
export async function handleModelApi(req: Request, env: Env): Promise<Response> {
  const guard = await requireBearer(req, env);
  if (guard) return guard;

  if (req.method === "GET") {
    const current = await getAgentModel(env);
    return Response.json({
      current_id: current,
      current_alias: aliasForModel(current),
      options: Object.entries(MODEL_OPTIONS).map(([alias, o]) => ({
        alias,
        id: o.id,
        label: o.label,
        cost_hint: o.cost_hint,
      })),
    });
  }

  if (req.method === "PUT") {
    const body = (await safeJson<{ alias?: string; id?: string }>(req)) ?? {};
    const wanted = (body.alias ?? body.id ?? "").trim();
    // Resolve to a canonical id: accept an alias OR a full id.
    const match =
      MODEL_OPTIONS[wanted]?.id ??
      Object.values(MODEL_OPTIONS).find((o) => o.id === wanted)?.id;
    if (!match) {
      return Response.json(
        { error: `unknown model "${wanted}" — choose one of: ${Object.keys(MODEL_OPTIONS).join(", ")}` },
        { status: 400 },
      );
    }
    await env.CONFIG.put("AGENT_MODEL", match);
    return Response.json({ ok: true, current_id: match, current_alias: aliasForModel(match) });
  }

  return methodNotAllowed("GET, PUT");
}

async function safeJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}
