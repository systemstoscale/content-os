/** Setup-status helper.
 *
 *  Used by every page's auth check to route a fresh Deploy-button install
 *  to /setup instead of /login. A Worker that has no `users` row yet is
 *  "needs setup"; once /setup completes, this flips to true and the SPA
 *  starts behaving like a normal sign-in surface. */

export interface SetupStatus {
  setup_complete: boolean;
  worker_url: string;
}

let cached: SetupStatus | null = null;

export async function fetchSetupStatus(force = false): Promise<SetupStatus | null> {
  if (cached && !force) return cached;
  try {
    const res = await fetch("/api/setup/status");
    if (!res.ok) return null;
    cached = (await res.json()) as SetupStatus;
    return cached;
  } catch {
    return null;
  }
}

export function clearSetupCache(): void {
  cached = null;
}
