import type { Env } from "../env";
import { getCredential } from "../lib/credentials";

/** JSON-RPC client for https://mcp.zernio.com/mcp.
 *
 *  Auth is the existing ZERNIO_API_KEY secret (already set by install.sh
 *  for every install) presented as `Authorization: Bearer <key>`. No new
 *  OAuth dance — the same key that powers our direct REST integration
 *  also unlocks the MCP surface.
 *
 *  The server returns standard MCP envelopes wrapped in SSE-formatted
 *  HTTP responses (one `data: <json>` line per response). We parse that
 *  inline and return either structuredContent (typed payload) or the
 *  raw text content. Mirror of Higgsfield + Meta MCP clients. */

const MCP_URL = "https://mcp.zernio.com/mcp";

interface McpEnvelope<T = unknown> {
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: T;
    isError?: boolean;
    tools?: unknown[];
  };
  error?: { code: number; message: string };
}

async function callMcp<T = unknown>(
  env: Env,
  method: "tools/list" | "tools/call",
  params: Record<string, unknown>,
): Promise<T> {
  const zernioKey = await getCredential(env, "ZERNIO_API_KEY");
  if (!zernioKey) {
    throw new Error("ZERNIO_API_KEY not set");
  }
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${zernioKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zernio MCP ${method} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  const jsonText = dataLine ? dataLine.slice(6) : text;
  const envelope = JSON.parse(jsonText) as McpEnvelope<T>;
  if (envelope.error) {
    throw new Error(`Zernio MCP ${method} error ${envelope.error.code}: ${envelope.error.message}`);
  }
  if (envelope.result?.isError) {
    const errText = envelope.result.content?.[0]?.text ?? "unknown MCP tool error";
    throw new Error(`Zernio MCP tool error: ${errText}`);
  }
  // structuredContent often wraps a Python-repr string in { result: "{...}" } —
  // unwrap it and fall through to text parsing if so.
  const sc = envelope.result?.structuredContent as { result?: string } | undefined;
  const firstText = sc?.result ?? envelope.result?.content?.[0]?.text;
  if (firstText) {
    // Zernio formats payloads as Python repr (single quotes, True/False/None).
    // Try JSON.parse first (some tools DO return real JSON); fall back to a
    // Python-literal → JSON conversion for the rest.
    try {
      return JSON.parse(firstText) as T;
    } catch {
      try {
        return JSON.parse(pythonReprToJson(firstText)) as T;
      } catch {
        // Last resort: return the raw text under a `_raw` field so the
        // caller can decide what to do.
        return { _raw: firstText } as unknown as T;
      }
    }
  }
  if (envelope.result?.structuredContent !== undefined) return envelope.result.structuredContent;
  return envelope.result?.content as unknown as T;
}

/** Convert Python's str(dict) / repr() output into valid JSON.
 *
 *  Handles the cases Zernio's MCP actually returns:
 *    - True / False / None as bare words → true / false / null
 *    - Outer single-quoted strings → double-quoted
 *    - Escaped apostrophes inside strings (\\') → escaped single quotes
 *    - Existing double quotes inside strings → escaped
 *
 *  Does NOT handle: tuples, sets, complex numbers, custom repr() output.
 *  All of which would be Zernio bugs anyway. */
export function pythonReprToJson(src: string): string {
  let i = 0;
  let out = "";
  const n = src.length;

  while (i < n) {
    const c = src[i]!;

    // Word-boundary True / False / None → JSON equivalents.
    if (c === "T" && src.startsWith("True", i) && !isWordChar(src[i + 4])) {
      out += "true";
      i += 4;
      continue;
    }
    if (c === "F" && src.startsWith("False", i) && !isWordChar(src[i + 5])) {
      out += "false";
      i += 5;
      continue;
    }
    if (c === "N" && src.startsWith("None", i) && !isWordChar(src[i + 4])) {
      out += "null";
      i += 4;
      continue;
    }

    // Single-quoted string: walk until matching unescaped '.
    if (c === "'") {
      out += '"';
      i++;
      while (i < n) {
        const ch = src[i]!;
        if (ch === "\\") {
          // Escape sequence — copy the backslash + next char as-is, but
          // unescape \\' (Python's escaped apostrophe inside a string) to
          // a literal ' (which is fine inside JSON's double-quoted string).
          const next = src[i + 1];
          if (next === "'") {
            out += "'";
            i += 2;
          } else {
            out += ch;
            if (i + 1 < n) {
              out += src[i + 1];
              i += 2;
            } else {
              i++;
            }
          }
          continue;
        }
        if (ch === "'") {
          out += '"';
          i++;
          break;
        }
        if (ch === '"') {
          // Bare double quote inside a Python single-quoted string needs
          // escaping for JSON.
          out += '\\"';
          i++;
          continue;
        }
        out += ch;
        i++;
      }
      continue;
    }

    // Double-quoted strings (rare in Python repr, but valid). Walk verbatim.
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        const ch = src[i]!;
        out += ch;
        i++;
        if (ch === "\\" && i < n) {
          out += src[i]!;
          i++;
          continue;
        }
        if (ch === '"') break;
      }
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[A-Za-z0-9_]/.test(ch);
}

export async function listZernioMcpTools(env: Env): Promise<unknown> {
  return callMcp(env, "tools/list", {});
}

export async function callZernioMcpTool<T = unknown>(
  env: Env,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return callMcp<T>(env, "tools/call", { name, arguments: args });
}
