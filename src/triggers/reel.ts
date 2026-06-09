import type { Env } from "../env";
import { requireBearer } from "../api/auth";
import { getReelProject, updateReelProject } from "../db";
import { missingReelKeys, reelConfigHint } from "../lib/config-check";
import { checkLicense } from "../lib/license";
import { tgSendMessage } from "../telegram/api";

/** Start the reel render workflow for an existing reel_projects row, mark the
 *  row `editing`, and stash the workflow instance id. Shared by the Telegram
 *  ingest (full-edit / raw / b-roll), the Re-render button, and the
 *  /trigger/reel HTTP entrypoint. Returns the workflow instance id, or "" if the
 *  install isn't configured to render yet (the buyer gets a clear Telegram hint). */
export async function startReelRender(env: Env, projectId: string): Promise<string> {
  // License gate (open-core): the engine is public, render/publish need a paid key.
  const lic = await checkLicense(env);
  if (!lic.valid) {
    const project = await getReelProject(env, projectId);
    if (project?.telegram_chat_id) {
      await tgSendMessage(env, Number(project.telegram_chat_id), `🔒 ${lic.reason}`).catch(() => {});
    }
    await updateReelProject(env, projectId, { status: "failed", error_message: `license: ${lic.reason}` });
    return "";
  }
  // Pre-flight: a missing key here would otherwise surface as a cryptic
  // container failure minutes later. Fail fast with a plain-language message.
  const missing = missingReelKeys(env);
  if (missing.length) {
    const project = await getReelProject(env, projectId);
    if (project?.telegram_chat_id) {
      await tgSendMessage(env, Number(project.telegram_chat_id), reelConfigHint(missing)).catch(() => {});
    }
    await updateReelProject(env, projectId, {
      status: "failed",
      error_message: `not configured: ${missing.join("; ")}`,
    });
    return "";
  }

  const instance = await env.REEL_RENDER_WORKFLOW.create({ params: { project_id: projectId } });
  await updateReelProject(env, projectId, {
    status: "editing",
    workflow_id: instance.id,
    error_message: null,
  });
  return instance.id;
}

/** POST /trigger/reel { project_id } — kick a render for an existing reel
 *  project (used for re-render / external callers). Bearer-guarded. */
export async function handleReel(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  if (req.method !== "POST") return new Response("POST required", { status: 405 });

  const guard = await requireBearer(req, env);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { project_id?: string };
  if (!body.project_id) {
    return Response.json({ error: "missing 'project_id'" }, { status: 400 });
  }

  const project = await getReelProject(env, body.project_id);
  if (!project) {
    return Response.json({ error: `reel project not found: ${body.project_id}` }, { status: 404 });
  }
  if (!project.raw_video_url || project.raw_video_url === "pending") {
    return Response.json({ error: "reel has no source video" }, { status: 400 });
  }

  const workflowId = await startReelRender(env, body.project_id);
  return Response.json({ ok: true, project_id: body.project_id, workflow_id: workflowId });
}
