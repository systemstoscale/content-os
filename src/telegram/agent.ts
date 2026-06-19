import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env";
import { buildSystemPrompt } from "../prompts/system";
import { TOOL_SCHEMAS, dispatchTool } from "../tools";
import { logSession } from "../db";
import { getCredential } from "../lib/credentials";

const BETA_HEADER = "managed-agents-2026-04-01,mcp-client-2025-04-04";
const MODEL = "claude-haiku-4-5-20251001";

interface McpServer {
  type: "url";
  url: string;
  name: string;
  authorization_token?: string;
}

async function buildMcpServers(env: Env): Promise<McpServer[]> {
  // Zernio is the only MCP server (media generation runs on KIE.AI via local
  // tools). Returns [] when ZERNIO_API_KEY is unset — chat falls back to the
  // local TOOL_SCHEMAS only.
  const zernioKey = await getCredential(env, "ZERNIO_API_KEY");
  if (!zernioKey) return [];
  return [
    {
      type: "url",
      url: "https://mcp.zernio.com/mcp",
      name: "zernio",
      authorization_token: zernioKey,
    },
  ];
}
const MAX_TURNS = 12;
const MAX_TOKENS = 4096;

/** Max conversation turns to load as context. Older turns are pruned to keep
 *  the prompt under budget. ~12 turns ≈ ~20k context tokens typically. */
const CONTEXT_TURN_LIMIT = 12;

export type TgContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface TgTurnResult {
  finalText: string;
  toolCalls: Array<{ name: string; input: unknown; output: unknown }>;
  tokensIn: number;
  tokensOut: number;
  imagesProduced: string[];
}

export async function runTelegramTurn(
  env: Env,
  chat_id: number,
  userBlocks: TgContentBlock[]
): Promise<TgTurnResult> {
  const client = new Anthropic({
    apiKey: await getCredential(env, "ANTHROPIC_API_KEY"),
    defaultHeaders: { "anthropic-beta": BETA_HEADER },
  });

  const system = await buildSystemPrompt(env);
  const history = await loadHistory(env, chat_id);

  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: userBlocks as unknown as Anthropic.ContentBlockParam[] },
  ];

  const toolCalls: TgTurnResult["toolCalls"] = [];
  const imagesProduced: string[] = [];
  let finalText = "";
  let tokensIn = 0;
  let tokensOut = 0;

  const mcpServers = await buildMcpServers(env);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: TOOL_SCHEMAS,
      messages,
    };
    if (mcpServers.length > 0) {
      (params as unknown as { mcp_servers: McpServer[] }).mcp_servers = mcpServers;
    }
    // Stream → SSE keepalives keep the connection alive past Cloudflare's
    // 100s idle-fetch timeout for slow MCP tool calls.
    const response = await client.messages.stream(params).finalMessage();

    tokensIn += response.usage?.input_tokens ?? 0;
    tokensOut += response.usage?.output_tokens ?? 0;

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUses.length === 0) {
      finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      let out: unknown;
      try {
        out = await dispatchTool({ env, source: "telegram" }, tu.name, tu.input as Record<string, unknown>);
      } catch (e) {
        out = { error: String(e) };
      }
      toolCalls.push({ name: tu.name, input: tu.input, output: out });

      // Collect rendered image URLs so the Telegram trigger can deliver
      // them as photos in the chat.
      if (
        (tu.name === "render_quote_post" || tu.name === "render_thumbnail") &&
        typeof out === "object" &&
        out !== null &&
        "public_url" in out
      ) {
        const url = (out as { public_url: string }).public_url;
        if (url) imagesProduced.push(absoluteR2Url(env, url));
      }
      if (tu.name === "render_carousel" && typeof out === "object" && out !== null && "assets" in out) {
        const assets = (out as { assets: Array<{ public_url: string }> }).assets;
        for (const a of assets) {
          if (a.public_url) imagesProduced.push(absoluteR2Url(env, a.public_url));
        }
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(out),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Persist this turn (user + assistant) to history.
  await persistTurn(env, chat_id, "user", userBlocks, tokensIn, 0);
  await persistTurn(
    env,
    chat_id,
    "assistant",
    [{ type: "text", text: finalText }],
    0,
    tokensOut
  );
  await bumpChatCounters(env, chat_id, tokensIn, tokensOut);

  await logSession(env, {
    id: `tg_${chat_id}_${Date.now()}`,
    source: "telegram",
    intent: extractText(userBlocks).slice(0, 500),
    outcome: finalText.slice(0, 500),
    toolCalls: toolCalls.length,
  });

  return { finalText, toolCalls, tokensIn, tokensOut, imagesProduced };
}

async function loadHistory(env: Env, chat_id: number): Promise<Anthropic.MessageParam[]> {
  const rs = await env.DB.prepare(
    `SELECT role, content_json FROM tg_turns
     WHERE chat_id = ?
     ORDER BY created_at DESC LIMIT ?`
  )
    .bind(chat_id, CONTEXT_TURN_LIMIT)
    .all<{ role: string; content_json: string }>();
  const rows = (rs.results ?? []).reverse();
  return rows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: JSON.parse(r.content_json) as Anthropic.ContentBlockParam[],
  }));
}

async function persistTurn(
  env: Env,
  chat_id: number,
  role: "user" | "assistant",
  blocks: TgContentBlock[],
  tokensIn: number,
  tokensOut: number
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO tg_turns (chat_id, created_at, role, content_json, tokens_in, tokens_out)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(chat_id, Date.now(), role, JSON.stringify(blocks), tokensIn || null, tokensOut || null)
    .run();
}

async function bumpChatCounters(
  env: Env,
  chat_id: number,
  tokensIn: number,
  tokensOut: number
): Promise<void> {
  await env.DB.prepare(
    `UPDATE tg_chats
     SET total_tokens_in = total_tokens_in + ?,
         total_tokens_out = total_tokens_out + ?,
         turn_count = turn_count + 1,
         last_active_at = ?
     WHERE chat_id = ?`
  )
    .bind(tokensIn, tokensOut, Date.now(), chat_id)
    .run();
}

export async function resetHistory(env: Env, chat_id: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM tg_turns WHERE chat_id = ?`).bind(chat_id).run();
}

export async function getChatStats(
  env: Env,
  chat_id: number
): Promise<{ turn_count: number; tokens_in: number; tokens_out: number } | null> {
  const row = await env.DB.prepare(
    `SELECT turn_count, total_tokens_in as tokens_in, total_tokens_out as tokens_out
     FROM tg_chats WHERE chat_id = ?`
  )
    .bind(chat_id)
    .first<{ turn_count: number; tokens_in: number; tokens_out: number }>();
  return row ?? null;
}

function extractText(blocks: TgContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function absoluteR2Url(env: Env, relativeOrAbs: string): string {
  if (relativeOrAbs.startsWith("http")) return relativeOrAbs;
  // Worker hostname is the dev URL; fallback to relative if not constructible
  return `https://content-os.admin-2ab.workers.dev${relativeOrAbs}`;
}
