import type { Env } from "./env";
import { handleManual } from "./triggers/manual";
import { handleCron } from "./triggers/cron";
import { handleEmail } from "./triggers/email";
import { handleTelegram } from "./triggers/telegram";
import { handleUpload } from "./triggers/upload";
import { handleReel } from "./triggers/reel";
import { handleAvatar } from "./triggers/avatar";
import { handleYoutube, handleYoutubeUpload } from "./triggers/youtube";
import { handleR2, handleR2Upload } from "./triggers/r2";
import { handleDraftsApi } from "./api/drafts";
import { handleHealthFull } from "./api/health";
import { handleAuthApi } from "./api/auth";
import { handlePostingApi } from "./api/posting";
import { handleSetupApi } from "./api/setup";
import { handleConfigApi } from "./api/config";
import { handleSessionsApi } from "./api/sessions";
import { handleAnalyticsApi } from "./api/analytics";
import { handleTodayApi } from "./api/today";
import { handleModelApi } from "./api/model";
import { handleBrandApi } from "./api/brand";
import { handleIdeasApi } from "./api/ideas";
import { ensureSchema } from "./lib/migrate";

export { Processor } from "./container";
export { AvatarReelWorkflow } from "./workflows/avatar-reel";
export { ReelRenderWorkflow } from "./workflows/reel-render";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/r2/upload") return handleR2Upload(req, env);
    if (url.pathname.startsWith("/r2/")) return handleR2(req, env);

    // /api/* — typed REST surface consumed by the SPA. Must short-circuit
    // BEFORE the asset fallback so /api/drafts doesn't return index.html.
    if (url.pathname.startsWith("/api/")) {
      // Apply the D1 schema on first hit (Deploy-button installs can't migrate
      // in the build — see lib/migrate.ts). Idempotent + cached per isolate.
      await ensureSchema(env);
      // Auth + setup surfaces are the ONLY /api/* routes that don't call
      // requireAuth — /api/auth/login obviously needs to be reachable without
      // an existing session, and /api/setup/* runs pre-auth to bootstrap a
      // fresh Deploy-button install before any user row exists.
      if (url.pathname.startsWith("/api/auth/")) {
        const tail = url.pathname.slice("/api/auth".length);
        return handleAuthApi(req, env, ctx, tail);
      }
      if (url.pathname.startsWith("/api/setup/")) {
        const tail = url.pathname.slice("/api/setup".length);
        return handleSetupApi(req, env, ctx, tail);
      }
      if (url.pathname === "/api/health-full") {
        return handleHealthFull(req, env);
      }
      if (url.pathname === "/api/today") {
        return handleTodayApi(req, env);
      }
      if (url.pathname === "/api/model") {
        return handleModelApi(req, env);
      }
      if (url.pathname === "/api/brand") {
        return handleBrandApi(req, env);
      }
      if (url.pathname.startsWith("/api/ideas")) {
        const tail = url.pathname.slice("/api/ideas".length);
        return handleIdeasApi(req, env, tail);
      }
      if (url.pathname === "/api/drafts" || url.pathname.startsWith("/api/drafts/")) {
        const tail = url.pathname.slice("/api/drafts".length);
        return handleDraftsApi(req, env, ctx, tail);
      }
      if (url.pathname.startsWith("/api/posting")) {
        const tail = url.pathname.slice("/api/posting".length);
        return handlePostingApi(req, env, ctx, tail);
      }
      if (url.pathname.startsWith("/api/config")) {
        const tail = url.pathname.slice("/api/config".length);
        return handleConfigApi(req, env, ctx, tail);
      }
      if (url.pathname.startsWith("/api/sessions")) {
        const tail = url.pathname.slice("/api/sessions".length);
        return handleSessionsApi(req, env, ctx, tail);
      }
      if (url.pathname.startsWith("/api/analytics")) {
        const tail = url.pathname.slice("/api/analytics".length);
        return handleAnalyticsApi(req, env, ctx, tail);
      }
      return Response.json({ error: "unknown api route" }, { status: 404 });
    }

    // Triggers all touch D1 — ensure the schema exists first (cached per isolate).
    if (url.pathname.startsWith("/trigger/")) await ensureSchema(env);

    switch (url.pathname) {
      case "/trigger/manual":
        return handleManual(req, env, ctx);

      case "/trigger/telegram":
        return handleTelegram(req, env, ctx);

      case "/trigger/upload":
        return handleUpload(req, env, ctx);

      case "/trigger/reel":
        return handleReel(req, env, ctx);

      case "/trigger/avatar":
        return handleAvatar(req, env, ctx);

      case "/trigger/youtube":
        return handleYoutube(req, env, ctx);

      case "/trigger/youtube-upload":
        return handleYoutubeUpload(req, env, ctx);

      case "/health":
        return Response.json({ ok: true, creator: env.CREATOR_NAME });

      default: {
        // Everything not explicitly handled here falls through to Workers
        // Assets. With not_found_handling="single-page-application", missing
        // assets resolve to index.html so the SPA can client-route. API
        // namespaces (/api/, /trigger/, /oauth/, /r2/) are handled above
        // and never reach this branch.
        const assetRes = await env.ASSETS_STATIC.fetch(req);
        // The SPA shell (HTML) must always revalidate, or browsers serve a
        // stale index.html that references old (deleted) chunk hashes after a
        // deploy — the "I deployed but don't see it" trap. Hashed JS/CSS keep
        // their immutable caching; only HTML is forced to no-cache.
        const ct = assetRes.headers.get("content-type") ?? "";
        if (ct.includes("text/html")) {
          const headers = new Headers(assetRes.headers);
          headers.set("cache-control", "no-cache, must-revalidate");
          return new Response(assetRes.body, {
            status: assetRes.status,
            statusText: assetRes.statusText,
            headers,
          });
        }
        return assetRes;
      }
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ensureSchema(env).then(() => handleCron(event, env)));
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ensureSchema(env).then(() => handleEmail(message, env)));
  },
};
