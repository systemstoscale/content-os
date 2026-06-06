"""Brand profile resolved at runtime — the single seam for rebranding the reels.

Resolution order for every value (first hit wins):
  1. The CONTENTOS_BRAND_PROFILE env var: a JSON object (the whole brand profile)
     set by the ContentOS Cloudflare container from the buyer's CONFIG.BRAND_PROFILE.
  2. The individual BRAND_* env var (legacy / Railway operator overrides).
  3. The Skalers default — so an install with NOTHING set renders exactly the
     original Skalers look (the live Railway pipeline is unchanged).

ContentOS buyers customize fonts, colors, caption style, motion-graphics style,
thumbnail style, voice + vocabulary entirely through CONFIG.BRAND_PROFILE (set
by the /brand Telegram wizard). No Modal/container image rebuild required.

CONTENTOS_BRAND_PROFILE JSON shape (all keys optional; omitted => Skalers default):
  {
    "fonts":   {"display","sub","body"},
    "palette": {"accent","text","card_fill","card_border","card_radius"},
    "caption_style": {"preset","font","size","position","case","words_per_group",
                      "animation","outline","shadow","highlight"},
    "motion_style":  {"preset","descriptor"},
    "thumbnail_style":{"mode","ai_model","ai_style_prompt","title_skew",
                       "title_size","scrim_opacity"},
    "voice":   {"prompt","cta","hashtags","keep":[...],"bans":[...]}
  }
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any, Optional


# ── Defaults (Skalers brand) ────────────────────────────────

_DEFAULT_DISPLAY_FONT = "Archivo Black"
_DEFAULT_SUB_FONT     = "Poppins Bold"
_DEFAULT_BODY_FONT    = "Inter"
_DEFAULT_GOLD_HEX     = "#f8d380"
_DEFAULT_VOICE_PROMPT = (
    "Skalers.io. Peer-to-peer 6-figure founder scaling to 7. "
    "NO em dashes. NO emojis. Captions stay tight. CTA is "
    "'Comment 100K for the same 7-system I install inside "
    "7-figure businesses in 7 days. Free.'"
)
_DEFAULT_CTA      = (
    "Comment 100K for the same 7-system I install inside "
    "7-figure businesses in 7 days. Free."
)
_DEFAULT_HASHTAGS = "#scalingsystems #aifounder #automation"

# Palette defaults (the cinematic b-roll card look + caption accent).
_DEFAULT_PALETTE = {
    "accent":      _DEFAULT_GOLD_HEX,
    "text":        "#ffffff",
    "card_fill":   "rgba(34, 34, 34, 0.88)",
    "card_border": "#3a3a3a",
    "card_radius": 8,
}

# Skalers brand vocabulary (fed into the cinematic + thumbnail design prompts).
_DEFAULT_VOCAB_KEEP = [
    "SCALING", "SMART", "the SCALING System", "7 Systems", "4Ws", "Skalers.io",
]
_DEFAULT_VOCAB_BANS = [
    "NO em dashes (use commas, periods, or colons)",
    "'rung' (use 'milestone')",
    "'quick' (use 'fast' or omit)",
    "'7-9 figure' (say '$1M-$100M businesses')",
    "NEVER claim 7-figure status for the speaker; he is at 6 scaling to 7",
    "NEVER call Skalers a 'coaching program', 'agency', or 'mastermind'",
]

# Caption-style presets (Captions.ai-style). Each is a full caption_style dict;
# the resolved style merges preset <- per-field profile overrides. "font: null"
# means "use the display font". position in {top,center,bottom}; case in
# {upper,sentence}; words_per_group 0 = whole line; animation in {pop,fade,none}.
_CAPTION_PRESETS: dict[str, dict] = {
    # Skalers default — one gold-outlined uppercase word at a time, top safe zone.
    "bold-karaoke": {
        "font": None, "size": 104, "position": "top", "case": "upper",
        "words_per_group": 1, "animation": "pop", "outline": 4, "shadow": 1,
        "highlight": None,
    },
    "clean-minimal": {
        "font": None, "size": 84, "position": "bottom", "case": "sentence",
        "words_per_group": 0, "animation": "fade", "outline": 2, "shadow": 0,
        "highlight": None,
    },
    "highlight-pop": {
        "font": None, "size": 96, "position": "center", "case": "upper",
        "words_per_group": 3, "animation": "pop", "outline": 3, "shadow": 1,
        "highlight": None,
    },
    "big-word": {
        "font": None, "size": 124, "position": "center", "case": "upper",
        "words_per_group": 1, "animation": "pop", "outline": 5, "shadow": 2,
        "highlight": None,
    },
}
_DEFAULT_CAPTION_PRESET = "bold-karaoke"

# Caption Y positions (1080x1920 canvas) per `position`.
_CAPTION_POS_Y = {"top": 330, "center": 900, "bottom": 1500}

# Motion-graphics style presets — a one-line aesthetic descriptor injected into
# the cinematic b-roll design prompt so cards match the buyer's look. The brand
# TOKENS (colors/fonts) always come from palette()/fonts(); this only sets the
# visual language + chrome.
_MOTION_PRESETS: dict[str, str] = {
    "skalers-cinematic": (
        "Dark, glassy, premium. Cards are a translucent dark panel with a 1px "
        "hairline border, 8px radius, backdrop blur, anchored to the bottom "
        "safe-zone. Restrained motion, accent color reserved for the single "
        "anchor number/word. Weighty inertia, atmospheric depth."
    ),
    "minimal-editorial": (
        "Typography-only, NO card chrome. Large clean type sits directly on the "
        "footage in the lower third, generous negative space, a thin accent rule "
        "under the key line. No panels, no glow. Calm, magazine-like."
    ),
    "bold-blocky": (
        "High-contrast, MrBeast-style. Thick solid color blocks, heavy bold type, "
        "hard cuts, punchy scale pops, the accent color used aggressively as a "
        "fill behind key words. Loud and kinetic."
    ),
    "glass-neon": (
        "Frosted glass cards with a soft neon accent glow, rounded corners, "
        "subtle gradient edges. Futuristic, techy, smooth ease-in-out motion."
    ),
    "off": "",  # captions only — skip cinematic cards entirely
}
_DEFAULT_MOTION_PRESET = "skalers-cinematic"

_DEFAULT_THUMBNAIL_STYLE = {
    "mode": "overlay",                 # overlay | ai
    "ai_model": "nano-banana-pro",     # nano-banana-pro | gpt-image-2
    "ai_style_prompt": "",
    "title_skew": -7,                  # degrees (overlay headline italic skew)
    "title_size": 168,                 # px starting size (auto-fit shrinks)
    "scrim_opacity": 0.94,             # bottom gradient darkness
}


# ── Profile JSON loader ────────────────────────────────────

@lru_cache(maxsize=1)
def _profile() -> dict:
    """Parse CONTENTOS_BRAND_PROFILE once. Empty dict if unset/invalid."""
    raw = (os.environ.get("CONTENTOS_BRAND_PROFILE") or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _pf(section: str, key: str, default: Any = None) -> Any:
    """Read profile[section][key], returning default when missing/blank."""
    sec = _profile().get(section)
    if isinstance(sec, dict) and key in sec:
        v = sec[key]
        if v not in (None, "", []):
            return v
    return default


# ── Resolvers (profile JSON -> per-field env -> default) ───

def display_font() -> str:
    return str(_pf("fonts", "display") or os.environ.get("BRAND_DISPLAY_FONT") or _DEFAULT_DISPLAY_FONT).strip()


def sub_font() -> str:
    return str(_pf("fonts", "sub") or os.environ.get("BRAND_SUB_FONT") or _DEFAULT_SUB_FONT).strip()


def body_font() -> str:
    return str(_pf("fonts", "body") or os.environ.get("BRAND_BODY_FONT") or _DEFAULT_BODY_FONT).strip()


def gold_hex() -> str:
    """Brand accent colour as #rrggbb (profile palette.accent or BRAND_GOLD_HEX)."""
    v = str(_pf("palette", "accent") or os.environ.get("BRAND_GOLD_HEX") or _DEFAULT_GOLD_HEX).strip()
    if not v.startswith("#"):
        v = "#" + v
    return v


def gold_bgr() -> str:
    """Accent colour as BGR uppercase for ASS subtitle headers."""
    h = gold_hex().lstrip("#")
    if len(h) != 6:
        h = _DEFAULT_GOLD_HEX.lstrip("#")
    return (h[4:6] + h[2:4] + h[0:2]).upper()


def _hex_to_bgr(hex_str: str) -> str:
    h = (hex_str or "").lstrip("#")
    if len(h) != 6:
        return "FFFFFF"
    return (h[4:6] + h[2:4] + h[0:2]).upper()


def palette() -> dict:
    """Resolved palette: accent / text / card_fill / card_border / card_radius."""
    p = dict(_DEFAULT_PALETTE)
    p["accent"] = gold_hex()
    for k in ("text", "card_fill", "card_border", "card_radius"):
        v = _pf("palette", k)
        if v is not None:
            p[k] = v
    return p


def voice_prompt() -> str:
    return str(_pf("voice", "prompt") or os.environ.get("BRAND_VOICE_PROMPT") or _DEFAULT_VOICE_PROMPT).strip()


def cta() -> str:
    return str(_pf("voice", "cta") or os.environ.get("BRAND_CTA") or _DEFAULT_CTA).strip()


def hashtags() -> str:
    return str(_pf("voice", "hashtags") or os.environ.get("BRAND_HASHTAGS") or _DEFAULT_HASHTAGS).strip()


def vocab_keep() -> list[str]:
    v = _profile().get("voice", {})
    keep = v.get("keep") if isinstance(v, dict) else None
    return list(keep) if isinstance(keep, list) and keep else list(_DEFAULT_VOCAB_KEEP)


def vocab_bans() -> list[str]:
    v = _profile().get("voice", {})
    bans = v.get("bans") if isinstance(v, dict) else None
    return list(bans) if isinstance(bans, list) and bans else list(_DEFAULT_VOCAB_BANS)


def caption_style() -> dict:
    """Resolved caption style: preset merged with per-field overrides, fonts +
    colors filled from the palette, plus derived ASS helpers (pos_y, *_bgr)."""
    preset_name = str(_pf("caption_style", "preset") or _DEFAULT_CAPTION_PRESET)
    style = dict(_CAPTION_PRESETS.get(preset_name, _CAPTION_PRESETS[_DEFAULT_CAPTION_PRESET]))
    style["preset"] = preset_name
    # Per-field overrides from the profile.
    for k in ("font", "size", "position", "case", "words_per_group", "animation",
              "outline", "shadow", "highlight"):
        v = _pf("caption_style", k)
        if v is not None:
            style[k] = v
    # Fill derived/brand values.
    style["font"] = str(style.get("font") or display_font())
    pos = str(style.get("position") or "top")
    style["pos_x"] = 540
    style["pos_y"] = _CAPTION_POS_Y.get(pos, _CAPTION_POS_Y["top"])
    style["text_bgr"] = "FFFFFF"
    hl = style.get("highlight")
    style["highlight_bgr"] = _hex_to_bgr(hl) if hl else None
    return style


def motion_style() -> dict:
    """Resolved motion-graphics style for the cinematic b-roll design prompt.
    Returns {preset, descriptor, enabled} — descriptor is the aesthetic the LLM
    must follow; brand tokens (colors/fonts) come from palette()/fonts()."""
    preset_name = str(_pf("motion_style", "preset") or _DEFAULT_MOTION_PRESET)
    descriptor = _pf("motion_style", "descriptor") or _MOTION_PRESETS.get(
        preset_name, _MOTION_PRESETS[_DEFAULT_MOTION_PRESET]
    )
    return {
        "preset": preset_name,
        "descriptor": str(descriptor),
        "enabled": preset_name != "off" and bool(str(descriptor).strip()),
    }


def thumbnail_style() -> dict:
    """Resolved thumbnail style: overlay (frame+scrim+headline) or ai
    (Nano Banana Pro / GPT Image 2, face-accurate)."""
    style = dict(_DEFAULT_THUMBNAIL_STYLE)
    for k in style:
        v = _pf("thumbnail_style", k)
        if v is not None:
            style[k] = v
    return style


def music_library() -> dict[str, list[str]]:
    """Resolve the music library. BRAND_MUSIC_MANIFEST_URL (JSON {mood:[urls]})
    overrides the baked Pixabay library in broll_format.MUSIC_LIBRARY."""
    url = (os.environ.get("BRAND_MUSIC_MANIFEST_URL") or "").strip()
    if url:
        try:
            import httpx
            r = httpx.get(url, timeout=10.0, follow_redirects=True)
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict):
                return {k: list(v) for k, v in data.items() if isinstance(v, list)}
        except Exception:
            pass
    try:
        from broll_format import MUSIC_LIBRARY as _default
        return _default
    except Exception:
        return {}
