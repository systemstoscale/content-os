import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env";
import { requireBearer, methodNotAllowed } from "./auth";
import { getAgentModel } from "../lib/model";
import { logAnthropicCost } from "../lib/cost-tracking";
import { callZernioMcpTool } from "../clients/zernio-mcp";
import { getCredential } from "../lib/credentials";

/** /api/ideas — content idea bank (Phase 3, ideation).
 *
 *  GET  /api/ideas            → pending ideas
 *  POST /api/ideas/generate   → AI generates ideas from the brand kit
 *  POST /api/ideas/{id}       → { action: "use" | "dismiss" }
 *
 *  "Use" is wired in the UI to also kick /api/posting/manual, so an idea flows
 *  straight into the content pipeline (ideation → creation) in one tap. */
export async function handleIdeasApi(req: Request, env: Env, pathTail: string): Promise<Response> {
  const guard = await requireBearer(req, env);
  if (guard) return guard;

  if (pathTail === "" || pathTail === "/") {
    if (req.method === "GET") return listIdeas(env);
    return methodNotAllowed("GET");
  }
  if (pathTail === "/generate") {
    if (req.method !== "POST") return methodNotAllowed("POST");
    return generateIdeas(req, env);
  }
  const m = pathTail.match(/^\/([^/]+)$/);
  if (m) {
    if (req.method !== "POST") return methodNotAllowed("POST");
    return updateIdea(req, env, m[1]!);
  }
  return Response.json({ error: "unknown ideas route" }, { status: 404 });
}

async function listIdeas(env: Env): Promise<Response> {
  const rs = await env.DB.prepare(
    `SELECT id, created_at, hook, angle, pillar, format_hint, status, source
       FROM content_ideas WHERE status = 'pending'
       ORDER BY created_at DESC LIMIT 100`,
  )
    .all()
    .catch(() => ({ results: [] as unknown[] }));
  return Response.json({ ideas: rs.results ?? [] });
}

interface GeneratedIdea {
  hook?: string;
  angle?: string;
  pillar?: string;
  format_hint?: string;
}

interface ZAnalyticsPost {
  content?: string;
  status?: string;
  analytics?: { likes?: number; comments?: number; shares?: number; saves?: number; impressions?: number };
  platforms?: { analytics?: { likes?: number; comments?: number; shares?: number; saves?: number } }[];
}

/** Pull the top-engaging published posts from Zernio so ideation can "do more
 *  of what worked." Best-effort: returns [] if the key is missing or the call
 *  fails — ideation still runs on the brand kit alone. */
export async function topPerformers(env: Env, take: number): Promise<string[]> {
  if (!(await getCredential(env, "ZERNIO_API_KEY"))) return [];
  try {
    const res = await callZernioMcpTool<{ posts?: ZAnalyticsPost[] }>(env, "analytics_get_analytics", {
      limit: 50,
    });
    const eng = (p: ZAnalyticsPost): number => {
      const a = p.analytics ?? {};
      const fromPlatforms = (p.platforms ?? []).reduce((s, pl) => {
        const x = pl.analytics ?? {};
        return s + (x.likes ?? 0) + (x.comments ?? 0) + (x.shares ?? 0) + (x.saves ?? 0);
      }, 0);
      return (a.likes ?? 0) + (a.comments ?? 0) + (a.shares ?? 0) + (a.saves ?? 0) + fromPlatforms;
    };
    return (res.posts ?? [])
      .filter((p) => (p.status ?? "").toLowerCase() === "published" && (p.content ?? "").trim())
      .map((p) => ({ p, e: eng(p) }))
      .filter((x) => x.e > 0)
      .sort((a, b) => b.e - a.e)
      .slice(0, take)
      .map((x) => `(${x.e} engagements) ${x.p.content!.trim().replace(/\s+/g, " ").slice(0, 220)}`);
  } catch {
    return [];
  }
}

async function generateIdeas(req: Request, env: Env): Promise<Response> {
  const body = (await safeJson<{ count?: number; topic?: string }>(req)) ?? {};
  const count = Math.min(Math.max(body.count ?? 8, 1), 15);

  const [voice, business, hooks, pillars, belief, winners] = await Promise.all([
    env.CONFIG.get("voice-fingerprint.md"),
    env.CONFIG.get("business-brief.md"),
    env.CONFIG.get("hook-bank.md"),
    env.CONFIG.get("content-pillars.md"),
    env.CONFIG.get("belief-map.md"),
    topPerformers(env, 5),
  ]);

  const model = await getAgentModel(env);
  const anthropic = new Anthropic({ apiKey: await getCredential(env, "ANTHROPIC_API_KEY") });
  const prompt = [
    `You are the content strategist for this brand. Generate ${count} fresh, scroll-stopping post ideas.`,
    body.topic ? `Focus the batch on this topic: ${body.topic}` : `Spread across the content pillars.`,
    ``,
    `Each idea: a punchy HOOK (the opening line, the thing that stops the scroll), a 1-line ANGLE (the take it argues), the PILLAR it fits, and a FORMAT_HINT (one of: carousel, quote_post, reel, text_post, youtube).`,
    `No hype, no clichés, no em-dashes. Sound like the voice below. Never invent stats or client names.`,
    ``,
    `# Voice`,
    voice ?? "(neutral, direct, no-hype)",
    ``,
    `# Business`,
    business ?? "(not set)",
    ``,
    `# Hook bank (draw inspiration, don't copy)`,
    hooks ?? "(none)",
    ``,
    `# Content pillars`,
    pillars ?? "(none — use sensible business themes)",
    ``,
    ...(belief
      ? [
          `# Belief shifts (hidden objections → the belief that dissolves them; aim ideas at moving ONE of these)`,
          belief,
          ``,
        ]
      : []),
    ...(winners.length
      ? [
          `# What's worked (your top posts by engagement — mine these patterns: the hook shape, angle, and format that earned attention. Generate MORE in this vein, don't repeat them verbatim)`,
          ...winners.map((w, i) => `${i + 1}. ${w}`),
          ``,
        ]
      : []),
    `Return strictly JSON: {"ideas": [{"hook": "...", "angle": "...", "pillar": "...", "format_hint": "carousel|quote_post|reel|text_post|youtube"}, ... ${count} entries]}`,
  ].join("\n");

  let parsed: { ideas?: GeneratedIdea[] } = {};
  try {
    const resp = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    void logAnthropicCost(env, model, resp.usage ?? {}, { stage: "idea_generate" });
    const txt = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const match = txt.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]) as { ideas?: GeneratedIdea[] };
  } catch (e) {
    return Response.json({ error: `generation failed: ${String(e).slice(0, 200)}` }, { status: 502 });
  }

  const ideas = (parsed.ideas ?? []).filter((i) => i.hook?.trim());
  if (ideas.length === 0) return Response.json({ ok: true, inserted: 0 });

  const now = Date.now();
  const stmts = ideas.map((i) =>
    env.DB.prepare(
      `INSERT INTO content_ideas (id, created_at, hook, angle, pillar, format_hint, status, source)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 'ai')`,
    ).bind(
      `idea_${randomHex(8)}`,
      now,
      i.hook!.trim().slice(0, 280),
      (i.angle ?? "").trim().slice(0, 500) || null,
      (i.pillar ?? "").trim().slice(0, 80) || null,
      (i.format_hint ?? "").trim().slice(0, 40) || null,
    ),
  );
  await env.DB.batch(stmts);
  return Response.json({ ok: true, inserted: ideas.length });
}

async function updateIdea(req: Request, env: Env, id: string): Promise<Response> {
  const body = (await safeJson<{ action?: string }>(req)) ?? {};
  const status = body.action === "use" ? "used" : "dismissed";
  await env.DB.prepare(`UPDATE content_ideas SET status = ? WHERE id = ?`).bind(status, id).run();
  return Response.json({ ok: true, status });
}

async function safeJson<T>(req: Request): Promise<T | null> {
  try {
    const t = await req.text();
    return t ? (JSON.parse(t) as T) : null;
  } catch {
    return null;
  }
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
