import type { Env } from "../env";
import { runSession } from "../agent";

export async function handleManual(
  req: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("POST required", { status: 405 });
  }

  const body = (await req.json()) as { intent?: string };
  if (!body.intent || typeof body.intent !== "string") {
    return Response.json({ error: "missing 'intent' string" }, { status: 400 });
  }

  const result = await runSession(env, {
    intent: body.intent,
    source: "manual",
    approval_channel: "email",
  });

  return Response.json(result);
}
