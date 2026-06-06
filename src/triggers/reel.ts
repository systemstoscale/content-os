import type { Env } from "../env";
import { requireBearer } from "../api/auth";
import { getReelProject, updateReelProject } from "../db";

/** Start the reel render workflow for an existing reel_projects row, mark the
 *  row `editing`, and stash the workflow instance id. Shared by the Telegram
 *  ingest (full-edit / raw / b-roll), the Re-render button, and the
 *  /trigger/reel HTTP entrypoint. Returns the workflow instance id. */
export async function startReelRender(env: Env, projectId: string): Promise<string> {
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
