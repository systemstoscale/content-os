import type { Env } from "../env";
import { requireBearer, methodNotAllowed } from "./auth";
import { callZernioMcpTool } from "../clients/zernio-mcp";

/** /api/analytics — Zernio MCP analytics surface for the SPA.
 *
 *  Today this just wraps `analytics_get_analytics` (last N posts with
 *  per-platform metrics). The Zernio MCP server has 20 analytics tools
 *  total — we'll surface more (best_time_to_post, content_decay, daily
 *  metrics, instagram_account_insights, etc.) as the UI grows. */

interface PostAnalytics {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  views?: number;
  engagementRate?: number;
  lastUpdated?: string;
}

interface PlatformEntry {
  platform: string;
  status?: string;
  platformPostId?: string;
  accountId?: string;
  accountUsername?: string;
  analytics?: PostAnalytics;
}

interface PostEntry {
  _id: string;
  content: string;
  publishedAt?: string;
  scheduledFor?: string;
  status: string;
  analytics?: PostAnalytics;
  platforms?: PlatformEntry[];
}

interface AccountEntry {
  _id: string;
  platform: string;
  username: string;
  displayName?: string;
  profilePicture?: string;
  followersCount?: number;
  followersLastUpdated?: string;
}

interface AnalyticsResponse {
  overview?: {
    totalPosts?: number;
    publishedPosts?: number;
    scheduledPosts?: number;
    lastSync?: string;
  };
  posts?: PostEntry[];
  accounts?: AccountEntry[];
  hasAnalyticsAccess?: boolean;
}

export async function handleAnalyticsApi(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  pathTail: string,
): Promise<Response> {
  const guard = await requireBearer(req, env);
  if (guard) return guard;

  if (pathTail === "" || pathTail === "/") {
    if (req.method !== "GET") return methodNotAllowed("GET");
    return overview(req, env);
  }
  return Response.json({ error: "unknown analytics route" }, { status: 404 });
}

interface BestTimeSlot {
  day_of_week: number;
  hour: number;
  avg_engagement: number;
  post_count: number;
}

interface BestTimesResponse {
  slots?: BestTimeSlot[];
}

interface DailyMetricsPoint {
  date: string;
  postCount: number;
  platforms: Record<string, number>;
  metrics: {
    impressions: number;
    reach: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    clicks: number;
    views: number;
  };
}

interface DailyMetricsResponse {
  dailyData?: DailyMetricsPoint[];
}

async function overview(req: Request, env: Env): Promise<Response> {
  if (!env.ZERNIO_API_KEY) {
    return Response.json(
      { error: "ZERNIO_API_KEY not set on this Worker" },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20), 1), 100);

  try {
    // Fetch all three in parallel — saves ~1s total.
    const [result, bestTimes, daily] = await Promise.all([
      callZernioMcpTool<AnalyticsResponse>(env, "analytics_get_analytics", { limit }),
      callZernioMcpTool<BestTimesResponse>(env, "analytics_get_best_time_to_post", {}).catch(
        () => ({} as BestTimesResponse),
      ),
      callZernioMcpTool<DailyMetricsResponse>(env, "analytics_get_daily_metrics", {}).catch(
        () => ({} as DailyMetricsResponse),
      ),
    ]);

    // Normalize: each post's headline metrics come from its first platform
    // when the post-level analytics block is empty (Zernio rolls up platform
    // analytics into the post block, but for very-recent posts it can be
    // stale and the platforms array is the source of truth).
    const posts = (result.posts ?? []).map((p) => {
      const platformTotals = sumPlatformAnalytics(p.platforms ?? []);
      return {
        id: p._id,
        content: p.content,
        published_at: p.publishedAt ?? null,
        status: p.status,
        analytics: mergeAnalytics(p.analytics, platformTotals),
        platforms:
          (p.platforms ?? []).map((pl) => ({
            platform: pl.platform,
            account: pl.accountUsername ?? pl.accountId ?? null,
            status: pl.status ?? null,
            platform_post_id: pl.platformPostId ?? null,
            analytics: pl.analytics ?? null,
          })),
      };
    });

    const accounts = (result.accounts ?? []).map((a) => ({
      id: a._id,
      platform: a.platform,
      username: a.username,
      display_name: a.displayName ?? null,
      profile_picture: a.profilePicture ?? null,
      followers: a.followersCount ?? null,
      followers_updated_at: a.followersLastUpdated ?? null,
    }));

    // Slots come pre-sorted by engagement DESC — just clip to top 24 for the
    // SPA heatmap (one cell per day×hour, 7×24 = 168 but we surface the most
    // engaging ones at the top of the response).
    const best_times = (bestTimes.slots ?? []).slice(0, 168).map((s) => ({
      day_of_week: s.day_of_week,
      hour: s.hour,
      avg_engagement: Math.round(s.avg_engagement * 10) / 10,
      post_count: s.post_count,
    }));

    // Project the daily metrics into a slimmer shape the chart can read
    // without doing math on the client. Sorted oldest → newest.
    const daily_metrics = (daily.dailyData ?? [])
      .map((d) => ({
        date: d.date,
        post_count: d.postCount,
        impressions: d.metrics.impressions,
        reach: d.metrics.reach,
        engagements: d.metrics.likes + d.metrics.comments + d.metrics.shares + d.metrics.saves,
        views: d.metrics.views,
        clicks: d.metrics.clicks,
        platforms: d.platforms,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return Response.json({
      ok: true,
      overview: result.overview ?? null,
      has_access: result.hasAnalyticsAccess ?? null,
      posts,
      accounts,
      best_times,
      daily_metrics,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 502 });
  }
}

function sumPlatformAnalytics(platforms: PlatformEntry[]): PostAnalytics {
  const totals: PostAnalytics = {};
  const fields: (keyof PostAnalytics)[] = [
    "impressions",
    "reach",
    "likes",
    "comments",
    "shares",
    "saves",
    "clicks",
    "views",
  ];
  for (const p of platforms) {
    const a = p.analytics;
    if (!a) continue;
    for (const f of fields) {
      const cur = (totals[f] as number | undefined) ?? 0;
      const add = (a[f] as number | undefined) ?? 0;
      (totals[f] as number) = cur + add;
    }
  }
  return totals;
}

function mergeAnalytics(post?: PostAnalytics, platformTotals?: PostAnalytics): PostAnalytics {
  // Prefer the post-level block when it has signal, otherwise fall back to
  // the summed platform totals.
  if (!post || (post.impressions ?? 0) === 0) return platformTotals ?? {};
  return post;
}
