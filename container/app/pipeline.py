from __future__ import annotations

import base64
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .transcribe import transcribe
from .cut import silence_cut_clips, shift_words_for_clips, run_ffmpeg_concat, Clip
from .captions import build_opus_ass, build_minimal_ass


CaptionStyle = Literal["opus", "minimal", "off"]


@dataclass
class PipelineResult:
    video_path: Path
    transcript_b64: str
    output_duration: float
    input_duration: float
    clip_count: int
    # Representative JPEG frame extracted from the PROCESSED video, used by the
    # render_thumbnail tool as a background. None if extraction failed (we
    # don't fail the whole pipeline just because the cover frame failed).
    frame_path: Path | None = None


def extract_cover_frame(video_path: Path, out_path: Path, at_seconds: float = 1.5) -> Path | None:
    """Grab one JPEG frame from `video_path` at `at_seconds`. Returns the path
    on success, None on failure. We keep the source resolution (no scaling) so
    the renderer can pick the crop, but use moderate JPEG quality to keep the
    file small enough to pipe back through the Worker."""
    cmd = [
        "ffmpeg",
        "-y",
        "-ss", f"{at_seconds:.2f}",
        "-i", str(video_path),
        "-vframes", "1",
        "-q:v", "4",
        str(out_path),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        return out_path if out_path.exists() and out_path.stat().st_size > 0 else None
    except subprocess.CalledProcessError:
        return None


def probe_duration(path: str) -> float:
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def run_reel_pipeline(
    *,
    workdir: Path,
    input_path: Path,
    caption_style: CaptionStyle = "opus",
    cut_silences: bool = True,
) -> PipelineResult:
    """Transcribe → (optionally) silence-cut → (optionally) burn captions → return MP4."""
    duration = probe_duration(str(input_path))
    transcript = transcribe(str(input_path))
    transcript.duration_seconds = transcript.duration_seconds or duration

    if cut_silences:
        clips = silence_cut_clips(transcript.words, total_duration=duration)
        shifted_words = shift_words_for_clips(transcript.words, clips)
    else:
        clips = [Clip(0.0, duration)]
        shifted_words = transcript.words

    subs_path: str | None = None
    if caption_style != "off":
        ass = (
            build_opus_ass(shifted_words)
            if caption_style == "opus"
            else build_minimal_ass(shifted_words)
        )
        subs_path = str(workdir / "captions.ass")
        Path(subs_path).write_text(ass, encoding="utf-8")

    # Cover frame from the RAW input (before captions burn) so the thumbnail
    # is clean. We pick the start of the first kept clip, offset by 0.5s, so
    # the frame is from content the creator actually meant to keep.
    if clips:
        first_kept = clips[0].start
        frame_at = min(first_kept + 0.5, max(0.0, duration - 0.1))
    else:
        frame_at = min(1.5, max(0.0, duration * 0.05))
    frame_path = extract_cover_frame(input_path, workdir / "frame.jpg", at_seconds=frame_at)

    output_path = workdir / "out.mp4"
    run_ffmpeg_concat(str(input_path), clips, str(output_path), subtitles_path=subs_path)

    transcript_dict = transcript.to_dict()
    transcript_dict["words"] = [
        {"start": w.start, "end": w.end, "word": w.word} for w in shifted_words
    ]
    transcript_b64 = base64.b64encode(
        json.dumps(transcript_dict, ensure_ascii=False).encode("utf-8")
    ).decode("ascii")

    return PipelineResult(
        video_path=output_path,
        transcript_b64=transcript_b64,
        output_duration=sum(c.end - c.start for c in clips),
        input_duration=duration,
        clip_count=len(clips),
        frame_path=frame_path,
    )
