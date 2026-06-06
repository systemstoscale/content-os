import type { Env } from "../env";
import { fillTemplate, type TemplateKey } from "../templates";

export interface RenderedAsset {
  r2_key: string;
  public_url: string;
  width: number;
  height: number;
}

interface SlideSpec {
  template: TemplateKey;
  vars: Record<string, string>;
}

export interface RenderCarouselInput {
  slides: SlideSpec[];
  asset_prefix: string;
}

export interface RenderCarouselOutput {
  assets: RenderedAsset[];
}

export interface RenderQuoteInput {
  quote: string;
  attribution: string;
  asset_prefix: string;
}

export interface RenderThumbnailInput {
  eyebrow: string;
  headline_pre: string;
  headline_accent: string;
  headline_post: string;
  brand_handle: string;
  asset_prefix: string;
  /** "yt" (default) = 1280x720 16:9 for YouTube long-form.
   *  "reel" = 1080x1920 9:16 for IG Reels/TikTok covers. */
  orientation?: "yt" | "reel";
  /** Optional public URL of a background image (e.g. a frame from the reel
   *  via process_reel.cover_frame_url). When set, the cover renders the image
   *  under a black gradient overlay so the text stays legible. Currently
   *  honored by the 'reel' orientation only. */
  background_image_url?: string;
}

const CAROUSEL_W = 1080;
const CAROUSEL_H = 1350;
const SQUARE = 1080;
const YT_W = 1280;
const YT_H = 720;
const REEL_W = 1080;
const REEL_H = 1920;

export async function renderCarousel(
  env: Env,
  input: RenderCarouselInput
): Promise<RenderCarouselOutput> {
  if (!Array.isArray(input.slides) || input.slides.length === 0) {
    throw new Error("slides[] is required and must be non-empty");
  }
  if (input.slides.length > 10) {
    throw new Error("max 10 slides per carousel");
  }

  // Launch ONE browser and render all slides on separate pages. This avoids
  // hitting Cloudflare Browser Rendering's per-minute concurrency cap when a
  // single carousel call would otherwise spawn N browser launches.
  const puppeteer = (await import("@cloudflare/puppeteer")).default;
  const browser = await puppeteer.launch(env.BROWSER);
  const assets: RenderedAsset[] = [];
  try {
    for (let i = 0; i < input.slides.length; i++) {
      const slide = input.slides[i]!;
      const html = fillTemplate(slide.template, slide.vars);
      const png = await renderHtmlOnBrowser(browser, html, CAROUSEL_W, CAROUSEL_H);
      const r2_key = `renders/${input.asset_prefix}-${i + 1}-${Date.now()}.png`;
      await env.ASSETS.put(r2_key, png, {
        httpMetadata: { contentType: "image/png" },
      });
      assets.push({
        r2_key,
        public_url: await publicUrlFor(env, r2_key),
        width: CAROUSEL_W,
        height: CAROUSEL_H,
      });
    }
  } finally {
    await browser.close();
  }
  return { assets };
}

export async function renderQuotePost(
  env: Env,
  input: RenderQuoteInput
): Promise<RenderedAsset> {
  // Defensively strip framing quotation marks (ASCII + curly + french guillemets).
  const cleanQuote = input.quote.replace(/^[\s"'“”‘’«»]+|[\s"'“”‘’«»]+$/g, "");
  // Attribution should be the @handle only. If the agent passes "Max Warnault · @scalermax"
  // (with or without separators), extract just the @handle. If no @handle present, keep as-is.
  const handleMatch = input.attribution.match(/@[A-Za-z0-9_.-]+/);
  const cleanAttribution = handleMatch ? handleMatch[0] : input.attribution;
  const html = fillTemplate("quote-post", {
    QUOTE: cleanQuote,
    ATTRIBUTION: cleanAttribution,
  });
  return renderAndStore(env, html, SQUARE, SQUARE, input.asset_prefix);
}

export async function renderThumbnail(
  env: Env,
  input: RenderThumbnailInput
): Promise<RenderedAsset> {
  const isReel = input.orientation === "reel";
  const html = fillTemplate(isReel ? "reel-cover" : "yt-thumbnail", {
    EYEBROW: input.eyebrow,
    HEADLINE_PRE: input.headline_pre,
    HEADLINE_ACCENT: input.headline_accent,
    HEADLINE_POST: input.headline_post,
    BRAND_HANDLE: input.brand_handle,
    BACKGROUND_IMAGE_URL: input.background_image_url ?? "",
  });
  const w = isReel ? REEL_W : YT_W;
  const h = isReel ? REEL_H : YT_H;
  return renderAndStore(env, html, w, h, input.asset_prefix);
}

async function renderAndStore(
  env: Env,
  html: string,
  width: number,
  height: number,
  assetName: string
): Promise<RenderedAsset> {
  const puppeteer = (await import("@cloudflare/puppeteer")).default;
  const browser = await puppeteer.launch(env.BROWSER);
  let png: Uint8Array;
  try {
    png = await renderHtmlOnBrowser(browser, html, width, height);
  } finally {
    await browser.close();
  }

  const r2_key = `renders/${assetName}-${Date.now()}.png`;
  await env.ASSETS.put(r2_key, png, {
    httpMetadata: { contentType: "image/png" },
  });

  return {
    r2_key,
    public_url: await publicUrlFor(env, r2_key),
    width,
    height,
  };
}

/** Render one HTML page to PNG on an already-open browser. Caller owns the
 *  browser lifecycle. Used by renderCarousel to share a single browser
 *  across N slides (avoids per-launch rate limits). */
async function renderHtmlOnBrowser(
  browser: unknown,
  html: string,
  width: number,
  height: number
): Promise<Uint8Array> {
  const b = browser as { newPage: () => Promise<unknown> };
  const page = (await b.newPage()) as {
    setViewport: (v: { width: number; height: number; deviceScaleFactor: number }) => Promise<void>;
    setContent: (html: string, opts: { waitUntil: string }) => Promise<void>;
    evaluate: (fn: string) => Promise<unknown>;
    screenshot: (opts: { type: string; fullPage: boolean }) => Promise<Uint8Array>;
    close: () => Promise<void>;
  };
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const autoFitFn = `() => {
      const sels = [".manifesto", ".quote", ".headline"];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const container = el.closest(".post, .slide, .thumb") || el.parentElement;
        if (!container) continue;
        let size = parseFloat(getComputedStyle(el).fontSize);
        const minSize = 32;
        const heightBudget = container.clientHeight * 0.78;
        const widthBudget = container.clientWidth * 0.96;
        while ((el.scrollHeight > heightBudget || el.scrollWidth > widthBudget) && size > minSize) {
          size -= 4;
          el.style.fontSize = size + "px";
        }
      }
    }`;
    await page.evaluate(autoFitFn);
    return await page.screenshot({ type: "png", fullPage: false });
  } finally {
    await page.close().catch(() => {});
  }
}

async function publicUrlFor(env: Env, r2_key: string): Promise<string> {
  const base = await env.CONFIG.get("R2_PUBLIC_BASE");
  if (base) return `${base.replace(/\/$/, "")}/${r2_key}`;
  return `/r2/${r2_key}`;
}
