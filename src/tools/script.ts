import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env";
import { getAgentModel } from "../lib/model";
import { logAnthropicCost } from "../lib/cost-tracking";

// write_script — one Claude call that turns a topic into a ready-to-shoot
// short-form reel script (hook + 2-4 beats + CTA) PLUS per-platform captions
// (Instagram, LinkedIn, YouTube Shorts). Brand voice + the locked CTA are read
// from CONFIG so each buyer's install writes in their own voice.

export interface GenerateScriptInput {
  topic: string;
  /** Optional format hint: "talking_head" | "screen_recording" | "broll".
   *  Steers the beat structure; defaults to a generic talking-head reel. */
  format?: string;
}

export interface ScriptOutput {
  topic: string;
  format: string;
  hook: string;
  beats: string[];
  cta: string;
  /** The full spoken script, ready to read on camera or feed to TTS. */
  script: string;
  captions: {
    instagram: string;
    linkedin: string;
    youtube_shorts: string;
  };
}

interface RawScript {
  hook?: string;
  beats?: string[];
  cta?: string;
  script?: string;
  captions?: {
    instagram?: string;
    linkedin?: string;
    youtube_shorts?: string;
  };
}

export async function generateScript(env: Env, input: GenerateScriptInput): Promise<ScriptOutput> {
  const topic = (input.topic ?? "").trim();
  if (!topic) throw new Error("topic required");
  const format = (input.format ?? "talking_head").trim() || "talking_head";

  const [voice, business, hooks, pillars, brandCta] = await Promise.all([
    env.CONFIG.get("voice-fingerprint.md"),
    env.CONFIG.get("business-brief.md"),
    env.CONFIG.get("hook-bank.md"),
    env.CONFIG.get("content-pillars.md"),
    env.CONFIG.get("BRAND_CTA"),
  ]);

  const creatorName = env.CREATOR_NAME || (await env.CONFIG.get("CREATOR_NAME")) || "the creator";

  const system = [
    `You are the short-form scriptwriter for ${creatorName}.`,
    `Write a TIGHT short-form reel script: a scroll-stopping HOOK, 2-4 punchy BEATS, and a CTA.`,
    `Then write three platform-tailored captions (Instagram, LinkedIn, YouTube Shorts).`,
    `Rules: read-aloud-naturally, no bracketed stage directions, no on-screen-text cues, no asterisks, no em dashes, no ellipses. Never invent stats or client names.`,
    brandCta
      ? `The CTA MUST be this locked brand CTA verbatim (or a tight paraphrase that keeps the exact ask): ${brandCta}`
      : `End on a single clear CTA appropriate to the brand.`,
    `Caption guidance: Instagram = punchy, line breaks, 3-5 hashtags. LinkedIn = a hooky first line, short paragraphs, no hashtags. YouTube Shorts = a 1-line description plus 3-5 #tags.`,
    ``,
    `# Voice fingerprint`,
    voice ?? "(neutral, direct, no-hype)",
    ``,
    `# Business brief`,
    business ?? "(not configured)",
    ``,
    `# Hook bank (draw inspiration, do not copy verbatim)`,
    hooks ?? "(none)",
    ``,
    `# Content pillars`,
    pillars ?? "(none — use sensible business themes)",
    ``,
    `Return STRICTLY JSON, no prose around it:`,
    `{"hook":"...","beats":["...","..."],"cta":"...","script":"<full spoken script: hook then beats then cta>","captions":{"instagram":"...","linkedin":"...","youtube_shorts":"..."}}`,
  ].join("\n");

  const user = [`Topic: ${topic}`, `Format: ${format}`].join("\n");

  const model = await getAgentModel(env);
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-beta": "managed-agents-2026-04-01" },
  });

  const msg = await client.messages
    .stream({
      model,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
    })
    .finalMessage();

  void logAnthropicCost(env, model, msg.usage ?? {}, { stage: "write_script" });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  let parsed: RawScript = {};
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      parsed = JSON.parse(match[0]) as RawScript;
    } catch {
      parsed = {};
    }
  }

  const hook = (parsed.hook ?? "").trim();
  const beats = (parsed.beats ?? []).map((b) => String(b).trim()).filter(Boolean);
  const cta = (parsed.cta ?? brandCta ?? "").trim();
  // Fall back to assembling the script from parts if the model didn't return one.
  const script =
    (parsed.script ?? "").trim() ||
    [hook, ...beats, cta].filter(Boolean).join("\n\n");

  if (!script) throw new Error("LLM returned empty script");

  const captions = parsed.captions ?? {};
  return {
    topic,
    format,
    hook,
    beats,
    cta,
    script,
    captions: {
      instagram: (captions.instagram ?? "").trim(),
      linkedin: (captions.linkedin ?? "").trim(),
      youtube_shorts: (captions.youtube_shorts ?? "").trim(),
    },
  };
}
