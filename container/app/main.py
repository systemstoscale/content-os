from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from .pipeline import run_reel_pipeline, CaptionStyle, probe_duration
from .transcribe import transcribe
from . import render_reel

app = FastAPI(title="Content OS Processor", version="1.0.0")

# Container is reachable only via the bound Worker's service binding —
# Cloudflare does not route public traffic to it. No bearer-token check needed.

MAX_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(300 * 1024 * 1024)))


def _video_response(result) -> Response:
    # We pack [video_bytes][frame_bytes] into a single body so we can return
    # both artifacts in one round trip. The Worker reads x-video-size to know
    # where the split is. x-frame-size = 0 means no cover frame available.
    video_bytes = result.video_path.read_bytes()
    frame_bytes = result.frame_path.read_bytes() if getattr(result, "frame_path", None) else b""
    return Response(
        content=video_bytes + frame_bytes,
        media_type="application/octet-stream",
        headers={
            "x-transcript-base64": result.transcript_b64,
            "x-duration-seconds": f"{result.output_duration:.3f}",
            "x-input-duration-seconds": f"{result.input_duration:.3f}",
            "x-clip-count": str(result.clip_count),
            "x-video-size": str(len(video_bytes)),
            "x-frame-size": str(len(frame_bytes)),
        },
    )


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"ok": True, "service": "content-os-processor"})


# ── Cinematic reel render (the core ContentOS pipeline) ─────

class RenderReelBody(BaseModel):
    video_url: str
    project_id: str
    format: str = "talking_head"          # talking_head | raw | broll
    topic: str = ""
    key_points: str = ""
    brand_profile: dict | None = None


@app.post("/render-reel")
def render_reel_endpoint(body: RenderReelBody) -> JSONResponse:
    """Download the source clip, run the vendored pipeline in the buyer's brand,
    upload reel.mp4 + thumbnail + transcript to R2, return the keys + caption.
    Synchronous: the Worker calls this from a durable Workflow step (long await)."""
    if not body.video_url or not body.project_id:
        raise HTTPException(400, "video_url and project_id required")
    try:
        out = render_reel.run_render(
            project_id=body.project_id,
            video_url=body.video_url,
            fmt=body.format,
            topic=body.topic,
            key_points=body.key_points,
            brand_profile=body.brand_profile,
        )
    except Exception as e:
        raise HTTPException(500, f"render failed: {type(e).__name__}: {str(e)[:400]}")
    return JSONResponse(out)


# ── /brand wizard live previews ─────────────────────────────

class PreviewBody(BaseModel):
    kind: str                              # caption | card | thumbnail
    brand_profile: dict | None = None


@app.post("/preview")
def preview_endpoint(body: PreviewBody) -> JSONResponse:
    if body.kind not in ("caption", "card", "thumbnail"):
        raise HTTPException(400, "kind must be caption | card | thumbnail")
    try:
        out = render_reel.run_preview(body.kind, body.brand_profile)
    except Exception as e:
        raise HTTPException(500, f"preview failed: {type(e).__name__}: {str(e)[:400]}")
    return JSONResponse(out)


@app.post("/process-reel")
async def process_reel(
    video: UploadFile = File(...),
    caption_style: CaptionStyle = Form("opus"),
    cut_silences: bool = Form(True),
) -> Response:
    raw = await video.read()
    if len(raw) == 0:
        raise HTTPException(400, "empty video")
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, f"max {MAX_BYTES} bytes")

    with tempfile.TemporaryDirectory(prefix="reel-") as workdir_str:
        workdir = Path(workdir_str)
        input_path = workdir / "in.mp4"
        input_path.write_bytes(raw)

        result = run_reel_pipeline(
            workdir=workdir,
            input_path=input_path,
            caption_style=caption_style,
            cut_silences=cut_silences,
        )
        return _video_response(result)


@app.post("/transcribe")
async def transcribe_endpoint(
    video: UploadFile = File(...),
) -> JSONResponse:
    """Transcript-only. Used by the YouTube long-form flow."""
    raw = await video.read()
    if not raw:
        raise HTTPException(400, "empty video")
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, f"max {MAX_BYTES} bytes")

    with tempfile.TemporaryDirectory(prefix="trans-") as workdir_str:
        workdir = Path(workdir_str)
        input_path = workdir / "in.mp4"
        input_path.write_bytes(raw)

        duration = probe_duration(str(input_path))
        transcript = transcribe(str(input_path))
        transcript.duration_seconds = transcript.duration_seconds or duration

    return JSONResponse(transcript.to_dict())

@app.post("/audio-to-wav")
async def audio_to_wav(audio: UploadFile = File(...)) -> Response:
    """Transcode any ffmpeg-decodable audio (MP3, M4A, AAC, etc.) to PCM WAV.

    Used by the avatar reel pipeline: ElevenLabs returns MP3 on free/starter
    tiers, but Higgsfield's /v1/speak/higgsfield endpoint only accepts WAV.
    We round-trip the audio through ffmpeg in this container."""
    raw = await audio.read()
    if not raw:
        raise HTTPException(400, "empty audio")
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, f"max {MAX_BYTES} bytes")

    with tempfile.TemporaryDirectory(prefix="audio-") as workdir_str:
        workdir = Path(workdir_str)
        input_path = workdir / "in.bin"
        output_path = workdir / "out.wav"
        input_path.write_bytes(raw)
        # 16-bit signed little-endian PCM at 44.1 kHz mono — the most
        # broadly-accepted WAV variant for lipsync services.
        cmd = [
            "ffmpeg", "-y", "-i", str(input_path),
            "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1",
            str(output_path),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=60)
        except subprocess.CalledProcessError as e:
            err = e.stderr.decode("utf-8", errors="replace")[:400]
            raise HTTPException(500, f"ffmpeg transcode failed: {err}")
        wav_bytes = output_path.read_bytes()

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"x-output-size": str(len(wav_bytes))},
    )

# /generate-avatar-reel removed — Higgsfield is now consumed via MCP
# (mcp.higgsfield.ai), which is called from the Anthropic API directly. The
# Worker no longer needs the Container to broker Higgsfield requests.
# After the avatar reel mp4 lands in R2, the talking-head reel pipeline
# (/process-reel) handles caption burning + cover frame extraction.
