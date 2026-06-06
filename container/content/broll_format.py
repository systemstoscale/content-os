"""B-roll reel format: silent / footage-only video with a top headline
overlay + 'Read captions…' subline. Headline + post body + mood are all
AI-generated from a topic + key points the user provides in the Telegram
conversation. The mood drives random track selection from a curated
royalty-free library (Pixabay, commercial-use OK, no attribution required).

Pipeline (vs the talking-head one):
  Talking-head: Whisper -> silence trim -> audio enhance -> color grade ->
                karaoke captions (ASS) -> cinematic B-roll cards -> composite.
  B-roll:       Strip source audio, color grade, burn brand overlay (two-line
                ASS), mix in background music (looped, faded), output.
                No Whisper, no cut, no captions, no cinematic cards.

The brand styling for the overlay reuses caption_builder constants (Archivo
Black, white-on-black outline, HDR matrix) so the look is consistent with
the talking-head karaoke captions.

Safe zones (Instagram Reels 1080x1920 — see skalers.io/brand · IG sizing):
  Reels feed:      x in [35, 1045], y in [220, 1470]  (top UI 220, bottom 450)
  Profile-feed:    1080x1350 center crop, so y in [285, 1635]
  Strict overlap:  y in [285, 1470]
All overlay text MUST land inside the strict overlap so nothing gets clipped
or hidden by chrome on either surface.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

# Brand display font: env BRAND_DISPLAY_FONT (default "Archivo Black").
# Matches the karaoke caption font in the talking-head format so both
# pipelines render with the same brand voice.
import brand_profile as _bp
HEAD_FONT_NAME = _bp.display_font()


# ── Brand styling ───────────────────────────────────────────

HEAD_FONT_SIZE = 88     # Smaller than caption 104 so 2-line headlines stay inside the safe zone
SUB_FONT_NAME  = _bp.sub_font()
SUB_FONT_SIZE  = 52

# Safe zone (strict overlap of Reels-feed + profile-feed crop): y in [285, 1470].
# Headline center positioned so 2-line wrap (worst case ~210px tall at 88pt)
# sits inside that band with breathing room. Sub line below headline.
HEAD_POS_X = 540
HEAD_POS_Y = 420        # Center of the headline block (anchored so 2-line wrap stays > 285)
SUB_POS_Y  = 600        # Center of the "Read captions…" subline

WHITE_BGR = "FFFFFF"
BLACK_BGR = "000000"


# ── Curated royalty-free music library ─────────────────────
#
# Pixabay direct CDN URLs (license: free for commercial use, no attribution
# required). Tracks are grouped by mood; Claude picks the mood per reel and
# we pull a random track from that mood bucket. Falls back to env
# REEL_BROLL_MUSIC_URL if a mood bucket is empty or missing.

MUSIC_LIBRARY: dict[str, list[str]] = {
    # upbeat-corporate, energetic frameworks, "X ways to scale"
    "driven": [
        "https://cdn.pixabay.com/audio/2026/03/23/audio_41d4f638b4.mp3",  # Quiet Progress
        "https://cdn.pixabay.com/audio/2026/04/21/audio_2e46329d56.mp3",  # Corporate Music
    ],
    # darker/percussive, "stop doing X", anti-hustle takes
    "contrarian": [
        "https://cdn.pixabay.com/audio/2026/01/31/audio_a140a56085.mp3",  # Dark Horror Trailer
        "https://cdn.pixabay.com/audio/2026/04/18/audio_7e76419b49.mp3",  # Horror Background
    ],
    # lofi-technical, deep how-tos, system architecture
    "focused": [
        "https://cdn.pixabay.com/audio/2026/05/05/audio_a8b8bb1d9f.mp3",  # Lofi Girl
        "https://cdn.pixabay.com/audio/2026/05/05/audio_35700c8131.mp3",  # Lofi Music
    ],
    # cinematic-motivational, big vision, mindset
    "uplifting": [
        "https://cdn.pixabay.com/audio/2025/09/23/audio_1b6f4de1c4.mp3",  # Inspiring Cinematic
        "https://cdn.pixabay.com/audio/2026/03/31/audio_d6ae3e6b9c.mp3",  # Inspiring Uplifting
    ],
    # gentle explainer, primer, step-by-step
    "calm": [
        "https://cdn.pixabay.com/audio/2025/06/04/audio_4a675a0e9d.mp3",  # Calm Ambient
        "https://cdn.pixabay.com/audio/2025/05/15/audio_e2a8fe0e91.mp3",  # Relaxing Ambient
    ],
}

VALID_MOODS = tuple(MUSIC_LIBRARY.keys())


def _pick_music_url(mood: str) -> str:
    """Pick a random track URL from the library for the given mood.

    Resolution order:
      1. Active mood bucket in the (possibly client-overridden) library
      2. Env REEL_BROLL_MUSIC_URL (single-track override)
      3. Empty string (silent output)
    """
    import random
    import brand_profile
    library = brand_profile.music_library() or MUSIC_LIBRARY
    pool = library.get(mood) or []
    if pool:
        return random.choice(pool)
    return os.environ.get("REEL_BROLL_MUSIC_URL", "").strip()


# ── Claude: topic + key points -> {headline, body, hashtags, cta, mood} ──

def generate_headline_and_body(topic: str, key_points: str,
                                brand_voice: Optional[str] = None) -> dict:
    """Expand the user's topic + bullets into a publishable post payload.

    Returns the same shape `_build_caption_payload` already produces for
    talking-head reels, so `on_render_complete` and `_publish_to_zernio`
    consume it unchanged.
    """
    import brand_profile
    fallback = {
        "headline":    (topic or "Read captions").strip()[:80],
        "body":        (key_points or "").strip()[:1000],
        "hashtags":    brand_profile.hashtags(),
        "cta":         brand_profile.cta(),
        "mood":        "driven",
        "gold_phrase": "",
    }
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return fallback

    voice = brand_voice or brand_profile.voice_prompt()
    moods_quoted = " | ".join(f'"{m}"' for m in VALID_MOODS)
    sys_prompt = (
        f"You write headlines + long-form captions for short-form video posts. Voice: {voice}\n\n"
        "Given a TOPIC and a list of KEY POINTS, return STRICT JSON in this exact shape:\n"
        "{\n"
        '  "headline":    str (<= 6 words AND <= 40 chars total — tight enough to live on a Reels thumbnail. '
        'Scroll-stopping, uppercase-friendly. NO leading "the"/"a"/"an". '
        'If the headline has two clauses (e.g. "X your Y, Z your W"), the two verbs MUST be different — '
        '"CURATE YOUR ENVIRONMENT, UPGRADE YOUR INCOME" not "CURATE / CURATE". '
        'Vary the verbs (INVEST/MULTIPLY, PROTECT/COMPOUND, RAISE/RISE).),\n'
        '  "body":     str (200-800 chars, the full post body listing each key point cleanly, plain text, short lines),\n'
        '  "hashtags":    str (5-7 lowercase tags separated by spaces),\n'
        '  "cta":         str (the locked CTA verbatim),\n'
        f'  "mood":        str (EXACTLY one of: {moods_quoted}),\n'
        '  "gold_phrase": str (1-3 word substring from the headline to highlight in gold on the thumbnail — usually the number/dollar amount/contrast word/second clause)\n'
        "}\n"
        "Mood guide (pick the closest match):\n"
        "  driven      = positive growth content, 'X ways to scale', energetic frameworks\n"
        "  contrarian  = anti-hustle takes, 'stop doing X', spiky / dark / contrarian claims\n"
        "  focused     = deep how-to, system architecture, technical explainers\n"
        "  uplifting   = big vision, mindset, success stories\n"
        "  calm        = educational primer, step-by-step explainer\n\n"
        "Rules: NO emojis. NO em dashes. NO 'as an AI'. Reuse the speaker's phrasing where possible. "
        "The headline is the punchiest possible version of the topic — if the key points enumerate items, "
        "use the count (e.g. '7 SIMPLE WAYS TO CREATE CONTENT'). The body lists those points clearly so "
        "viewers know what they'll get when they tap 'Read more'."
    )
    user_msg = f"TOPIC: {topic}\n\nKEY POINTS:\n{key_points}"

    try:
        import anthropic
        cli = anthropic.Anthropic()
        resp = cli.messages.create(
            model=os.environ.get("REEL_CAPTION_MODEL", "claude-sonnet-4-6"),
            max_tokens=1000,
            system=sys_prompt,
            messages=[{"role": "user", "content": user_msg}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].lstrip()
        out = json.loads(text)
        out.setdefault("cta",         fallback["cta"])
        out.setdefault("mood",        fallback["mood"])
        out.setdefault("gold_phrase", fallback["gold_phrase"])
        if out.get("mood") not in VALID_MOODS:
            out["mood"] = fallback["mood"]
        return out
    except Exception:
        return fallback


# ── Static two-line ASS overlay ─────────────────────────────

def _fmt_time(t: float) -> str:
    if t < 0:
        t = 0.0
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t - h * 3600 - m * 60
    return f"{h}:{m:02d}:{s:05.2f}"


def build_overlay_ass(headline: str, duration_s: float, *, hdr: bool = False) -> str:
    """Two static events for the full clip duration:
      - Headline (Archivo Black 96) at \\pos(540,260)
      - 'Read captions…' (Poppins Bold 52) at \\pos(540,420)
    Both white over a heavy black outline + soft shadow for legibility.
    """
    head_text = headline.strip().replace("\n", " ").upper()
    if not head_text:
        head_text = "READ CAPTIONS"

    matrix_line = "YCbCr Matrix: PC.709" if hdr else "YCbCr Matrix: TV.709"
    header = (
        "[Script Info]\n"
        "Title: Skalers B-roll overlay\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1080\n"
        "PlayResY: 1920\n"
        "WrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n"
        f"{matrix_line}\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Head,{HEAD_FONT_NAME},{HEAD_FONT_SIZE},&H00{WHITE_BGR},&H000000FF,"
        f"&H00{BLACK_BGR},&HC0000000,-1,0,0,0,100,100,0,0,1,5,2,5,0,0,0,1\n"
        f"Style: Sub,{SUB_FONT_NAME},{SUB_FONT_SIZE},&H00{WHITE_BGR},&H000000FF,"
        f"&H00{BLACK_BGR},&HC0000000,-1,0,0,0,100,100,0,0,1,3,1,5,0,0,0,1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    start = _fmt_time(0.0)
    end   = _fmt_time(max(1.0, float(duration_s)))

    head_override = f"{{\\pos({HEAD_POS_X},{HEAD_POS_Y})\\an5}}"
    sub_override  = f"{{\\pos({HEAD_POS_X},{SUB_POS_Y})\\an5}}"

    events = [
        f"Dialogue: 0,{start},{end},Head,,0,0,0,,{head_override}{head_text}",
        f"Dialogue: 0,{start},{end},Sub,,0,0,0,,{sub_override}Read captions…",
    ]
    return header + "\n".join(events) + "\n"


# ── ffmpeg render ──────────────────────────────────────────

def _probe_duration(src: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(src)],
        capture_output=True, text=True, check=True,
    )
    return float((r.stdout or "10.0").strip() or "10.0")


def _is_hdr(src: Path) -> bool:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=color_primaries,color_transfer,color_space",
         "-of", "default=noprint_wrappers=1:nokey=0", str(src)],
        capture_output=True, text=True,
    )
    s = (r.stdout or "").lower()
    return ("bt2020" in s) or ("arib-std-b67" in s) or ("smpte2084" in s)


def _download_music(url: str, dest: Path) -> Optional[Path]:
    """Pull a background music file to `dest`. Returns None on failure
    (renderer falls back to silent output)."""
    if not url:
        return None
    try:
        import httpx
        with httpx.stream("GET", url, follow_redirects=True, timeout=120.0) as r:
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_bytes(1024 * 1024):
                    f.write(chunk)
        if dest.stat().st_size < 1024:
            return None
        return dest
    except Exception as e:
        print(f"[broll] music fetch failed: {e}", file=sys.stderr)
        return None


# ── Thumbnail (reuses talking-head thumbnail_builder primitives) ───────

def render_broll_thumbnail(src_path: Path, headline: str, gold_phrase: str = "",
                            *, work_dir: Path, frame_t: float | None = None) -> Optional[Path]:
    """Generate a magazine-cover thumbnail for the B-roll reel.

    Pulls a frame from the source clip, overlays the AI-generated headline
    (with gold_phrase highlighted) using thumbnail_builder's HTML + Playwright
    pipeline. Writes <work_dir>/thumbnail.png. Returns the path or None on
    failure (we never want a missing thumbnail to fail the whole render).
    """
    try:
        import asyncio
        from thumbnail_builder import (
            _extract_frame, _png_to_data_url, _thumbnail_html, _render_thumbnail,
        )
    except Exception as e:
        print(f"[broll] thumbnail import failed: {e}", file=sys.stderr)
        return None

    try:
        duration = _probe_duration(src_path)
        t = frame_t if frame_t is not None else max(1.0, min(duration - 0.2, duration * 0.25))
        frame_path = work_dir / "thumbnail-frame.png"
        _extract_frame(src_path, t, frame_path)
        frame_data_url = _png_to_data_url(frame_path)
        html_path = work_dir / "thumbnail.html"
        html_path.write_text(
            _thumbnail_html(frame_data_url, headline.strip(), (gold_phrase or None)),
            encoding="utf-8",
        )
        out_path = work_dir / "thumbnail.png"
        asyncio.run(_render_thumbnail(html_path, out_path))
        return out_path
    except Exception as e:
        print(f"[broll] thumbnail render failed: {e}", file=sys.stderr)
        return None


def render_broll(src_path: Path, headline: str, *, work_dir: Path,
                 music_url: str = "", mood: str = "driven") -> Path:
    """Render the B-roll reel:
       - drop source audio (B-roll is always silent-source by definition);
       - scale + center-crop to 1080x1920;
       - light color grade (contrast 1.05, saturation 1.08);
       - HDR base: HLG -> linear -> BT.709 SDR tonemap before grading;
       - burn the two-line ASS overlay (Archivo Black headline + sub) inside
         the strict Reels safe zone;
       - pick a music track: explicit `music_url` wins; else random track from
         MUSIC_LIBRARY[mood]; else env REEL_BROLL_MUSIC_URL; else silent.
         Mix at -9 dB, looped to clip length, 0.5s fade-in/out.
    Returns the path to reel.mp4.
    """
    if not music_url:
        music_url = _pick_music_url(mood)
    work_dir.mkdir(parents=True, exist_ok=True)
    duration_s = _probe_duration(src_path)
    hdr        = _is_hdr(src_path)

    ass_path = work_dir / "overlay.ass"
    ass_path.write_text(build_overlay_ass(headline, duration_s, hdr=hdr))

    fonts_dir  = Path(__file__).resolve().parent / "fonts"
    fonts_arg  = f":fontsdir={fonts_dir}" if fonts_dir.is_dir() else ""

    # Vertical canvas: scale-increase + center-crop. Handles vertical, square,
    # or landscape inputs uniformly. Subs burn AFTER the scale so they always
    # land at 1080-space coordinates regardless of source dimensions.
    if hdr:
        vf = (
            "scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,"
            "zscale=t=linear:npl=100,format=gbrpf32le,"
            "zscale=p=709:t=709:m=709,format=yuv420p,"
            "eq=contrast=1.05:saturation=1.08,"
            f"subtitles=overlay.ass{fonts_arg}"
        )
    else:
        vf = (
            "scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,"
            "eq=contrast=1.05:saturation=1.08,"
            f"subtitles=overlay.ass{fonts_arg}"
        )

    music_path: Optional[Path] = None
    if music_url:
        music_path = _download_music(music_url, work_dir / "music.mp3")

    out = work_dir / "reel.mp4"
    base_cmd = [
        "ffmpeg", "-y",
        "-i", str(src_path),
    ]
    if music_path:
        # Loop the track infinitely; -shortest + -t cap output at clip duration.
        # afade in/out smooths the loop seam. Volume -9 dB sits under voice-free
        # B-roll naturally without overpowering on phone speakers.
        base_cmd += ["-stream_loop", "-1", "-i", str(music_path)]
    base_cmd += [
        "-vf", vf,
        "-map", "0:v:0",
    ]
    if music_path:
        fade_out_start = max(0.0, duration_s - 0.5)
        af = (
            f"volume=0.35,"
            f"afade=t=in:st=0:d=0.5,"
            f"afade=t=out:st={fade_out_start:.2f}:d=0.5"
        )
        base_cmd += [
            "-map", "1:a:0",
            "-af", af,
            "-c:a", "aac", "-b:a", "192k",
        ]
    else:
        base_cmd += ["-an"]            # no music available: silent output
    base_cmd += [
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-t", f"{duration_s:.3f}",
        "-movflags", "+faststart",
    ]
    if music_path:
        base_cmd.append("-shortest")
    base_cmd.append("reel.mp4")

    # cwd = work_dir so the subtitles filter resolves overlay.ass without
    # filter-graph colon-escaping headaches (matches reel_editor pattern).
    subprocess.run(base_cmd, cwd=str(work_dir), check=True)
    return out
