import type { Env } from "../env";

/** Per-buyer media-generation config.
 *
 *  Content OS is installed for many different creators. NOTHING about the
 *  creator's appearance, voice, or model choice is hardcoded — every value
 *  below is read from CONFIG KV (written by the /setup wizard or the
 *  /settings/config UI) so each buyer customises the whole pipeline for
 *  themselves. Sensible defaults keep a fresh install working before /setup.
 *
 *  CONFIG keys:
 *    CREATOR_LOOK            — appearance description woven into every image of
 *                              the creator, e.g. "bald man with a trimmed dark
 *                              beard". Empty = the model is free to render any
 *                              face (generic). This REPLACES the old hardcoded
 *                              Max-specific "bald / beard" rules.
 *    SOUL_REFERENCE_URL      — public URL of the creator's headshot. Passed to
 *                              KIE as the reference image so generated images
 *                              resemble them (~75-85% likeness). The buyer
 *                              uploads their own at /setup.
 *    KIE_IMAGE_MODEL         — image model slug (default nano-banana-pro).
 *    KIE_AVATAR_MODEL        — talking-head model slug (default kling-ai-avatar,
 *                              which handles full-length reels; "infinitetalk"
 *                              is cheaper but caps audio at 15s). Verify the
 *                              exact slug for your KIE account at
 *                              https://docs.kie.ai/market — it's overridable
 *                              here precisely so no code change is needed.
 *    KIE_AVATAR_RESOLUTION   — "480p" | "720p" (default 720p).
 *    BRAND_ASPECT            — default aspect for generated media (default 9:16).
 */

export const DEFAULT_IMAGE_MODEL = "nano-banana-pro";
export const DEFAULT_AVATAR_MODEL = "kling-ai-avatar";
export const DEFAULT_AVATAR_RESOLUTION = "720p" as const;
export const DEFAULT_ASPECT = "9:16" as const;

export interface MediaConfig {
  /** Appearance description for the creator. "" when unset. */
  creatorLook: string;
  /** Headshot reference URL for likeness, or null when unset. */
  soulReferenceUrl: string | null;
  imageModel: string;
  avatarModel: string;
  avatarResolution: "480p" | "720p";
  defaultAspect: "9:16" | "1:1" | "16:9";
}

/** Load the full per-buyer media config in one CONFIG round-trip. */
export async function getMediaConfig(env: Env): Promise<MediaConfig> {
  const [look, ref, imageModel, avatarModel, avatarRes, aspect] = await Promise.all([
    env.CONFIG.get("CREATOR_LOOK"),
    env.CONFIG.get("SOUL_REFERENCE_URL"),
    env.CONFIG.get("KIE_IMAGE_MODEL"),
    env.CONFIG.get("KIE_AVATAR_MODEL"),
    env.CONFIG.get("KIE_AVATAR_RESOLUTION"),
    env.CONFIG.get("BRAND_ASPECT"),
  ]);
  return {
    creatorLook: look ?? "",
    soulReferenceUrl: ref || null,
    imageModel: imageModel || DEFAULT_IMAGE_MODEL,
    avatarModel: avatarModel || DEFAULT_AVATAR_MODEL,
    avatarResolution: avatarRes === "480p" ? "480p" : DEFAULT_AVATAR_RESOLUTION,
    defaultAspect: aspect === "1:1" || aspect === "16:9" ? aspect : DEFAULT_ASPECT,
  };
}

/** Just the creator's appearance description (CONFIG.CREATOR_LOOK), "" if unset. */
export async function getCreatorLook(env: Env): Promise<string> {
  return (await env.CONFIG.get("CREATOR_LOOK")) ?? "";
}

/** Compose the creator's look into an image prompt. When a look is configured
 *  we lead with it so the subject is locked; otherwise the prompt stands alone. */
export function withCreatorLook(look: string, prompt: string): string {
  const l = look.trim();
  return l ? `${l}, ${prompt}` : prompt;
}
