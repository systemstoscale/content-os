"""Build word-synced karaoke captions (.ass) from transcript.json.

Style is resolved from the brand profile (`brand_profile.caption_style()`), so
each ContentOS buyer gets their own caption look — font, size, position
(top/center/bottom), case, words-per-group, animation (pop/fade/none), outline,
shadow, and optional highlight color. The Skalers default preset ("bold-karaoke")
reproduces the original look: one uppercase Archivo Black word at a time in the
top safe zone with a scale-pop.

ASS note: colors use &HBBGGRR& (BGR).
"""
from __future__ import annotations

import json
from pathlib import Path

import brand_profile as _bp

WHITE_BGR = "FFFFFF"
BLACK_BGR = "000000"


def _fmt_time(t: float) -> str:
    if t < 0:
        t = 0.0
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t - h * 3600 - m * 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _clean_word(w: str) -> str:
    w = w.strip()
    return w.replace("—", "").replace("–", "")


def _in_mute(start: float, end: float, mute_windows: list[tuple[float, float]]) -> bool:
    """True if the window overlaps any mute window."""
    for ms, me in mute_windows:
        if start < me and end > ms:
            return True
    return False


def _anim_override(animation: str) -> str:
    """ASS transform tags for the chosen caption animation."""
    if animation == "pop":
        return r"\fscx85\fscy85\t(0,120,\fscx105\fscy105)\t(120,200,\fscx100\fscy100)"
    if animation == "fade":
        return r"\fad(120,80)"
    return ""  # "none"


def build_ass(
    transcript: dict,
    *,
    uppercase: bool = True,
    mute_windows: list[tuple[float, float]] | None = None,
    hdr: bool = False,
) -> str:
    """Build ASS karaoke captions in the buyer's resolved caption style.

    When `hdr=True` (base video is BT.2020 HLG/PQ), the YCbCr Matrix is set so
    libass renders the sRGB hex values via full-range primaries, keeping brand
    colors accurate instead of pushing toward orange.

    `uppercase` is a legacy override honored only when the style's case is not
    explicitly "sentence" (so the Skalers default stays uppercase).
    """
    words = [w for w in transcript.get("words", []) if _clean_word(w.get("word", ""))]
    if not words:
        return ""
    mutes = list(mute_windows or [])

    style = _bp.caption_style()
    font = str(style["font"])
    size = int(style["size"])
    pos_x = int(style["pos_x"])
    pos_y = int(style["pos_y"])
    outline = int(style["outline"])
    shadow = int(style["shadow"])
    wpg = int(style.get("words_per_group", 1) or 0)
    animation = str(style.get("animation", "pop"))
    case = str(style.get("case", "upper"))
    color = style.get("highlight_bgr") or WHITE_BGR
    do_upper = (case != "sentence") and uppercase

    # Group words: wpg>=1 -> chunks of wpg; wpg<=0 -> readable lines of ~5.
    n = wpg if wpg >= 1 else 5
    groups: list[list[dict]] = [words[i : i + n] for i in range(0, len(words), n)]

    matrix_line = "YCbCr Matrix: PC.709" if hdr else "YCbCr Matrix: TV.709"
    header = (
        "[Script Info]\n"
        "Title: Reel captions\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1080\n"
        "PlayResY: 1920\n"
        "WrapStyle: 2\n"
        "ScaledBorderAndShadow: yes\n"
        f"{matrix_line}\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Cap,{font},{size},&H00{color},&H000000FF,"
        f"&H00{BLACK_BGR},&HC0000000,-1,0,0,0,100,100,0,0,1,{outline},{shadow},5,0,0,0,1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    anim = _anim_override(animation)
    events: list[str] = []
    for gi, group in enumerate(groups):
        tokens = [_clean_word(w["word"]) for w in group]
        tokens = [t for t in tokens if t]
        if not tokens:
            continue
        text = " ".join(tokens)
        if do_upper:
            text = text.upper()

        start = float(group[0]["start"])
        end = float(group[-1]["end"])
        if gi + 1 < len(groups):
            next_start = float(groups[gi + 1][0]["start"])
            end = min(next_start, end + 0.2)
        else:
            end = end + 0.1
        if end <= start:
            end = start + 0.08

        if _in_mute(start, end, mutes):
            continue

        override = f"{{\\pos({pos_x},{pos_y})\\c&H{color}&{anim}}}"
        events.append(
            f"Dialogue: 0,{_fmt_time(start)},{_fmt_time(end)},Cap,,0,0,0,,{override}{text}"
        )

    return header + "\n".join(events) + "\n"


def build_ass_from_path(
    transcript_path: Path,
    *,
    uppercase: bool = True,
    mute_windows: list[tuple[float, float]] | None = None,
    hdr: bool = False,
) -> str:
    return build_ass(
        json.loads(transcript_path.read_text()),
        uppercase=uppercase,
        mute_windows=mute_windows,
        hdr=hdr,
    )
