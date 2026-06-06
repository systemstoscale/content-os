"""ContentOS reel render — the cinematic pipeline, in-container.

Ports the proven Modal `process_reel` (skalers/backend/modal/editor_render_app.py)
to a synchronous in-container call. Three format paths:
  - talking_head : cut -> cinematic b-roll (reel_templates) -> karaoke captions
                   -> composite -> thumbnail   (reel_editor.cmd_pipeline)
  - raw          : transcribe-only + faststart remux (nothing burned)
  - broll        : AI headline overlay + mood music (broll_format)

The vendored pipeline at /app/content reads the buyer's brand via the
CONTENTOS_BRAND_PROFILE env var (brand_profile.py). Because that resolver is
cached, we set it + bust the cache per request (the container is single-tenant,
so there's no cross-request race).

Outputs (reel.mp4 + thumbnail.png + transcript.json + cover frame) are uploaded
straight to R2 via the S3 API; we return KEYS and the Worker builds public URLs.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

import httpx

# The vendored content/ tree (reel_editor, brand_profile, ...) lives here.
CONTENT_DIR = "/app/content"
if CONTENT_DIR not in sys.path:
    sys.path.insert(0, CONTENT_DIR)


# ── R2 (S3 API) ────────────────────────────────────────────

def _r2_client():
    import boto3

    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["CLOUDFLARE_R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["CLOUDFLARE_R2_SECRET_ACCESS_KEY"],
    )


def _r2_bucket() -> str:
    return os.environ.get("CLOUDFLARE_R2_BUCKET_NAME", "content-os-assets")


def _r2_put(local_path: Path, key: str, content_type: str) -> str:
    _r2_client().upload_file(str(local_path), _r2_bucket(), key, ExtraArgs={"ContentType": content_type})
    return key


def _download(url: str, dest: Path) -> None:
    with httpx.stream("GET", url, follow_redirects=True, timeout=300.0) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(1024 * 1024):
                f.write(chunk)


# ── Per-request brand profile ──────────────────────────────

def _apply_brand_profile(brand_profile: Optional[dict]) -> None:
    """Make the vendored pipeline render in the buyer's brand. Sets the env var
    the resolver reads and busts its lru_cache (single-tenant container)."""
    if brand_profile:
        os.environ["CONTENTOS_BRAND_PROFILE"] = json.dumps(brand_profile)
    else:
        os.environ.pop("CONTENTOS_BRAND_PROFILE", None)
    try:
        import brand_profile as bp
        bp._profile.cache_clear()
    except Exception:
        pass


# ── Framework-aware caption payload (ported from the Modal renderer) ──

def _build_caption_payload(transcript_text: str) -> dict:
    """Identify the framework in the transcript and emit a tight per-platform
    caption block. Voice + CTA + hashtags come from the active brand profile."""
    import brand_profile as bp

    fallback = {
        "headline": "",
        "body": "",
        "hashtags": bp.hashtags(),
        "cta": bp.cta(),
        "gold_phrase": "",
    }
    if not transcript_text or not os.environ.get("ANTHROPIC_API_KEY"):
        return fallback

    voice = bp.voice_prompt()
    bans = "; ".join(bp.vocab_bans())
    sys_prompt = (
        f"You write short-form social captions. Brand voice: {voice}\n\n"
        "STEP 1 (private): identify the explicit framework in the transcript "
        "(a numbered list, a step-by-step, an X-way enumeration, a quantity "
        "claim). Side anecdotes / social proof / names are filler, not the "
        "framework.\n\n"
        "STEP 2: write STRICT JSON: {"
        '"headline": str (<= 40 chars, names the framework punchily, no leading '
        'article), '
        '"body": str (<= 280 chars, 2-5 SHORT lines, enumerate EACH framework '
        'item in order, one line each. NO anecdotes/names/social proof.), '
        '"hashtags": str (5-7 lowercase tags joined by spaces), '
        '"cta": str (the locked CTA verbatim), '
        '"gold_phrase": str (1-3 word substring of the headline, usually the '
        'number/tier)}\n\n'
        f"Rules: NO emojis. {bans}. The body tells a scroller exactly what they "
        "get if they tap Read More."
    )
    try:
        import anthropic
        cli = anthropic.Anthropic()
        resp = cli.messages.create(
            model=os.environ.get("REEL_CAPTION_MODEL", "claude-sonnet-4-6"),
            max_tokens=800,
            system=sys_prompt,
            messages=[{"role": "user", "content": transcript_text[:6000]}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        import re as _re
        m = _re.search(r"\{.*\}", text, _re.DOTALL)
        if not m:
            return fallback
        out = json.loads(m.group(0))
        for k, v in fallback.items():
            out.setdefault(k, v)
        return out
    except Exception as e:
        print(f"[render] caption build failed: {e}", file=sys.stderr)
        return fallback


# ── Main render ────────────────────────────────────────────

def run_render(
    *,
    project_id: str,
    video_url: str,
    fmt: str = "talking_head",
    topic: str = "",
    key_points: str = "",
    brand_profile: Optional[dict] = None,
) -> dict:
    """Download -> render (by format) -> upload artifacts to R2. Returns keys +
    the caption payload + duration. Raises on hard failure."""
    _apply_brand_profile(brand_profile)
    sys.path.insert(0, CONTENT_DIR)

    work_root = Path(tempfile.mkdtemp(prefix=f"reel-{project_id}-"))
    folder = work_root / f"{project_id}-reel"
    folder.mkdir(parents=True, exist_ok=True)
    raw_path = folder / f"{project_id}.mov"

    try:
        _download(video_url, raw_path)

        caption_payload: dict = {}

        if fmt == "broll":
            import broll_format
            payload = broll_format.generate_headline_and_body(topic, key_points)
            caption_payload = payload
            headline = payload.get("headline", topic) or topic or "Read captions"
            mood = payload.get("mood", "driven")
            gold = payload.get("gold_phrase", "") or ""
            music_url = (os.environ.get("REEL_BROLL_MUSIC_URL") or "").strip()
            broll_format.render_broll(raw_path, headline, work_dir=folder, music_url=music_url, mood=mood)
            broll_format.render_broll_thumbnail(raw_path, headline, gold, work_dir=folder)

        elif fmt == "raw":
            import reel_editor
            transcript_text = ""
            try:
                audio_path = folder / "_audio.ogg"
                reel_editor.extract_audio(raw_path, audio_path)
                tj = reel_editor.transcribe(audio_path)
                (folder / "transcript.json").write_text(json.dumps(tj))
                transcript_text = tj.get("text") or " ".join(w.get("word", "") for w in tj.get("words", []))
                audio_path.unlink(missing_ok=True)
            except Exception as e:
                print(f"[render] raw transcribe failed (caption falls back): {e}", file=sys.stderr)
            caption_payload = _build_caption_payload(transcript_text)
            final_mp4 = folder / "reel.mp4"
            cp = subprocess.run(
                ["ffmpeg", "-y", "-i", str(raw_path), "-c", "copy", "-movflags", "+faststart", str(final_mp4)],
                capture_output=True, text=True,
            )
            if cp.returncode != 0 or not final_mp4.exists():
                subprocess.run(
                    ["ffmpeg", "-y", "-i", str(raw_path), "-c:v", "libx264", "-preset", "veryfast",
                     "-crf", "18", "-c:a", "aac", "-movflags", "+faststart", str(final_mp4)],
                    check=True,
                )

        else:  # talking_head
            import reel_editor
            from argparse import Namespace
            try:
                import brand_profile as bp
                cinematic = bool(bp.motion_style().get("enabled", True))
            except Exception:
                cinematic = True
            reel_editor.cmd_pipeline(Namespace(
                raw=raw_path, folder=folder, refresh=False,
                no_enhance=False, no_clean=False,
                no_broll=not cinematic, no_cinematic=not cinematic,
                no_thumbnail=True,
            ))
            transcript_path = folder / "transcript.json"
            transcript_text = ""
            if transcript_path.exists():
                try:
                    tj = json.loads(transcript_path.read_text())
                    transcript_text = tj.get("text") or " ".join(w.get("word", "") for w in tj.get("words", []))
                except Exception:
                    pass
            caption_payload = _build_caption_payload(transcript_text)
            if not caption_payload.get("headline") and transcript_text:
                opener = transcript_text.strip().split(".")[0].strip()
                if opener:
                    caption_payload["headline"] = opener[:90]
            try:
                from thumbnail_builder import generate_thumbnail
                generate_thumbnail(folder, caption_payload=caption_payload or None)
            except Exception as e:
                print(f"[render] thumbnail build failed (non-fatal): {e}", file=sys.stderr)

        final_mp4 = folder / "reel.mp4"
        if not final_mp4.exists():
            raise RuntimeError("pipeline finished but reel.mp4 was not produced")

        # Upload artifacts to R2.
        out: dict = {"caption_payload": caption_payload}
        out["reel_key"] = _r2_put(final_mp4, f"reels/{project_id}/reel.mp4", "video/mp4")
        try:
            out["duration_seconds"] = _probe_duration(final_mp4)
        except Exception:
            pass
        thumb = folder / "thumbnail.png"
        if thumb.exists():
            out["thumbnail_key"] = _r2_put(thumb, f"reels/{project_id}/thumbnail.png", "image/png")
        tj = folder / "transcript.json"
        if tj.exists():
            out["transcript_key"] = _r2_put(tj, f"reels/{project_id}/transcript.json", "application/json")
        frame = folder / "thumbnail-frame.png"
        if frame.exists():
            out["cover_frame_key"] = _r2_put(frame, f"reels/{project_id}/cover.png", "image/png")
        return out
    finally:
        import shutil
        shutil.rmtree(work_root, ignore_errors=True)


def _probe_duration(media: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(media)],
        capture_output=True, text=True, check=True,
    )
    return round(float(r.stdout.strip()), 3)


# ── /brand wizard live previews ────────────────────────────
#
# Each renders a small sample using a CANNED input + the buyer's brand_profile,
# so "what you preview is what you get". Uploaded to R2 under previews/<kind>/.

def _solid_frame(out_png: Path, color: str = "#141414") -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", f"color=c={color}:s=1080x1920", "-frames:v", "1", str(out_png)],
        check=True,
    )


def _screenshot_html(html: str, out_png: Path) -> None:
    """Single full-frame screenshot of a card HTML over a dark backdrop, with
    every animation snapped to its end state (so the preview shows the rest pose)."""
    import asyncio
    from playwright.async_api import async_playwright

    html = html.replace("background:transparent", "background:#141414")
    tmp = out_png.with_suffix(".html")
    tmp.write_text(html, encoding="utf-8")

    async def _go():
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            ctx = await browser.new_context(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
            page = await ctx.new_page()
            await page.goto(f"file://{tmp.resolve()}")
            await page.wait_for_load_state("networkidle")
            await page.evaluate("document.fonts.ready")
            await page.evaluate(
                "() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 1e9; } "
                "const t = window.__timelines && window.__timelines.main; if (t && t.progress) t.progress(1); }"
            )
            await page.wait_for_timeout(150)
            await page.screenshot(path=str(out_png), clip={"x": 0, "y": 0, "width": 1080, "height": 1920})
            await browser.close()

    asyncio.run(_go())


def run_preview(kind: str, brand_profile: Optional[dict]) -> dict:
    """Render a sample for the /brand wizard. kind in {caption,card,thumbnail}.
    Returns {key} of the uploaded preview (png/mp4)."""
    _apply_brand_profile(brand_profile)
    sys.path.insert(0, CONTENT_DIR)
    work = Path(tempfile.mkdtemp(prefix="preview-"))
    token = os.urandom(4).hex()
    try:
        if kind == "caption":
            import brand_profile as bp
            from caption_builder import build_ass
            words = ["THREE", "SYSTEMS", "TO", "SCALE", "YOUR", "BRAND"]
            step = 3.0 / len(words)
            transcript = {"words": [
                {"word": w, "start": round(i * step, 2), "end": round((i + 1) * step, 2)}
                for i, w in enumerate(words)
            ]}
            ass = build_ass(transcript)
            (work / "captions.ass").write_text(ass)
            out = work / "preview.mp4"
            fonts = "/app/content/fonts"
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
                 "-i", "color=c=#141414:s=1080x1920:r=30:d=3",
                 "-vf", f"subtitles=captions.ass:fontsdir={fonts}", "-pix_fmt", "yuv420p",
                 str(out)],
                cwd=str(work), check=True,
            )
            key = f"previews/caption/{token}.mp4"
            _r2_put(out, key, "video/mp4")
            return {"key": key, "content_type": "video/mp4"}

        if kind == "card":
            import reel_templates
            html = reel_templates.render_template_html(
                "statement", {"text": "YOUR BRAND, YOUR STYLE"}, 3.0
            )
            out = work / "card.png"
            _screenshot_html(html, out)
            key = f"previews/card/{token}.png"
            _r2_put(out, key, "image/png")
            return {"key": key, "content_type": "image/png"}

        # thumbnail (overlay mode)
        import base64
        from thumbnail_builder import _thumbnail_html, _render_thumbnail
        import asyncio
        frame = work / "frame.png"
        _solid_frame(frame)
        data_url = "data:image/png;base64," + base64.b64encode(frame.read_bytes()).decode("ascii")
        html = _thumbnail_html(data_url, "YOUR HEADLINE\nIN GOLD", "GOLD")
        html_path = work / "thumb.html"
        html_path.write_text(html, encoding="utf-8")
        out = work / "thumb.png"
        asyncio.run(_render_thumbnail(html_path, out))
        key = f"previews/thumbnail/{token}.png"
        _r2_put(out, key, "image/png")
        return {"key": key, "content_type": "image/png"}
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)
