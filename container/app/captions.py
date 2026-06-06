from __future__ import annotations

from typing import List

from .transcribe import Word


ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,DejaVu Sans,72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,80,80,260,1
Style: Hot ,DejaVu Sans,72,&H0080D3F8,&H0080D3F8,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,80,80,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _ts(t: float) -> str:
    if t < 0:
        t = 0
    cs = int(round(t * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def build_opus_ass(words: List[Word], *, group_size: int = 3) -> str:
    """Generate an .ass file with word-by-word highlighting in groups of N."""
    if not words:
        return ASS_HEADER

    lines: List[str] = [ASS_HEADER]
    i = 0
    while i < len(words):
        group = words[i : i + group_size]
        group_start = group[0].start
        group_end = group[-1].end

        for j, w in enumerate(group):
            parts = []
            for k, gw in enumerate(group):
                token = gw.word.replace("{", "(").replace("}", ")").upper()
                if k == j:
                    parts.append(r"{\1c&H80D3F8&\b1}" + token + r"{\b0\1c&HFFFFFF&}")
                else:
                    parts.append(token)
            text = " ".join(parts)
            start = w.start
            end = w.end if j < len(group) - 1 else group_end
            lines.append(
                f"Dialogue: 0,{_ts(start)},{_ts(end)},Base,,0,0,0,,{text}"
            )

        i += group_size

    return "\n".join(lines) + "\n"


def build_minimal_ass(words: List[Word]) -> str:
    """One subtitle line per segment of ~6 words. No per-word highlight."""
    if not words:
        return ASS_HEADER

    lines: List[str] = [ASS_HEADER]
    chunk: List[Word] = []
    for w in words:
        chunk.append(w)
        if len(chunk) >= 6:
            text = " ".join(c.word for c in chunk).upper()
            lines.append(
                f"Dialogue: 0,{_ts(chunk[0].start)},{_ts(chunk[-1].end)},Base,,0,0,0,,{text}"
            )
            chunk = []
    if chunk:
        text = " ".join(c.word for c in chunk).upper()
        lines.append(
            f"Dialogue: 0,{_ts(chunk[0].start)},{_ts(chunk[-1].end)},Base,,0,0,0,,{text}"
        )

    return "\n".join(lines) + "\n"
