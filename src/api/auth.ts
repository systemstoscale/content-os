import type { Env } from "../env";
import { hashPassword, verifyPassword } from "../lib/password";

/** Auth for /api/* and /trigger/* routes.
 *
 *  Two credential paths exist in v1:
 *    1. **Cookie session** — humans use the SPA. POST /api/auth/login with
 *       email+password mints an `auth_sessions` row, sets HTTP-only cookie
 *       `cos_session=<id>`. Subsequent requests are authed by reading the
 *       cookie and looking up the session row.
 *    2. **Bearer token** — curl and operator scripts present
 *       `Authorization: Bearer <CONTENT_OS_API_TOKEN>`. Same secret
 *       that's gated /trigger/* since the beginning. No DB lookup.
 *
 *  Anything that's a request from a real user reaches us via #1; anything
 *  scripted reaches us via #2. `requireAuth()` accepts either. */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = "cos_session";

export interface AuthedRequest {
  email: string;
  role: string;
  via: "cookie" | "bearer";
}

/** Read the session cookie from a Request. Returns null if not present. */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** Check whether the request has valid auth. Returns a successful auth
 *  context, or a 401 Response that the caller should return as-is. */
export async function requireAuth(req: Request, env: Env): Promise<AuthedRequest | Response> {
  // 1) Cookie session — preferred for human (SPA) traffic.
  const cookie = readCookie(req, COOKIE_NAME);
  if (cookie) {
    const row = await env.DB.prepare(
      `SELECT s.id, s.email, s.expires_at, u.role
       FROM auth_sessions s JOIN users u ON u.email = s.email
       WHERE s.id = ?`,
    )
      .bind(cookie)
      .first<{ id: string; email: string; expires_at: number; role: string }>();
    if (row && row.expires_at > Date.now()) {
      return { email: row.email, role: row.role, via: "cookie" };
    }
    if (row && row.expires_at <= Date.now()) {
      // Lazy cleanup of expired sessions.
      await env.DB.prepare(`DELETE FROM auth_sessions WHERE id = ?`).bind(cookie).run();
    }
  }

  // 2) Bearer token — operator / curl.
  //    Source order:
  //      a) env.CONTENT_OS_API_TOKEN (legacy operator install via wrangler
  //         secret put — back-compat for existing instances)
  //      b) CONFIG.CONTENT_OS_API_TOKEN (Deploy-button installs — set by
  //         /setup wizard since Worker secrets can't be written from inside)
  const auth = req.headers.get("authorization") ?? "";
  const expectedEnv = env.CONTENT_OS_API_TOKEN;
  if (expectedEnv && auth === `Bearer ${expectedEnv}`) {
    return { email: "operator", role: "operator", via: "bearer" };
  }
  if (auth.startsWith("Bearer ")) {
    const expectedConfig = await env.CONFIG.get("CONTENT_OS_API_TOKEN");
    if (expectedConfig && auth === `Bearer ${expectedConfig}`) {
      return { email: "operator", role: "operator", via: "bearer" };
    }
  }

  return Response.json({ error: "unauthorized" }, { status: 401 });
}

/** Back-compat alias so existing routes (drafts, paid, health-full) can
 *  swap `requireBearer` → `requireAuth` with a one-line change. */
export async function requireBearer(req: Request, env: Env): Promise<Response | null> {
  const result = await requireAuth(req, env);
  return result instanceof Response ? result : null;
}

export function methodNotAllowed(allowed: string): Response {
  return new Response(`expected ${allowed}`, {
    status: 405,
    headers: { allow: allowed },
  });
}

// ─── Route handlers ──────────────────────────────────────────────────────────

/** /api/auth/* dispatcher. Wired in src/index.ts. */
export async function handleAuthApi(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  pathTail: string, // "/login", "/logout", "/me", "/change-password"
): Promise<Response> {
  switch (pathTail) {
    case "/login":
      return req.method === "POST" ? login(req, env) : methodNotAllowed("POST");
    case "/logout":
      return req.method === "POST" ? logout(req, env) : methodNotAllowed("POST");
    case "/me":
      return req.method === "GET" ? me(req, env) : methodNotAllowed("GET");
    case "/change-password":
      return req.method === "POST" ? changePassword(req, env) : methodNotAllowed("POST");
    default:
      return Response.json({ error: "unknown auth route" }, { status: 404 });
  }
}

async function login(req: Request, env: Env): Promise<Response> {
  const body = await safeJson<{ email?: string; password?: string }>(req);
  if (!body?.email || !body?.password) {
    return Response.json({ error: "email and password required" }, { status: 400 });
  }
  const email = body.email.trim().toLowerCase();

  const user = await env.DB.prepare(
    `SELECT email, password_hash, password_salt, password_iters, role, must_change_password
     FROM users WHERE email = ?`,
  )
    .bind(email)
    .first<{
      email: string;
      password_hash: string;
      password_salt: string;
      password_iters: number;
      role: string;
      must_change_password: number;
    }>();

  if (!user) {
    // Don't reveal whether the email exists. Same error for both branches.
    return Response.json({ error: "invalid email or password" }, { status: 401 });
  }

  const ok = await verifyPassword(body.password, {
    hash: user.password_hash,
    salt: user.password_salt,
    iters: user.password_iters,
  });
  if (!ok) return Response.json({ error: "invalid email or password" }, { status: 401 });

  // Mint a session.
  const sessionId = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  await env.DB.prepare(
    `INSERT INTO auth_sessions (id, email, created_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      sessionId,
      user.email,
      now,
      expiresAt,
      req.headers.get("cf-connecting-ip") ?? null,
      req.headers.get("user-agent") ?? null,
    )
    .run();

  await env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE email = ?`)
    .bind(now, user.email)
    .run();

  const cookieValue = `${COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
  return new Response(
    JSON.stringify({
      ok: true,
      email: user.email,
      role: user.role,
      must_change_password: user.must_change_password === 1,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": cookieValue,
      },
    },
  );
}

async function logout(req: Request, env: Env): Promise<Response> {
  const cookie = readCookie(req, COOKIE_NAME);
  if (cookie) {
    await env.DB.prepare(`DELETE FROM auth_sessions WHERE id = ?`).bind(cookie).run();
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
    },
  });
}

async function me(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  if (auth instanceof Response) return auth;

  if (auth.via === "bearer") {
    return Response.json({ email: "operator", role: "operator", must_change_password: false });
  }

  const user = await env.DB.prepare(
    `SELECT email, role, must_change_password FROM users WHERE email = ?`,
  )
    .bind(auth.email)
    .first<{ email: string; role: string; must_change_password: number }>();
  if (!user) return Response.json({ error: "user not found" }, { status: 404 });
  return Response.json({
    email: user.email,
    role: user.role,
    must_change_password: user.must_change_password === 1,
  });
}

async function changePassword(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  if (auth instanceof Response) return auth;
  if (auth.via === "bearer") {
    return Response.json({ error: "operator role cannot change password" }, { status: 403 });
  }

  const body = await safeJson<{ old_password?: string; new_password?: string }>(req);
  if (!body?.old_password || !body?.new_password) {
    return Response.json({ error: "old_password and new_password required" }, { status: 400 });
  }
  if (body.new_password.length < 12) {
    return Response.json({ error: "new password must be at least 12 characters" }, { status: 400 });
  }

  const user = await env.DB.prepare(
    `SELECT password_hash, password_salt, password_iters FROM users WHERE email = ?`,
  )
    .bind(auth.email)
    .first<{ password_hash: string; password_salt: string; password_iters: number }>();
  if (!user) return Response.json({ error: "user not found" }, { status: 404 });

  const ok = await verifyPassword(body.old_password, {
    hash: user.password_hash,
    salt: user.password_salt,
    iters: user.password_iters,
  });
  if (!ok) return Response.json({ error: "old password incorrect" }, { status: 401 });

  const fresh = await hashPassword(body.new_password);
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, password_iters = ?, must_change_password = 0
     WHERE email = ?`,
  )
    .bind(fresh.hash, fresh.salt, fresh.iters, auth.email)
    .run();

  return Response.json({ ok: true });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function safeJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
