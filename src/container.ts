import { Container } from "@cloudflare/containers";
import type { Env } from "./env";

export class Processor extends Container<Env> {
  defaultPort = 8080;
  // Reel renders run 3-6 min; keep the container warm between a creator's reels.
  sleepAfter = "15m";

  // Inject the credentials/config the in-container Python render pipeline needs.
  // The container has no Workers bindings — it reaches R2 via the S3 API (boto3)
  // and the LLM/transcription APIs via these keys. Read from the Worker's
  // secrets, so a buyer configures them once at install. (Field initializer:
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

  override onStart(): void {
    console.log("content-os processor container started");
  }

  override onError(err: unknown): void {
    console.error("content-os processor container error", err);
  }
}
