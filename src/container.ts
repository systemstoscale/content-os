import { Container } from "@cloudflare/containers";
import type { Env } from "./env";
import { getCredential } from "./lib/credentials";

export class Processor extends Container<Env> {
  defaultPort = 8080;
  // Reel renders run 3-6 min; keep the container warm between a creator's reels.
  sleepAfter = "15m";

  // Env-only fallback (operator installs whose keys are wrangler secrets).
  // Deploy-button installs keep keys in CONFIG KV instead — the container can't
  // read KV itself, so the fetch() override below resolves them from CONFIG and
  // overwrites this.envVars BEFORE the container boots. (Field initializer:
  // this.env is set by the Container base's super() before this runs.)
  envVars: Record<string, string> = {
    ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY ?? "",
    GROQ_API_KEY: this.env.GROQ_API_KEY ?? "",
    KIE_AI_API_KEY: this.env.KIE_AI_API_KEY ?? "",
    REEL_CAPTION_MODEL: this.env.REEL_CAPTION_MODEL ?? "claude-sonnet-4-6",
    CLOUDFLARE_ACCOUNT_ID: this.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    CLOUDFLARE_R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID ?? "",
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY ?? "",
    CLOUDFLARE_R2_BUCKET_NAME: this.env.R2_BUCKET_NAME ?? "content-os-assets",
  };

  /** Resolve the container env from CONFIG KV (Deploy-button installs) with an
   *  env-secret fallback (operator installs). The container reaches R2 via the
   *  S3 API (boto3) and the LLM/transcription APIs via these keys — it has no
   *  Workers bindings, so the Worker injects them at boot. */
  private async resolvedEnv(): Promise<Record<string, string>> {
    const [anthropic, groq, kie, accountId, r2Key, r2Secret, bucket] = await Promise.all([
      getCredential(this.env, "ANTHROPIC_API_KEY"),
      getCredential(this.env, "GROQ_API_KEY"),
      getCredential(this.env, "KIE_AI_API_KEY"),
      getCredential(this.env, "CLOUDFLARE_ACCOUNT_ID"),
      getCredential(this.env, "R2_ACCESS_KEY_ID"),
      getCredential(this.env, "R2_SECRET_ACCESS_KEY"),
      getCredential(this.env, "R2_BUCKET_NAME", "content-os-assets"),
    ]);
    return {
      ANTHROPIC_API_KEY: anthropic,
      GROQ_API_KEY: groq,
      KIE_AI_API_KEY: kie,
      REEL_CAPTION_MODEL: this.env.REEL_CAPTION_MODEL ?? "claude-sonnet-4-6",
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_R2_ACCESS_KEY_ID: r2Key,
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: r2Secret,
      CLOUDFLARE_R2_BUCKET_NAME: bucket,
    };
  }

  // The base fetch() forwards to the container via containerFetch, which boots
  // the container (if not running) using this.envVars. Populate it from CONFIG
  // first so a Deploy-button install's keys reach the render pipeline.
  override async fetch(request: Request): Promise<Response> {
    this.envVars = await this.resolvedEnv();
    return super.fetch(request);
  }

  override onStart(): void {
    console.log("content-os processor container started");
  }

  override onError(err: unknown): void {
    console.error("content-os processor container error", err);
  }
}
