import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import { buildSystemPrompt } from "./prompts/system";
import { TOOL_SCHEMAS, dispatchTool } from "./tools";
import { logSession } from "./db";
import { logAnthropicCost } from "./lib/cost-tracking";
import { getAgentModel } from "./lib/model";

// `managed-agents` is what enables our long tool-use loop. `mcp-client` is
// what lets us pass `mcp_servers` on /messages so the model can call MCP
// servers (currently Zernio) through Anthropic's infrastructure.
const BETA_HEADER = "managed-agents-2026-04-01,mcp-client-2025-04-04";
const MAX_TURNS = 12;
const MAX_TOKENS = 4096;

interface McpServer {
  type: "url";
  url: string;
  name: string;
  authorization_token?: string;
}

/** Build the mcp_servers array attached to every /messages call.
 *
 *  Servers added at runtime depending on which credentials the install has:
 *    - Zernio: any install with ZERNIO_API_KEY set (set by install.sh).
 *      Exposes 343 tools across 28 categories — analytics, ads, inbox,
 *      messaging, comments, comment-to-DM automations, sequences,
 *      WhatsApp broadcasts, multi-platform ads (TikTok/X/Pinterest/LinkedIn),
 *      Reddit, Google Business reviews, etc. All without us shipping
 *      wrappers — the model sees them as first-class tools.
 *  (Media generation runs on KIE.AI via local tools, not MCP.)
 *
 *  Returns [] when not configured; the agent then runs without external MCP
 *  and only our locally-defined TOOL_SCHEMAS are available. */
async function buildMcpServers(env: Env): Promise<McpServer[]> {
  const servers: McpServer[] = [];

  if (env.ZERNIO_API_KEY) {
    servers.push({
      type: "url",
      url: "https://mcp.zernio.com/mcp",
      name: "zernio",
      authorization_token: env.ZERNIO_API_KEY,
    });
  }

  return servers;
}

export interface AgentBrief {
  intent: string;
  source: "manual" | "email" | "telegram" | "cron";
  approval_channel: "email" | "telegram";
}

export interface AgentResult {
  sessionId: string;
  finalText: string;
  toolCalls: Array<{ name: string; input: unknown; output: unknown }>;
  error?: string;
}

export async function runSession(env: Env, brief: AgentBrief): Promise<AgentResult> {
  const sessionId = `ses_${crypto.randomUUID().slice(0, 8)}`;
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-beta": BETA_HEADER },
  });

  const system = await buildSystemPrompt(env);
  const ctx = { env, source: brief.source };
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: framedIntent(brief) },
  ];
  const toolCalls: AgentResult["toolCalls"] = [];
  let finalText = "";
  let error: string | undefined;

  // Resolve once per session — refresh-on-expiry is handled inside the helper,
  // and the access token TTL is generally minutes so it survives the loop.
  const mcpServers = await buildMcpServers(env);

  // Buyer-selected daily-driver model (default Haiku). Resolved once/session.
  const model = await getAgentModel(env);

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: MAX_TOKENS,
        system,
        tools: TOOL_SCHEMAS,
        messages,
      };
      // The SDK's MessageCreateParams type doesn't declare mcp_servers yet,
      // but the API accepts it under the mcp-client-2025-04-04 beta header.
      if (mcpServers.length > 0) {
        (params as unknown as { mcp_servers: McpServer[] }).mcp_servers = mcpServers;
      }
      // Stream so long-running MCP tool calls don't trip Cloudflare's 100s
      // idle-fetch timeout. SSE keepalives reset the timer continuously;
      // .finalMessage() resolves to the same Message we'd get from .create()
      // so downstream code is unchanged.
      //
      // Retry transient MCP connection errors: Anthropic's hosted MCP
      // sometimes can't reach a third-party server (zernio) for a few seconds.
      // Without this retry, a single flake kills a long multi-turn session.
      // After 2 retries we strip mcp_servers and let the turn run with only
      // local tools — agent loses Zernio for that one turn but completes the
      // session. (Media generation is local KIE.AI tools, unaffected.)
      const response = await callWithMcpRetry(client, params);

      // Fire-and-forget cost log. usage shape matches Anthropic's Message.
      void logAnthropicCost(env, model, response.usage ?? {}, {
        session_source: brief.source,
        turn,
      });

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
          out = await dispatchTool(ctx, tu.name, tu.input as Record<string, unknown>);
        } catch (e) {
          out = { error: String(e) };
        }
        toolCalls.push({ name: tu.name, input: tu.input, output: out });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(out),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
  } catch (e) {
    error = String(e);
  }

  await logSession(env, {
    id: sessionId,
    source: brief.source,
    intent: brief.intent,
    outcome: finalText.slice(0, 500),
    toolCalls: toolCalls.length,
    error,
  });

  return { sessionId, finalText, toolCalls, error };
}

function framedIntent(brief: AgentBrief): string {
  const tag = `[source: ${brief.source}; approval: ${brief.approval_channel}]`;
  return `${tag}\n\n${brief.intent}`;
}

/** Pattern that identifies Anthropic's "I couldn't reach your MCP server"
 *  error class. The exact message:
 *    "Connection error while communicating with MCP server. The server
 *     may be unavailable or unresponsive."
 *  In practice we see this when zernio.com briefly drops Anthropic's
 *  connection (rate limit, server reboot, network hiccup). */
function isTransientMcpError(e: unknown): boolean {
  const msg = String(e);
  return /Connection error while communicating with MCP server|MCP server.*unavailable|MCP server.*unresponsive/i.test(msg);
}

/** Call client.messages.stream(...).finalMessage() with up to 2 retries on
 *  transient MCP errors, and a final fallback that strips mcp_servers (so the
 *  turn runs with only locally-defined tools). Non-MCP errors are thrown to
 *  the outer try/catch in runSession. */
async function callWithMcpRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  const MAX_RETRIES = 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await client.messages.stream(params).finalMessage();
    } catch (e) {
      lastErr = e;
      if (!isTransientMcpError(e)) throw e;
      // Backoff: 1s, 3s. Anthropic-side MCP flakes usually recover quickly.
      const backoffMs = 1000 * (2 * attempt + 1);
      console.warn(
        `[agent] MCP transient on attempt ${attempt + 1}/${MAX_RETRIES + 1}; retrying in ${backoffMs}ms`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  // Final fallback: retry WITHOUT mcp_servers. Agent loses Zernio for this
  // single turn but the session continues.
  console.warn("[agent] MCP retries exhausted; falling back to local-tools-only");
  const fallback = { ...params } as unknown as { mcp_servers?: unknown };
  delete fallback.mcp_servers;
  try {
    return await client.messages.stream(fallback as Anthropic.MessageCreateParamsNonStreaming).finalMessage();
  } catch {
    throw lastErr;
  }
}
