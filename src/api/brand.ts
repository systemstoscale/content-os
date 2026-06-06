import type { Env } from "../env";
import { requireBearer, methodNotAllowed } from "./auth";

/** /api/brand — the content brand kit (Phase 3).
 *
 *  These four markdown docs are already injected into every content generation
 *  by buildSystemPrompt (src/prompts/system.ts) — the voice, the business brief,
 *  the hook bank, the content pillars. They drive how the whole "content team"
 *  writes. This endpoint is the editing surface (mobile-web Brand Kit page) so
 *  the founder can shape them without touching wrangler/KV. */

const KEYS = {
  voice: "voice-fingerprint.md",
  business: "business-brief.md",
  hooks: "hook-bank.md",
  pillars: "content-pillars.md",
  // Belief-shift framework (Phase 6): hidden objections → the belief that
  // dissolves them. Injected into content + ad ideation so every piece
  // pre-sells by dismantling an objection.
  belief: "belief-map.md",
} as const;

export async function handleBrandApi(req: Request, env: Env): Promise<Response> {
  const guard = await requireBearer(req, env);
  if (guard) return guard;

  if (req.method === "GET") {
    const [voice, business, hooks, pillars, belief] = await Promise.all([
      env.CONFIG.get(KEYS.voice),
      env.CONFIG.get(KEYS.business),
      env.CONFIG.get(KEYS.hooks),
      env.CONFIG.get(KEYS.pillars),
      env.CONFIG.get(KEYS.belief),
    ]);
    return Response.json({
      voice: voice ?? "",
      business: business ?? "",
      hooks: hooks ?? "",
      pillars: pillars ?? "",
      belief: belief ?? "",
    });
  }

  if (req.method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      const t = await req.text();
      body = t ? (JSON.parse(t) as Record<string, unknown>) : {};
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    const writes: Promise<unknown>[] = [];
    if (typeof body.voice === "string") writes.push(env.CONFIG.put(KEYS.voice, body.voice));
    if (typeof body.business === "string") writes.push(env.CONFIG.put(KEYS.business, body.business));
    if (typeof body.hooks === "string") writes.push(env.CONFIG.put(KEYS.hooks, body.hooks));
    if (typeof body.pillars === "string") writes.push(env.CONFIG.put(KEYS.pillars, body.pillars));
    if (typeof body.belief === "string") writes.push(env.CONFIG.put(KEYS.belief, body.belief));
    await Promise.all(writes);
    return Response.json({ ok: true, saved: writes.length });
  }

  return methodNotAllowed("GET, POST");
}
