import type { Env } from "../env";

// The brand profile is stored as JSON in CONFIG.BRAND_PROFILE and handed to the
// render container on every job (it drives fonts/colors/caption-style/motion-
// style/thumbnail-style/voice). The /brand Telegram wizard reads + patches it;
// the reel render workflow passes it to the container. Mirror of the schema in
// skalers/backend/content/brand_profile.py (defaults live there — an empty
// object renders the Skalers default look).

export interface BrandProfile {
  fonts?: { display?: string; sub?: string; body?: string };
  palette?: {
    accent?: string;
    text?: string;
    card_fill?: string;
    card_border?: string;
    card_radius?: number;
  };
  caption_style?: {
    preset?: string;
    font?: string | null;
    size?: number;
    position?: "top" | "center" | "bottom";
    case?: "upper" | "sentence";
    words_per_group?: number;
    animation?: "pop" | "fade" | "none";
    outline?: number;
    shadow?: number;
    highlight?: string | null;
  };
  motion_style?: { preset?: string; descriptor?: string };
  thumbnail_style?: {
    mode?: "overlay" | "ai";
    ai_model?: "nano-banana-pro" | "gpt-image-2";
    ai_style_prompt?: string;
    title_skew?: number;
    title_size?: number;
    scrim_opacity?: number;
  };
  voice?: {
    prompt?: string;
    cta?: string;
    hashtags?: string;
    keep?: string[];
    bans?: string[];
  };
}

export type BrandSection = keyof BrandProfile;

export const CAPTION_PRESETS = ["bold-karaoke", "clean-minimal", "highlight-pop", "big-word"] as const;
export const MOTION_PRESETS = ["skalers-cinematic", "minimal-editorial", "bold-blocky", "glass-neon", "off"] as const;
export const THUMBNAIL_MODES = ["overlay", "ai"] as const;

export async function loadBrandProfile(env: Env): Promise<BrandProfile> {
  const raw = await env.CONFIG.get("BRAND_PROFILE");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as BrandProfile;
  } catch {
    return {};
  }
}

export async function saveBrandProfile(env: Env, profile: BrandProfile): Promise<void> {
  await env.CONFIG.put("BRAND_PROFILE", JSON.stringify(profile));
}

/** Shallow-merge a patch into one section and persist. Returns the new profile. */
export async function patchBrandSection<S extends BrandSection>(
  env: Env,
  section: S,
  patch: NonNullable<BrandProfile[S]>,
): Promise<BrandProfile> {
  const profile = await loadBrandProfile(env);
  profile[section] = { ...(profile[section] ?? {}), ...patch } as BrandProfile[S];
  await saveBrandProfile(env, profile);
  return profile;
}

/** The active thumbnail mode (overlay default). Used by the render workflow to
 *  decide whether to run the worker-side AI-thumbnail path. */
export async function thumbnailMode(env: Env): Promise<"overlay" | "ai"> {
  const p = await loadBrandProfile(env);
  return p.thumbnail_style?.mode === "ai" ? "ai" : "overlay";
}
