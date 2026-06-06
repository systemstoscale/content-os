/** Client-side auth helpers.
 *
 *  Sessions live in an HTTP-only cookie set by the Worker on /api/auth/login.
 *  The SPA never reads the cookie directly (HttpOnly hides it); we infer
 *  auth state by calling GET /api/auth/me — 200 means signed in, 401 means
 *  redirect to /login.
 *
 *  No token in localStorage anymore. The previous Bearer-paste flow is
 *  retired for human users; Bearer stays as the operator/curl credential
 *  the Worker accepts as a fallback.
 */

export interface AuthedUser {
  email: string;
  role: string;
  must_change_password: boolean;
}

let cached: AuthedUser | null | undefined = undefined;

/** Cached single-flight check. Returns null on 401, the user on 200. */
export async function fetchMe(force = false): Promise<AuthedUser | null> {
  if (!force && cached !== undefined) return cached;
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (res.status === 401) {
      cached = null;
      return null;
    }
    if (!res.ok) {
      cached = null;
      return null;
    }
    cached = (await res.json()) as AuthedUser;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export function clearAuthCache(): void {
  cached = undefined;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  clearAuthCache();
}
