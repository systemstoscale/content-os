"""Reel editor — three-phase pipeline.

Workflow:
    1. `cut`     — transcribe + silence/filler trim. Produces reel-cut.mp4 (talking head only)
                   and transcript.json (word timings on the CUT timeline).
    2. Agent     — reads reel-cut.mp4 + transcript.json, designs B-roll, writes broll-plan.json
                   and renders any PNG assets into broll/.
    3. `caption` — builds captions.ass (word-synced karaoke) from transcript.json. Optional:
                   `render` auto-builds it if missing.
    4. `render`  — burns captions.ass + composites PNG overlays onto reel-cut.mp4 → reel.mp4.

Usage:
    python3 skalers/backend/content/reel_editor.py cut     <reel-folder>/ [--refresh]
    python3 skalers/backend/content/reel_editor.py caption <reel-folder>/ [--no-uppercase]
    python3 skalers/backend/content/reel_editor.py render  <reel-folder>/ [--no-captions]

Folder layout (after cut):
    <folder>/
        script.md              # spoken beats + captions (no asset markers needed)
        <something>.mp4        # raw recording
        reel-cut.mp4           # talking head, trimmed, no overlays
        transcript.json        # word timings on cut timeline
        cut.log

Folder layout (after agent + caption + render):
    <folder>/
        broll-plan.json        # [{start, end, asset}, ...] — cut-timeline overlays
        broll/*.png            # 1080x1920 overlay assets referenced by the plan
        captions.ass           # word-synced karaoke captions (regeneratable from transcript.json)
        reel.mp4               # final composited reel (captions burnt in)
        render.log
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import httpx

from caption_builder import build_ass_from_path
from transcript_cleanup import cleanup_spans, repetition_spans
from broll_planner import plan_broll, plan_design_render, render_cards as render_broll_cards
from thumbnail_builder import generate_thumbnail

# Load .env.shared from the repo root if running locally. Skip on Modal
# (SKALERS_RUN_IN_MODAL=1 set in the image) — env comes from Modal Secrets there.
if not os.environ.get("SKALERS_RUN_IN_MODAL"):
    try:
        REPO_ROOT = Path(__file__).resolve().parents[3]
    except IndexError:
        REPO_ROOT = Path(__file__).resolve().parent  # fall back gracefully
    ENV_PATH = REPO_ROOT / ".env.shared"
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODEL = "whisper-large-v3-turbo"

SILENCE_NOISE_DB = -30
SILENCE_MIN_DURATION = 0.9      # only cut pauses ≥ 900 ms
SILENCE_PAD = 0.18              # leave 180 ms on each end of a cut (natural breath)
MIN_KEEP_DURATION = 0.5         # merge keep-segments shorter than this into their neighbors
FILLER_WORDS = {"um", "uh", "uhm", "hmm", "er", "ah", "erm"}


@dataclass
class Segment:
    start: float
    end: float


# ----------------------------------------------------------------------
# Audio extraction + transcription
# ----------------------------------------------------------------------


def extract_audio(video: Path, audio_out: Path) -> None:
    cmd = [
        "ffmpeg", "-i", str(video),
        "-vn",
        "-acodec", "libopus",
        "-b:a", "24k",
        "-ar", "16000",
        "-ac", "1",
        "-y", "-loglevel", "error",
        str(audio_out),
    ]
    subprocess.run(cmd, check=True)


DEFAULT_TRANSCRIBE_PROMPT = (
    "Skalers. Claude. Claude Code. Telegram. Instagram. TikTok. YouTube. "
    "B-roll. ContentOS. AI agent. Anthropic."
)


def transcribe(audio: Path, prompt: str = DEFAULT_TRANSCRIBE_PROMPT) -> dict:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise SystemExit("GROQ_API_KEY missing — check .env.shared")

    with open(audio, "rb") as f:
        audio_bytes = f.read()

    # Whisper's `prompt` biases the decoder toward in-vocabulary proper nouns.
    # Without it Groq reliably mishears "Claude" as "Cloud" (worse next to the
    # phrase "in the cloud"). Keep it short; Whisper only uses the last ~224 tok.
    files = {
        "file": (audio.name, audio_bytes, "audio/ogg"),
        "model": (None, GROQ_MODEL),
        "response_format": (None, "verbose_json"),
        "language": (None, "en"),
        "temperature": (None, "0"),
        "timestamp_granularities[]": (None, "word"),
    }
    if prompt:
        files["prompt"] = (None, prompt)

    resp = httpx.post(
        GROQ_API_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        files=files,
        timeout=300.0,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Groq error {resp.status_code}: {resp.text[:500]}")

    data = resp.json()
    words = [
        {"word": w.get("word", ""), "start": float(w.get("start", 0)), "end": float(w.get("end", 0))}
        for w in data.get("words", [])
    ]
    if not words:
        for seg in data.get("segments", []):
            tokens = seg.get("text", "").strip().split()
            if not tokens:
                continue
            dur = float(seg["end"]) - float(seg["start"])
            step = dur / max(len(tokens), 1)
            for i, tok in enumerate(tokens):
                words.append({
                    "word": tok,
                    "start": round(float(seg["start"]) + i * step, 3),
                    "end": round(float(seg["start"]) + (i + 1) * step, 3),
                })

    return {
        "text": data.get("text", ""),
        "words": words,
        "segments": data.get("segments", []),
    }


# ----------------------------------------------------------------------
# Silence + filler trim
# ----------------------------------------------------------------------


def detect_silences(audio: Path) -> list[Segment]:
    cmd = [
        "ffmpeg", "-i", str(audio),
        "-af", f"silencedetect=noise={SILENCE_NOISE_DB}dB:d={SILENCE_MIN_DURATION}",
        "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    silences: list[Segment] = []
    starts: list[float] = []
    for line in proc.stderr.splitlines():
        m = re.search(r"silence_start:\s*([\d.]+)", line)
        if m:
            starts.append(float(m.group(1)))
            continue
        m = re.search(r"silence_end:\s*([\d.]+)", line)
        if m and starts:
            silences.append(Segment(start=starts.pop(0), end=float(m.group(1))))
    return silences


def probe_dimensions(media: Path) -> tuple[int, int]:
    cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0",
           "-show_entries", "stream=width,height", "-of", "csv=p=0", str(media)]
    out = subprocess.check_output(cmd, text=True).strip().rstrip(",")
    parts = [p for p in out.split(",") if p]
    w, h = parts[0], parts[1]
    return int(w), int(h)


def probe_fps(media: Path) -> float:
    cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0",
           "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", str(media)]
    out = subprocess.check_output(cmd, text=True).strip().rstrip(",")
    num, _, den = out.partition("/")
    return float(num) / float(den) if den else float(num)


def media_duration(media: Path) -> float:
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration",
           "-of", "default=nw=1:nk=1", str(media)]
    out = subprocess.check_output(cmd, text=True).strip()
    return float(out)


def is_hdr(media: Path) -> bool:
    """True if the video stream is HDR-tagged (HLG or PQ).

    iPhone HEVC HDR uses `arib-std-b67` (HLG); some sources use `smpte2084` (PQ).
    Either way the stream is BT.2020 primaries — overlays in BT.709 sRGB will
    drift toward orange unless we color-convert.
    """
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=color_transfer,color_primaries,color_space",
        "-of", "default=nw=1:nk=1", str(media),
    ]
    try:
        out = subprocess.check_output(cmd, text=True).strip().lower()
    except subprocess.CalledProcessError:
        return False
    return "arib-std-b67" in out or "smpte2084" in out or "bt2020" in out


def build_keep_segments(
    total_duration: float,
    silences: list[Segment],
    filler_spans: list[Segment],
) -> list[Segment]:
    padded_silences: list[Segment] = []
    for s in silences:
        dur = s.end - s.start
        if dur <= 2 * SILENCE_PAD:
            continue
        padded_silences.append(Segment(start=s.start + SILENCE_PAD, end=s.end - SILENCE_PAD))

    drops = sorted(padded_silences + filler_spans, key=lambda s: s.start)

    merged: list[Segment] = []
    for d in drops:
        if merged and d.start <= merged[-1].end:
            merged[-1].end = max(merged[-1].end, d.end)
        else:
            merged.append(Segment(start=d.start, end=d.end))

    keeps: list[Segment] = []
    cursor = 0.0
    for d in merged:
        if d.start > cursor:
            keeps.append(Segment(start=cursor, end=d.start))
        cursor = max(cursor, d.end)
    if cursor < total_duration:
        keeps.append(Segment(start=cursor, end=total_duration))

    merged_keeps: list[Segment] = []
    for k in keeps:
        if k.end - k.start < MIN_KEEP_DURATION and merged_keeps:
            merged_keeps[-1] = Segment(start=merged_keeps[-1].start, end=k.end)
        else:
            merged_keeps.append(k)

    coalesced: list[Segment] = []
    for k in merged_keeps:
        if coalesced and k.start <= coalesced[-1].end:
            coalesced[-1] = Segment(start=coalesced[-1].start, end=max(coalesced[-1].end, k.end))
        else:
            coalesced.append(k)

    return [k for k in coalesced if (k.end - k.start) > 0.05]


def filler_spans_from_words(words: list[dict]) -> list[Segment]:
    spans: list[Segment] = []
    for w in words:
        tok = re.sub(r"[^a-z]", "", w["word"].lower())
        if tok in FILLER_WORDS:
            spans.append(Segment(start=float(w["start"]), end=float(w["end"])))
    return spans


# ----------------------------------------------------------------------
# Timeline mapping: raw → cut
# ----------------------------------------------------------------------


def map_to_cut_time(t: float, keeps: list[Segment]) -> float | None:
    """Map a raw-timeline timestamp to the cut timeline. Returns None if t falls in a dropped segment."""
    cut_t = 0.0
    for k in keeps:
        if t < k.start:
            return None  # inside a drop
        if t <= k.end:
            return cut_t + (t - k.start)
        cut_t += k.end - k.start
    return None


def remap_words_to_cut(words: list[dict], keeps: list[Segment]) -> list[dict]:
    out: list[dict] = []
    for w in words:
        s = map_to_cut_time(float(w["start"]), keeps)
        e = map_to_cut_time(float(w["end"]), keeps)
        if s is None or e is None or e <= s:
            continue
        out.append({"word": w["word"], "start": round(s, 3), "end": round(e, 3)})
    return out


# ----------------------------------------------------------------------
# FFmpeg encoding
# ----------------------------------------------------------------------


def has_videotoolbox() -> bool:
    if platform.system() != "Darwin":
        return False
    try:
        out = subprocess.check_output(
            ["ffmpeg", "-hide_banner", "-encoders"], text=True, stderr=subprocess.STDOUT
        )
        return "h264_videotoolbox" in out
    except Exception:
        return False


def encoder_args() -> list[str]:
    if has_videotoolbox():
        return ["-c:v", "h264_videotoolbox", "-b:v", "6M"]
    return ["-c:v", "libx264", "-crf", "18", "-preset", "medium"]


def build_trim_filter_parts(
    keeps: list[Segment],
    fps: float,
    *,
    enhance: bool = True,
) -> tuple[list[str], str, str, list[Segment]]:
    """Build trim+concat filter chain. Snaps boundaries to the 1/fps grid so audio (sample-precise)
    and video (frame-precise) land on the same moment. aresample re-locks the combined audio track.

    When `enhance=True`, appends:
      - Audio: highpass 80 / lowpass 12k, presence EQ, gentle compression, loudnorm I=-16 (single-pass).
      - Video: eq contrast 1.05 / saturation 1.08 (subtle warm-up; LUT belongs in render).
    Single ffmpeg pass — no extra encode round-trip vs trim-only.
    """
    if not keeps:
        parts = ["[0:v]copy[vraw]", "[0:a]acopy[araw]"]
        v_in, a_in = "vraw", "araw"
        snapped = keeps
    else:
        def snap(t: float) -> float:
            return round(t * fps) / fps

        snapped: list[Segment] = []
        for k in keeps:
            s = snap(k.start)
            e = snap(k.end)
            if e - s >= 1.0 / fps:
                snapped.append(Segment(start=s, end=e))

        if not snapped:
            parts = ["[0:v]copy[vraw]", "[0:a]acopy[araw]"]
            v_in, a_in = "vraw", "araw"
        else:
            parts = []
            for i, k in enumerate(snapped):
                parts.append(f"[0:v]trim=start={k.start:.6f}:end={k.end:.6f},setpts=PTS-STARTPTS[v{i}]")
                parts.append(f"[0:a]atrim=start={k.start:.6f}:end={k.end:.6f},asetpts=PTS-STARTPTS[a{i}]")
            concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(len(snapped)))
            parts.append(f"{concat_inputs}concat=n={len(snapped)}:v=1:a=1[vraw][atmp]")
            parts.append("[atmp]aresample=async=1000:first_pts=0[araw]")
            v_in, a_in = "vraw", "araw"

    if not enhance:
        return parts, v_in, a_in, snapped

    # Audio enhance: voice-band shaping + loudness normalize.
    #   highpass 80 Hz   — kills HVAC rumble, room boom
    #   lowpass 12 kHz   — tames sibilance from on-camera mics
    #   equalizer 200 Hz -1 dB — reduce muddiness
    #   equalizer 3 kHz +2 dB  — presence / intelligibility
    #   acompressor 3:1, attack 20ms, release 250ms — even out delivery
    #   loudnorm I=-16:LRA=11:TP=-1.5 — IG/TT loudness target with safety margin
    parts.append(
        f"[{a_in}]highpass=f=80,lowpass=f=12000,"
        "equalizer=f=200:t=q:w=1:g=-1,"
        "equalizer=f=3000:t=q:w=1:g=2,"
        "acompressor=ratio=3:attack=20:release=250,"
        "loudnorm=I=-16:LRA=11:TP=-1.5[aenh]"
    )

    # Video grade: subtle contrast + saturation lift. Stays inside HDR-flagged stream;
    # the render step does the HDR→SDR retag before subtitles burn (see cmd_render).
    parts.append(f"[{v_in}]eq=contrast=1.05:saturation=1.08[vgrad]")

    return parts, "vgrad", "aenh", snapped


# ----------------------------------------------------------------------
# `cut` subcommand
# ----------------------------------------------------------------------


def find_raw_video(folder: Path) -> Path:
    reserved = {"reel.mp4", "reel-cut.mp4"}
    extensions = (".mp4", ".mov", ".m4v")
    candidates = [
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in extensions and p.name not in reserved
    ]
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise SystemExit(f"No raw mp4/mov found in {folder}")
    if len(candidates) > 1:
        print(f"Warning: multiple raw videos, picking most recent: {candidates[0].name}")
    return candidates[0]


def cmd_cut(args) -> None:
    folder = args.folder.resolve()
    if not folder.is_dir():
        raise SystemExit(f"Not a folder: {folder}")

    raw = find_raw_video(folder)
    transcript_path = folder / "transcript.json"
    cut_out = folder / "reel-cut.mp4"
    log_out = folder / "cut.log"

    print(f"[cut] folder: {folder.name}")
    print(f"[cut] raw:    {raw.name} ({raw.stat().st_size / 1e6:.1f} MB)")

    # 1. Transcribe (cached by raw-file mtime)
    raw_transcript = None
    raw_transcript_path = folder / "transcript-raw.json"
    if raw_transcript_path.exists() and not args.refresh:
        if raw_transcript_path.stat().st_mtime >= raw.stat().st_mtime:
            raw_transcript = json.loads(raw_transcript_path.read_text())
            print(f"[cut] cached raw transcript ({len(raw_transcript.get('words', []))} words)")

    if raw_transcript is None:
        tmp_audio = folder / "_audio.ogg"
        print(f"[cut] extracting audio...")
        extract_audio(raw, tmp_audio)
        print(f"[cut] transcribing via Groq {GROQ_MODEL}...")
        raw_transcript = transcribe(tmp_audio)
        raw_transcript_path.write_text(json.dumps(raw_transcript, indent=2))
        tmp_audio.unlink(missing_ok=True)
        print(f"[cut] cached {len(raw_transcript.get('words', []))} words → transcript-raw.json")

    duration = media_duration(raw)

    # 2. Detect silences + fillers → build keep segments
    print("[cut] detecting silences + fillers...")
    tmp_audio = folder / "_audio.ogg"
    if not tmp_audio.exists():
        extract_audio(raw, tmp_audio)
    silences = detect_silences(tmp_audio)
    fillers = filler_spans_from_words(raw_transcript["words"])
    tmp_audio.unlink(missing_ok=True)

    # 2b. Optional Claude cleanup pass — flags false starts, repeated words, off-list fillers.
    # Cached at transcript-cleanup-<hash>.json so re-running cut doesn't re-call the API.
    cleanup_drops: list[dict] = []
    repetition_drops: list[dict] = []
    if not getattr(args, "no_clean", False):
        print("[cut] cleanup: asking Claude (Haiku) for filler drops...")
        spans, cleanup_drops = cleanup_spans(
            raw_transcript["words"], folder=folder, refresh=args.refresh,
        )
        if spans:
            print(f"[cut]   Haiku flagged {len(cleanup_drops)} filler drops "
                  f"({sum(e - s for s, e in spans):.2f}s)")
            for d in cleanup_drops[:5]:
                print(f"[cut]     [{d['start']:6.2f}-{d['end']:6.2f}] {d['text']!r} ({d['reason']})")
            if len(cleanup_drops) > 5:
                print(f"[cut]     ... +{len(cleanup_drops) - 5} more")
            for s, e in spans:
                fillers.append(Segment(start=s, end=e))
        else:
            print("[cut]   Haiku flagged no filler drops")

        # 2c. Semantic repetition pass — Sonnet 4.6 catches re-asked questions
        # and restated concepts that the Haiku filler pass doesn't see.
        # Cached at transcript-repetition-<hash>.json.
        print("[cut] cleanup: asking Claude (Sonnet) for semantic repetitions...")
        already_flagged = sum(d["i_end"] - d["i_start"] + 1 for d in cleanup_drops)
        rep_spans, repetition_drops = repetition_spans(
            raw_transcript["words"],
            folder=folder,
            refresh=args.refresh,
            already_flagged_count=already_flagged,
        )
        if rep_spans:
            total_rep = sum(e - s for s, e in rep_spans)
            print(f"[cut]   Sonnet flagged {len(repetition_drops)} semantic repetitions "
                  f"({total_rep:.2f}s)")
            for d in repetition_drops[:5]:
                drop_preview = d['drop_text'][:60]
                kept_preview = d['kept_text'][:60]
                print(f"[cut]     drop [{d['drop_start']:6.2f}-{d['drop_end']:6.2f}] "
                      f"{drop_preview!r} ({d['reason']})")
                print(f"[cut]     keep                     {kept_preview!r}")
            if len(repetition_drops) > 5:
                print(f"[cut]     ... +{len(repetition_drops) - 5} more")
            for s, e in rep_spans:
                fillers.append(Segment(start=s, end=e))
        else:
            print("[cut]   Sonnet flagged no semantic repetitions")

    keeps = build_keep_segments(duration, silences, fillers)
    dropped = duration - sum(k.end - k.start for k in keeps)
    print(f"[cut]   silences: {len(silences)}, fillers: {len(fillers)}, dropped: {dropped:.2f}s")

    # 3. Render reel-cut.mp4 (trim + audio enhance + color grade in one ffmpeg pass)
    fps = probe_fps(raw)
    enhance = not getattr(args, "no_enhance", False)
    trim_parts, v_label, a_label, snapped_keeps = build_trim_filter_parts(
        keeps, fps, enhance=enhance,
    )
    filter_complex = ";".join(trim_parts)
    if enhance:
        print("[cut]   audio enhance: highpass 80 / lowpass 12k / EQ / loudnorm -16 LUFS")
        print("[cut]   color grade:   contrast 1.05 / saturation 1.08")

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
        "-filter_complex", filter_complex,
        "-map", f"[{v_label}]",
        "-map", f"[{a_label}]",
        *encoder_args(),
        "-c:a", "aac", "-b:a", "160k",
        "-ar", "44100",
        "-movflags", "+faststart",
        "-fps_mode", "cfr",
        "-vsync", "cfr",
        "-async", "1",
        "-shortest",
        str(cut_out),
    ]

    print(f"[cut] rendering {cut_out.name}...")
    subprocess.run(cmd, check=True)

    # 4. Remap transcript words onto cut timeline + save transcript.json
    cut_words = remap_words_to_cut(raw_transcript["words"], snapped_keeps)
    cut_text = " ".join(w["word"].strip() for w in cut_words)
    cut_duration = media_duration(cut_out)
    transcript_path.write_text(json.dumps({
        "duration_cut": round(cut_duration, 3),
        "duration_raw": round(duration, 3),
        "text": cut_text,
        "words": cut_words,
    }, indent=2))

    log_out.write_text(json.dumps({
        "raw": raw.name,
        "duration_raw": round(duration, 3),
        "duration_cut": round(cut_duration, 3),
        "dropped": round(dropped, 3),
        "keeps_raw": [[round(k.start, 3), round(k.end, 3)] for k in snapped_keeps],
        "silences": len(silences),
        "fillers": len(fillers),
        "enhance": enhance,
        "cleanup_drops": cleanup_drops,
        "repetition_drops": repetition_drops,
        "ffmpeg": cmd,
    }, indent=2))

    print(f"[cut] ✅ {cut_out.name} ({cut_duration:.2f}s) + transcript.json ({len(cut_words)} words)")
    print(f"[cut] next: design broll-plan.json referencing cut-timeline timestamps, then `render`.")


# ----------------------------------------------------------------------
# `caption` subcommand
# ----------------------------------------------------------------------


def _mute_windows_from_plan(folder: Path) -> list[tuple[float, float]]:
    """Per-item `"captions": false` → mute karaoke during that overlay window.
    Lets a tall stack card or the CTA suppress word-sync without silencing
    captions across the whole reel."""
    plan_path = folder / "broll-plan.json"
    if not plan_path.exists():
        return []
    plan = json.loads(plan_path.read_text())
    windows: list[tuple[float, float]] = []
    for item in plan.get("items", []):
        if item.get("captions") is False:
            windows.append((float(item["start"]), float(item["end"])))
    return windows


def write_captions(folder: Path, *, uppercase: bool = True) -> Path | None:
    transcript_path = folder / "transcript.json"
    if not transcript_path.exists():
        return None
    mutes = _mute_windows_from_plan(folder)
    # Match the YCbCr Matrix in the ASS to the base video's color space —
    # iPhone HDR HLG needs TV.2020 so libass renders gold #f8d380 in BT.2020
    # primaries instead of BT.709 (which gamut-maps to orange on HDR display).
    cut_path = folder / "reel-cut.mp4"
    hdr = cut_path.exists() and is_hdr(cut_path)
    ass = build_ass_from_path(transcript_path, uppercase=uppercase, mute_windows=mutes, hdr=hdr)
    if not ass:
        return None
    ass_path = folder / "captions.ass"
    ass_path.write_text(ass)
    return ass_path


def cmd_caption(args) -> None:
    folder = args.folder.resolve()
    if not folder.is_dir():
        raise SystemExit(f"Not a folder: {folder}")
    transcript_path = folder / "transcript.json"
    if not transcript_path.exists():
        raise SystemExit(f"No transcript.json in {folder}. Run `cut` first.")
    ass_path = write_captions(folder, uppercase=not args.no_uppercase)
    if ass_path is None:
        raise SystemExit("Transcript had no words — nothing to caption.")
    word_count = len(json.loads(transcript_path.read_text()).get("words", []))
    print(f"[caption] ✅ {ass_path.name} ({word_count} words, uppercase={not args.no_uppercase})")


# ----------------------------------------------------------------------
# `render` subcommand
# ----------------------------------------------------------------------


def _render_captions_to_alpha(ass_path: Path, out_path: Path, duration: float, folder: Path) -> None:
    """Pre-render an ASS captions file onto a transparent canvas → ProRes 4444
    alpha .mov. The result is composited like any other alpha overlay so the
    same BT.709 → BT.2020 HLG zscale conversion applies, keeping caption gold
    perceptually identical to the card gold under HDR display.

    Color fidelity matters: ASS gold is sRGB #f8d380 = RGB(248, 211, 128).
    Going through `yuva420p` (TV-range YCbCr 4:2:0) clips/compresses to ~RGB
    (228, 197, 126) — visibly less saturated than the card gold. We stay in
    full-range RGBA throughout the libass burn and ONLY convert to yuva444p10le
    at the ProRes encode step. That preserves the exact sRGB hex.

    Pipeline:
      lavfi color (opaque black) → format rgba → colorchannelmixer aa=0
      (transparent canvas) → subtitles burn (alpha=1, sRGB pixels for text)
      → format yuva444p10le → ProRes 4444 (full chroma resolution).

    Runs ffmpeg with cwd=folder so `subtitles=` sees a bare filename.
    """
    fonts_dir = Path(__file__).resolve().parent / "fonts"
    fonts_arg = f":fontsdir={fonts_dir}" if fonts_dir.is_dir() else ""
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "lavfi",
        "-i", f"color=c=black:s=1080x1920:r=30:d={duration:.3f}",
        "-vf",
        f"format=rgba,colorchannelmixer=aa=0.0,"
        f"subtitles={ass_path.name}{fonts_arg}:alpha=1,"
        f"format=yuva444p10le",
        "-c:v", "prores_ks",
        "-profile:v", "4444",
        "-pix_fmt", "yuva444p10le",
        "-qscale:v", "11",
        "-an",
        out_path.name,
    ]
    subprocess.run(cmd, check=True, cwd=folder)


def cmd_render(args) -> None:
    folder = args.folder.resolve()
    if not folder.is_dir():
        raise SystemExit(f"Not a folder: {folder}")

    cut_path = folder / "reel-cut.mp4"
    plan_path = folder / "broll-plan.json"
    out_path = folder / "reel.mp4"
    log_out = folder / "render.log"

    if not cut_path.exists():
        raise SystemExit(f"No reel-cut.mp4 in {folder}. Run `cut` first.")
    if not plan_path.exists():
        raise SystemExit(f"No broll-plan.json in {folder}. Agent must design one before render.")

    plan = json.loads(plan_path.read_text())
    items = plan.get("items", [])
    cut_duration = media_duration(cut_path)

    ass_path = folder / "captions.ass"
    # Captions opt-out: CLI flag OR broll-plan.json `"captions": false` (set this when the
    # raw recording already has captions baked in — e.g. Tella/Riverside live captions).
    plan_captions = plan.get("captions", True)
    burn_captions = (not args.no_captions) and plan_captions
    if burn_captions and not ass_path.exists():
        generated = write_captions(folder)
        if generated is not None:
            print(f"[render] auto-built {generated.name}")
    burn_captions = burn_captions and ass_path.exists()
    hdr_check = is_hdr(cut_path)

    # On HDR base, render captions to a TRANSPARENT alpha .mov first so they
    # composite via the same zscale BT.709→BT.2020 HLG path as the cards.
    # Burning libass directly into the HLG-tagged base causes sRGB gold to
    # gamut-map orange — pre-rendering to alpha gets us the same color
    # treatment as overlay cards. (On SDR base, inline subtitles= is fine.)
    captions_overlay: Path | None = None
    if burn_captions and hdr_check:
        captions_overlay = folder / "captions.mov"
        if (
            not captions_overlay.exists()
            or captions_overlay.stat().st_mtime < ass_path.stat().st_mtime
        ):
            print("[render] HDR base: pre-rendering captions to transparent overlay")
            _render_captions_to_alpha(ass_path, captions_overlay, cut_duration, folder)

    print(f"[render] folder:   {folder.name}")
    print(f"[render] cut:      {cut_path.name} ({cut_duration:.2f}s)")
    print(f"[render] plan:     {len(items)} overlays")
    print(f"[render] captions: "
          f"{'captions.mov (HDR alpha overlay)' if captions_overlay else ('captions.ass (inline)' if burn_captions else 'none')}")

    # Validate + print
    overlays: list[tuple[Path, float, float]] = []

    # If we pre-rendered captions to alpha, prepend it as the FIRST overlay
    # covering the full duration. It composites via the same zscale path as
    # cards so gold stays gold under HDR.
    if captions_overlay and captions_overlay.exists():
        overlays.append((captions_overlay, 0.0, cut_duration))
        print(f"[render]   {0.0:6.2f}s - {cut_duration:6.2f}s  {captions_overlay.name}  (captions alpha overlay)")

    for i, item in enumerate(items):
        asset = folder / item["asset"]
        s = float(item["start"])
        e = float(item["end"])
        if not asset.exists():
            raise SystemExit(f"Missing asset: {asset}")
        if e <= s:
            raise SystemExit(f"Item {i}: end ({e}) must be > start ({s})")
        if e > cut_duration + 0.1:
            print(f"[render] WARN item {i}: end {e:.2f}s exceeds cut duration {cut_duration:.2f}s — clamping")
            e = cut_duration
        overlays.append((asset, s, e))
        print(f"[render]   {s:6.2f}s - {e:6.2f}s  {asset.name}")

    # Dedupe PNG inputs; each video overlay gets its own input (setpts shifts per-instance).
    VIDEO_EXTS = {".webm", ".mov", ".mp4"}
    input_pngs: list[Path] = []
    png_to_idx: dict[Path, int] = {}
    video_inputs: list[Path] = []           # one per overlay instance
    overlay_refs: list[dict] = []           # per overlay: {is_video, in_idx, start, end}

    for (asset, start, end) in overlays:
        is_video = asset.suffix.lower() in VIDEO_EXTS
        if is_video:
            video_inputs.append(asset)
            overlay_refs.append({"is_video": True, "slot": len(video_inputs) - 1, "start": start, "end": end})
        else:
            if asset not in png_to_idx:
                png_to_idx[asset] = len(input_pngs)
                input_pngs.append(asset)
            overlay_refs.append({"is_video": False, "slot": png_to_idx[asset], "start": start, "end": end})

    canvas_w, canvas_h = probe_dimensions(cut_path)
    hdr = is_hdr(cut_path)
    if hdr:
        print("[render] HDR base detected (BT.2020/HLG). Converting overlays + captions to HDR-aware colors so brand gold stays gold.")

    # zscale conversion BT.709 sRGB → BT.2020 HLG. Applied to SDR overlays
    # before composite onto the HDR base, so gold #f8d380 displays as brand
    # gold on HDR-aware players (otherwise it gamut-maps toward orange).
    # Option names: `p/t/m` are output, `pin/tin/min` are input (zscale's
    # short forms — full forms are `primaries/transfer/matrix` and
    # `primariesin/transferin/matrixin`).
    HDR_OV_CONV = (
        "zscale=p=2020:t=arib-std-b67:m=2020_ncl"
        ":pin=709:tin=709:min=709"
    )

    filter_parts: list[str] = []

    # Captions burn in first (on bare video), B-roll overlays layer on top.
    # We chdir into folder before running ffmpeg so the subtitles path is a
    # bare filename — avoids filter-graph colon-escaping on absolute paths.
    base_label = "0:v"
    # Only do the inline subtitles burn on SDR base. On HDR, captions were
    # pre-rendered to a transparent .mov already in the overlays list, so the
    # zscale color-conversion path applies to them too.
    if burn_captions and not captions_overlay:
        fonts_dir = Path(__file__).resolve().parent / "fonts"
        if fonts_dir.is_dir():
            filter_parts.append(
                f"[0:v]subtitles=captions.ass:fontsdir={fonts_dir}[vcap]"
            )
        else:
            filter_parts.append("[0:v]subtitles=captions.ass[vcap]")
        base_label = "vcap"

    # ffmpeg input indices: [0]=cut, [1..N_png]=PNGs, [N_png+1..]=videos
    n_png = len(input_pngs)
    for slot, _ in enumerate(input_pngs):
        ff_idx = 1 + slot
        ov_conv = (HDR_OV_CONV + ",") if hdr else ""
        filter_parts.append(
            f"[{ff_idx}:v]scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=decrease,"
            f"pad={canvas_w}:{canvas_h}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,"
            f"{ov_conv}format=yuva420p[png{slot}]"
        )
    for slot, vid_path in enumerate(video_inputs):
        ff_idx = 1 + n_png + slot
        ref = next(r for r in overlay_refs if r["is_video"] and r["slot"] == slot)
        # Three video flavours:
        #   - captions.mov alpha overlay: yuva444p10le pure RGB(255,255,255)
        #     text. SKIP zscale on HDR — bake raw white directly so the
        #     HLG-tagged stream displays it as HLG peak white. Otherwise
        #     BT.709→BT.2020 maps RGB(255) to ~75% HLG range and reads grey.
        #   - .mov alpha overlay (cards): yuva420p, partial-frame, composites
        #     onto the talking head. HDR? convert to BT.2020 HLG.
        #   - .mp4 opaque cut (website_capture): yuv420p, full-frame, scales
        #     to canvas to REPLACE the base during the window. HDR? same conv.
        is_opaque_cut = vid_path.suffix.lower() == ".mp4"
        is_captions = captions_overlay is not None and vid_path == captions_overlay
        ov_conv = (HDR_OV_CONV + ",") if (hdr and not is_captions) else ""
        if is_opaque_cut:
            # website_capture mp4s are already authored at 1080x1920. Use a
            # safety scale+crop in case a different opaque source slips in.
            # `force_original_aspect_ratio` only accepts: disable / decrease /
            # increase. `increase` + crop = cover-fit.
            filter_parts.append(
                f"[{ff_idx}:v]scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase,"
                f"crop={canvas_w}:{canvas_h},"
                f"{ov_conv}format=yuv420p,"
                f"setpts=PTS-STARTPTS+{ref['start']:.3f}/TB[vid{slot}]"
            )
        else:
            filter_parts.append(
                f"[{ff_idx}:v]{ov_conv}format=yuva420p,"
                f"setpts=PTS-STARTPTS+{ref['start']:.3f}/TB[vid{slot}]"
            )

    chain_label = base_label
    for i, ref in enumerate(overlay_refs):
        src = f"{'vid' if ref['is_video'] else 'png'}{ref['slot']}"
        next_label = f"ov{i}"
        filter_parts.append(
            f"[{chain_label}][{src}]overlay=0:0:enable='between(t,{ref['start']:.3f},{ref['end']:.3f})'[{next_label}]"
        )
        chain_label = next_label

    if not filter_parts:
        print("[render] no overlays, no captions — copying cut to reel.mp4")
        subprocess.run(["cp", str(cut_path), str(out_path)], check=True)
        return

    filter_complex = ";".join(filter_parts)

    # Paths are relative to folder (cwd) so the subtitles= filter sees a bare filename.
    def rel(p: Path) -> str:
        try:
            return str(p.relative_to(folder))
        except ValueError:
            return str(p)

    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", rel(cut_path)]
    for png in input_pngs:
        cmd += ["-i", rel(png)]
    for vid in video_inputs:
        cmd += ["-i", rel(vid)]
    final_map = f"[{chain_label}]" if filter_parts else "0:v"
    cmd += [
        "-filter_complex", filter_complex,
        "-map", final_map,
        "-map", "0:a",
        *encoder_args(),
        "-c:a", "aac", "-b:a", "160k",
        "-ar", "44100",
        "-movflags", "+faststart",
        "-fps_mode", "cfr",
        "-vsync", "cfr",
        "-async", "1",
        "-shortest",
        rel(out_path),
    ]

    print(f"[render] rendering {out_path.name}...")
    subprocess.run(cmd, check=True, cwd=folder)

    log_out.write_text(json.dumps({
        "cut": cut_path.name,
        "plan": str(plan_path.name),
        "captions": ass_path.name if burn_captions else None,
        "overlays": [
            {"asset": str(png.relative_to(folder)), "start": s, "end": e}
            for (png, s, e) in overlays
        ],
        "ffmpeg": cmd,
    }, indent=2))

    print(f"[render] ✅ {out_path}")


# ----------------------------------------------------------------------
# `verify` subcommand — frame-level visual QA gate
# ----------------------------------------------------------------------


def extract_frame(video: Path, t: float, out: Path) -> None:
    """Extract a single PNG frame at `t` seconds. `-ss` AFTER `-i` is frame-accurate
    (input seek is keyframe-only on h264 and skips past 0.36s entrance animations)."""
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(video),
        "-ss", f"{t:.3f}",
        "-frames:v", "1",
        "-q:v", "2",
        str(out),
    ]
    subprocess.run(cmd, check=True)


def cmd_verify(args) -> None:
    folder = args.folder.resolve()
    if not folder.is_dir():
        raise SystemExit(f"Not a folder: {folder}")

    reel_path = folder / "reel.mp4"
    plan_path = folder / "broll-plan.json"
    if not reel_path.exists():
        raise SystemExit(f"No reel.mp4 in {folder}. Run `render` first.")
    if not plan_path.exists():
        raise SystemExit(f"No broll-plan.json in {folder}.")

    plan = json.loads(plan_path.read_text())
    items = plan.get("items", [])
    duration = media_duration(reel_path)

    verify_dir = folder / "verify"
    verify_dir.mkdir(exist_ok=True)
    for old in verify_dir.glob("*.png"):
        old.unlink()

    samples: list[dict] = []

    # Per-overlay: sample inside the hold, not at the edges (entrance/exit animations
    # would show mid-fade). 0.3s into the clip, 0.2s before end.
    for i, item in enumerate(items):
        s = float(item["start"])
        e = float(item["end"])
        asset_stem = Path(item["asset"]).stem
        line = item.get("line", "")

        t_enter = min(s + 0.3, e - 0.05)
        t_exit = max(e - 0.2, s + 0.05)

        for label, t in (("enter", t_enter), ("exit", t_exit)):
            fname = f"{i:02d}-{asset_stem}-{label}.png"
            out = verify_dir / fname
            extract_frame(reel_path, t, out)
            samples.append({
                "idx": i,
                "kind": "overlay",
                "phase": label,
                "asset": item["asset"],
                "line": line,
                "t": round(t, 3),
                "file": fname,
                "checks": [
                    "face visible and not occluded by card",
                    "card fully on-screen, inside safe-zone",
                    "karaoke caption does not collide with card or face",
                    "no duplicate/stacked captions (Tella/Riverside leak)",
                ],
            })

    # Baselines: 3 talking-head frames in the largest overlay-free gaps, for
    # face-crop and caption position sanity.
    occupied = [(float(it["start"]), float(it["end"])) for it in items]
    occupied.sort()
    gaps: list[tuple[float, float]] = []
    cursor = 0.0
    for s, e in occupied:
        if s > cursor:
            gaps.append((cursor, s))
        cursor = max(cursor, e)
    if cursor < duration:
        gaps.append((cursor, duration))

    gaps.sort(key=lambda g: g[1] - g[0], reverse=True)
    for j, (gs, ge) in enumerate(gaps[:3]):
        t = (gs + ge) / 2
        fname = f"baseline-{j:02d}-{t:.2f}s.png"
        out = verify_dir / fname
        extract_frame(reel_path, t, out)
        samples.append({
            "idx": None,
            "kind": "baseline",
            "phase": "talking-head",
            "asset": None,
            "line": "",
            "t": round(t, 3),
            "file": fname,
            "checks": [
                "face framed inside the safe-zone",
                "karaoke caption rendered, centered, no overflow",
                "no stray overlay from a mistimed plan item",
            ],
        })

    (verify_dir / "checklist.json").write_text(json.dumps({
        "reel": reel_path.name,
        "duration": round(duration, 3),
        "samples": samples,
    }, indent=2))

    lines = [
        f"# Verification — {folder.name}",
        "",
        f"Reel: `{reel_path.name}` ({duration:.2f}s) — {len(items)} overlays, {len(samples)} sample frames.",
        "",
        "For each frame below, open it and check every box. Fail loud on any miss.",
        "",
    ]
    for s in samples:
        header = (
            f"## `{s['file']}` — {s['kind']} @ {s['t']}s"
            if s["kind"] == "baseline"
            else f"## `{s['file']}` — overlay {s['idx']} {s['phase']} @ {s['t']}s"
        )
        lines.append(header)
        if s["asset"]:
            lines.append(f"Asset: `{s['asset']}`")
        if s["line"]:
            lines.append(f"Line: _{s['line']}_")
        lines.append("")
        for c in s["checks"]:
            lines.append(f"- [ ] {c}")
        lines.append("")
    (verify_dir / "checklist.md").write_text("\n".join(lines))

    print(f"[verify] ✅ {len(samples)} frames → {verify_dir.relative_to(folder.parent)}")
    print(f"[verify] open {verify_dir / 'checklist.md'} and walk each frame.")


# ----------------------------------------------------------------------
# `pipeline` subcommand — one-shot raw.mp4 → reel.mp4
# ----------------------------------------------------------------------


def cmd_pipeline(args) -> None:
    """One-shot: cut → caption → render. No agent step, no broll overlays — captions only.

    Layout: a sibling folder `<raw_stem>-reel/` is created next to the raw file (or
    `--folder` overrides). The raw mp4 is copied in (so cut/render see a normal folder
    layout). A stub broll-plan.json with no overlays is written so cmd_render is happy.
    """
    import shutil
    from argparse import Namespace

    raw = args.raw.resolve()
    if not raw.exists() or not raw.is_file():
        raise SystemExit(f"Not a file: {raw}")
    if raw.suffix.lower() not in {".mp4", ".mov", ".m4v"}:
        raise SystemExit(f"Unsupported video format: {raw.suffix}")

    folder = (args.folder or raw.parent / f"{raw.stem}-reel").resolve()
    folder.mkdir(parents=True, exist_ok=True)

    # Stage the raw file into the folder. Use a copy so cmd_cut's auto-extract pass
    # never has to follow a symlink across volumes (e.g. iCloud Drive offload).
    staged = folder / raw.name
    if not staged.exists() or staged.stat().st_mtime < raw.stat().st_mtime:
        print(f"[pipeline] staging raw: {raw.name} → {folder.name}/")
        shutil.copy2(raw, staged)

    print(f"[pipeline] ▶ cut")
    cmd_cut(Namespace(
        folder=folder,
        refresh=args.refresh,
        no_enhance=args.no_enhance,
        no_clean=args.no_clean,
    ))

    plan_path = folder / "broll-plan.json"
    if not args.no_broll:
        cinematic = not getattr(args, "no_cinematic", False)
        if cinematic:
            print(f"[pipeline] ▶ broll (cinematic — Stage 1+2+3+4)")
        else:
            print(f"[pipeline] ▶ broll (legacy text-cards only)")
        plan_design_render(folder, refresh=args.refresh, cinematic=cinematic)
    else:
        # Captions-only: empty overlay plan so cmd_render is happy.
        if not plan_path.exists():
            plan_path.write_text(json.dumps({"items": [], "captions": True}, indent=2))

    print(f"[pipeline] ▶ caption")
    cmd_caption(Namespace(folder=folder, no_uppercase=False))

    print(f"[pipeline] ▶ render")
    cmd_render(Namespace(folder=folder, no_captions=False))

    out = folder / "reel.mp4"
    if not out.exists():
        raise SystemExit("[pipeline] render produced no reel.mp4")

    if not getattr(args, "no_thumbnail", False):
        print(f"[pipeline] ▶ thumbnail")
        try:
            generate_thumbnail(folder, refresh=args.refresh)
        except Exception as e:
            print(f"[pipeline]   thumbnail failed (non-fatal): {e}")

    size_mb = out.stat().st_size / 1e6
    print(f"\n[pipeline] ✅ {out} ({size_mb:.1f} MB)")


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Reel editor — two-phase (cut then render).",
    )
    sub = ap.add_subparsers(dest="command", required=True)

    cut_p = sub.add_parser("cut", help="Transcribe + silence/filler trim + audio/color enhance → reel-cut.mp4")
    cut_p.add_argument("folder", type=Path)
    cut_p.add_argument("--refresh", action="store_true", help="Force re-transcribe")
    cut_p.add_argument("--no-enhance", action="store_true", help="Skip audio enhance + color grade")
    cut_p.add_argument("--no-clean", action="store_true", help="Skip Claude transcript cleanup pass")
    cut_p.set_defaults(func=cmd_cut)

    cap_p = sub.add_parser("caption", help="Build word-synced karaoke captions.ass from transcript.json")
    cap_p.add_argument("folder", type=Path)
    cap_p.add_argument("--no-uppercase", action="store_true", help="Keep original word casing")
    cap_p.set_defaults(func=cmd_caption)

    render_p = sub.add_parser("render", help="Burn captions + composite broll-plan.json overlays → reel.mp4")
    render_p.add_argument("folder", type=Path)
    render_p.add_argument("--no-captions", action="store_true", help="Skip burning captions.ass")
    render_p.set_defaults(func=cmd_render)

    verify_p = sub.add_parser("verify", help="Sample QA frames from reel.mp4 for visual inspection")
    verify_p.add_argument("folder", type=Path)
    verify_p.set_defaults(func=cmd_verify)

    pipe_p = sub.add_parser(
        "pipeline",
        help="One-shot: raw.mp4 → reel.mp4 (cut + audio enhance + color grade + Claude cleanup + captions, no broll overlays)",
    )
    pipe_p.add_argument("raw", type=Path, help="Path to a raw mp4/mov recording")
    pipe_p.add_argument("--folder", type=Path, default=None, help="Working folder (default: <raw>-reel/ next to the raw file)")
    pipe_p.add_argument("--refresh", action="store_true", help="Force re-transcribe + re-call Claude cleanup")
    pipe_p.add_argument("--no-enhance", action="store_true", help="Skip audio enhance + color grade")
    pipe_p.add_argument("--no-clean", action="store_true", help="Skip Claude transcript cleanup pass")
    pipe_p.add_argument("--no-broll", action="store_true", help="Skip auto-generated B-roll cards (captions only)")
    pipe_p.add_argument("--no-cinematic", action="store_true",
                        help="Use legacy text-only B-roll templates (skip HyperFrames cinematic motion graphics)")
    pipe_p.add_argument("--no-thumbnail", action="store_true",
                        help="Skip the brand-aligned thumbnail.png generation step")
    pipe_p.set_defaults(func=cmd_pipeline)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
