import type { Env } from "../env";
import { insertContentIdea } from "../db";

// save_idea — persist a content idea into the idea bank (migration 0019).
// Lets the agent capture an idea from a voice note ("save this as an idea")
// straight into the `content_ideas` table that /api/ideas surfaces in the UI.

export interface SaveIdeaInput {
  hook: string;
  angle?: string;
  pillar?: string;
  format_hint?: string;
}

export interface SaveIdeaOutput {
  ok: boolean;
  idea_id?: string;
  error?: string;
}

export async function saveIdea(env: Env, input: SaveIdeaInput, source: string): Promise<SaveIdeaOutput> {
  const hook = (input.hook ?? "").trim();
  if (!hook) return { ok: false, error: "hook required" };
  const { id } = await insertContentIdea(env, {
    hook,
    angle: input.angle,
    pillar: input.pillar,
    format_hint: input.format_hint,
    source: source || "manual",
  });
  return { ok: true, idea_id: id };
}
