import type { Env } from "../env";
import { requireBearer } from "../api/auth";

/** Avatar reel trigger.
 *
 *  Hands the brief off to the Avatar Reel Workflow and returns 202 with the
 *  workflow instance ID immediately. The workflow runtime then drives the
 *  multi-minute pipeline (KIE portrait → TTS → KIE lipsync → captions → cover
 *  → save_draft → Telegram preview) durably and out-of-band. */
export async function handleAvatar(
  req: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  if (req.method !== "POST") return new Response("POST required", { status: 405 });

  const guard = await requireBearer(req, env);
  if (guard) return guard;

  // Fail fast if dependencies are missing — better than burning a workflow
  // instance that's going to die at step 1.
  if (!env.KIE_AI_API_KEY) {
    return Response.json(
      { error: "KIE_AI_API_KEY secret not set — run `wrangler secret put KIE_AI_API_KEY`" },
      { status: 503 }
    );
  }
  if (!env.ELEVENLABS_API_KEY) {
    return Response.json({ error: "ELEVENLABS_API_KEY secret not set" }, { status: 503 });
  }
  // Soft check: without a headshot the creator's face won't be recognizable.
  // Don't hard-fail — a fresh install can still generate a generic talking head
  // until the buyer uploads their headshot at /setup.
  const soulRef = await env.CONFIG.get("SOUL_REFERENCE_URL");
  if (!soulRef) {
    console.warn("[avatar] CONFIG.SOUL_REFERENCE_URL not set — portrait will use a generic face until the buyer adds a headshot");
  }

  const body = (await req.json()) as {
    topic?: string;
    title?: string;
    bullets?: string[];
    cta?: string;
    setting?: string;
    aspect_ratio?: "9:16" | "1:1" | "16:9";
    asset_prefix?: string;
  };
  if (!body.topic) return Response.json({ error: "missing 'topic'" }, { status: 400 });

  const instance = await env.AVATAR_REEL_WORKFLOW.create({
    params: {
      topic: body.topic,
      title: body.title,
      bullets: body.bullets,
      cta: body.cta,
      setting: body.setting,
      aspect_ratio: body.aspect_ratio,
      asset_prefix: body.asset_prefix,
    },
  });

  return Response.json(
    {
      ok: true,
      queued: true,
      workflow_instance_id: instance.id,
      note: "Avatar reel workflow started. Watch Telegram for the preview (~5-10 min).",
    },
    { status: 202 }
  );
}
