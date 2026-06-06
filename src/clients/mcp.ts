import type { Env } from "../env";
import { pythonReprToJson } from "./zernio-mcp";

/** Generic Worker-side MCP client (MCP-first foundation).
 *
 *  The Worker talks JSON-RPC-over-SSE to provider MCP servers (Zernio). This
 *  generalizes that into one call surface so any provider that ships a
 *  Worker-callable MCP server — authed by API-key (header) or OAuth (bearer) —
 *  can be driven the same way. REST stays the fallback only where a provider
 *  has no Worker-callable MCP.
 *
 *  Only servers VERIFIED Worker-callable are registered here. New ones must be
 *  confirmed (URL + auth shape) before being added — never guess a URL. */

export interface McpServerSpec {
  url: string;
  /** Full Authorization header value (e.g. "Bearer xyz" or a bare key), or
   *  null when the provider isn't configured/connected. */
  auth: (env: Env) => Promise<string | null>;
  /** Zernio returns Python-repr payloads; others return real JSON. */
  pythonRepr?: boolean;
  label: string;
}

export const MCP_SERVERS: Record<string, McpServerSpec> = {
  zernio: {
    url: "https://mcp.zernio.com/mcp",
    auth: async (env) => (env.ZERNIO_API_KEY ? `Bearer ${env.ZERNIO_API_KEY}` : null),
    pythonRepr: true,
    label: "Zernio",
  },
};

interface McpEnvelope<T = unknown> {
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: T;
    isError?: boolean;
    tools?: unknown[];
  };
  error?: { code: number; message: string };
}

async function rpc<T = unknown>(
  env: Env,
  serverKey: keyof typeof MCP_SERVERS | string,
  method: "tools/list" | "tools/call",
  params: Record<string, unknown>,
): Promise<T> {
  const spec = MCP_SERVERS[serverKey];
  if (!spec) throw new Error(`unknown MCP server: ${serverKey}`);
  const authValue = await spec.auth(env);
  if (!authValue) throw new Error(`${spec.label} MCP not configured`);

  const res = await fetch(spec.url, {
    method: "POST",
    headers: {
      Authorization: authValue,
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${spec.label} MCP ${method} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  const jsonText = dataLine ? dataLine.slice(6) : text;
  const envelope = JSON.parse(jsonText) as McpEnvelope<T>;
  if (envelope.error) {
    throw new Error(`${spec.label} MCP ${method} error ${envelope.error.code}: ${envelope.error.message}`);
  }
  if (envelope.result?.isError) {
    throw new Error(`${spec.label} MCP tool error: ${envelope.result.content?.[0]?.text ?? "unknown"}`);
  }
  if (method === "tools/list") return envelope.result as unknown as T;

  const sc = envelope.result?.structuredContent as { result?: string } | undefined;
  const firstText = sc?.result ?? envelope.result?.content?.[0]?.text;
  if (firstText) {
    try {
      return JSON.parse(firstText) as T;
    } catch {
      if (spec.pythonRepr) {
        try {
          return JSON.parse(pythonReprToJson(firstText)) as T;
        } catch {
          /* fall through */
        }
      }
      return { _raw: firstText } as unknown as T;
    }
  }
  if (envelope.result?.structuredContent !== undefined) return envelope.result.structuredContent;
  return envelope.result?.content as unknown as T;
}

/** Call a tool on a registered provider MCP server. */
export async function callProviderMcp<T = unknown>(
  env: Env,
  server: keyof typeof MCP_SERVERS | string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return rpc<T>(env, server, "tools/call", { name: tool, arguments: args });
}

/** List the tools a provider MCP server exposes (used to feature-detect, e.g.
 *  whether Instantly's MCP can create a webhook before falling back to REST). */
export async function listProviderMcpTools(
  env: Env,
  server: keyof typeof MCP_SERVERS | string,
): Promise<{ tools?: Array<{ name: string }> }> {
  return rpc(env, server, "tools/list", {});
}

/** True when a provider MCP server is configured/connected for this install. */
export async function isMcpConfigured(env: Env, server: keyof typeof MCP_SERVERS | string): Promise<boolean> {
  const spec = MCP_SERVERS[server];
  if (!spec) return false;
  return (await spec.auth(env).catch(() => null)) != null;
}
