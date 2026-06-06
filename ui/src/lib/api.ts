/** Thin fetch wrapper for the Worker API.
 *
 *  Auth is cookie-based (HttpOnly), set on /api/auth/login. Every request
 *  must include credentials so the browser sends the cookie back; same-
 *  origin so no CORS dance. */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  const res = await fetch(path, { ...init, headers, credentials: "include" });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : null) ?? `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, payload?: unknown) =>
    request<T>(path, { method: "POST", body: payload ? JSON.stringify(payload) : undefined }),
  patch: <T>(path: string, payload: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(payload) }),
  put: <T>(path: string, payload: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(payload) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
