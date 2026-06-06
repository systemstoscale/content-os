from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import List

from .transcribe import Transcript, Word


@dataclass
class Clip:
    start: float
    end: float


def silence_cut_clips(
    words: List[Word],
    total_duration: float,
    *,
    max_gap: float = 0.6,
    padding: float = 0.08,
) -> List[Clip]:
    """Collapse the talk-track into clips by trimming gaps between words longer than `max_gap`."""
    if not words:
        return [Clip(0.0, total_duration)]

    clips: List[Clip] = []
    cur_start = max(0.0, words[0].start - padding)
    cur_end = words[0].end + padding

    for w in words[1:]:
        gap = w.start - cur_end
        if gap > max_gap:
            clips.append(Clip(cur_start, cur_end))
            cur_start = max(0.0, w.start - padding)
        cur_end = w.end + padding

    clips.append(Clip(cur_start, min(total_duration, cur_end)))
    return [c for c in clips if c.end - c.start > 0.15]


def shift_words_for_clips(words: List[Word], clips: List[Clip]) -> List[Word]:
    """Rebase word timestamps so they map onto the trimmed output timeline."""
    shifted: List[Word] = []
    offset = 0.0
    out_cursor = 0.0

    clip_idx = 0
    for w in words:
        while clip_idx < len(clips) and w.start >= clips[clip_idx].end:
            clip_idx += 1
            if clip_idx >= len(clips):
                break
        if clip_idx >= len(clips):
            break
        c = clips[clip_idx]
        if w.start < c.start:
            continue
        delta = c.start - out_cursor if clip_idx == 0 else _accumulated_drop(clips, clip_idx)
        shifted.append(Word(start=w.start - delta, end=w.end - delta, word=w.word))
    return shifted


def _accumulated_drop(clips: List[Clip], idx: int) -> float:
    """Total seconds removed before the start of clip[idx]."""
    drop = clips[0].start
    for i in range(1, idx + 1):
        drop += clips[i].start - clips[i - 1].end
    return drop


def run_ffmpeg_concat(
    input_path: str,
    clips: List[Clip],
    output_path: str,
    subtitles_path: str | None = None,
) -> None:
    """Trim and concat with ffmpeg, optionally burning .ass subtitles."""
    if not clips:
        raise ValueError("no clips to render")

    select_parts = "+".join(
        f"between(t,{c.start:.3f},{c.end:.3f})" for c in clips
    )
    video_filter = f"select='{select_parts}',setpts=N/FRAME_RATE/TB"
    audio_filter = f"aselect='{select_parts}',asetpts=N/SR/TB"

    if subtitles_path:
        video_filter += f",subtitles='{subtitles_path}'"

    cmd = [
        "ffmpeg",
        "-y",
        "-i", input_path,
        "-vf", video_filter,
        "-af", audio_filter,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        output_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
