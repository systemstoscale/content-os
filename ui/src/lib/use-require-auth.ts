"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMe } from "./auth";
import { fetchSetupStatus } from "./setup";

/** Hook every authenticated page uses at the top.
 *
 *  Routing precedence:
 *    1. setup not complete (no users row yet) → redirect to /setup
 *    2. 401 → redirect to /login
 *    3. signed in but must_change_password → redirect to /settings/account?first=1
 *    4. signed in & ready → return `true` so the page can render
 *
 *  Returns `null` until the round-trip resolves so the page can render a
 *  loading skeleton (or nothing) without flashing the auth'd UI to a
 *  not-yet-checked user. */
export function useRequireAuth(): boolean | null {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Setup gate runs FIRST — a fresh Deploy-button install has no users
      // and the /login form would only confuse the visitor. Route them to
      // the setup wizard before anything else.
      const setup = await fetchSetupStatus();
      if (cancelled) return;
      if (setup && !setup.setup_complete) {
        router.replace("/setup");
        setReady(false);
        return;
      }

      const me = await fetchMe();
      if (cancelled) return;
      if (!me) {
        router.replace("/login");
        setReady(false);
        return;
      }
      if (me.must_change_password) {
        router.replace("/settings/account?first=1");
        setReady(false);
        return;
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return ready;
}
