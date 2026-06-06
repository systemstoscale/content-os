"""Capture a website as a 1080×1920 MP4 B-roll cut.

Used by the `website_capture` cinematic layout: when the speaker mentions a
URL (skalers.io / mdm.ai / etc.), the reel cuts away from the talking head to
this capture for ~3–4s, then returns.

Pipeline (v1 — pragmatic):
  1. Playwright headless Chromium navigates to the URL at a desktop viewport
     (1440×2560 — taller than vertical so we capture a "scrolled" tall image)
  2. Take a full-page screenshot
  3. ffmpeg generates a smooth Ken Burns zoom+pan video over the screenshot,
     with a soft fade-in / fade-out, output 1080×1920 mp4 ready to overlay.

This avoids the Steel.dev cloud-browser dependency for v1; future v2 can
upgrade to real session recording (cursor moves, scrolls, clicks) via the
existing `2-screen-demo` skill if needed.

Output: a self-contained .mp4 (NOT alpha) — `cmd_render` treats this as a
full-frame cut rather than a card overlay.
"""
from __future__ import annotations

import asyncio
import re
import subprocess
from pathlib import Path


CANVAS_W = 1080
CANVAS_H = 1920
CAPTURE_W = 1440
CAPTURE_H = 2560   # tall: gives the Ken Burns pan room to breathe
DEFAULT_DURATION = 4.0
DEFAULT_FPS = 30


def _normalise_url(url: str) -> str:
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def _slug_for_url(url: str) -> str:
    u = re.sub(r"^https?://", "", url.lower())
    return re.sub(r"[^a-z0-9]+", "-", u).strip("-")[:48] or "site"


async def _capture_screenshot(url: str, screenshot_path: Path) -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            context = await browser.new_context(
                viewport={"width": CAPTURE_W, "height": CAPTURE_H},
                device_scale_factor=2,
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                    "Version/17.0 Safari/605.1.15"
                ),
            )
            page = await context.new_page()
            await page.goto(_normalise_url(url), wait_until="networkidle", timeout=30000)
            # Give the page a beat for fonts + lazy-loaded hero imagery
            await page.evaluate("document.fonts.ready")
            await page.wait_for_timeout(800)
            await page.screenshot(path=str(screenshot_path), full_page=False)
        finally:
            await browser.close()


def _ken_burns(screenshot_path: Path, out_path: Path, duration_s: float, fps: int) -> None:
    """Generate a 1080×1920 MP4 with a slow zoom+pan from the screenshot.

    Screenshot is 1440×2560 (or 2880×5120 with DSR=2). We crop a vertical
    1080×1920 window that gently pans top→bottom while zooming 1.00 → 1.06.
    Soft fade-in/out for cinematic punctuation.
    """
    total_frames = max(1, int(round(duration_s * fps)))
    fade_in = 0.30
    fade_out = 0.30
    fade_in_frames = max(1, int(round(fade_in * fps)))
    fade_out_start = max(1, int(round((duration_s - fade_out) * fps)))

    # zoompan moves a 1080×1920 viewport across the captured screenshot.
    # We start at top of the page (y=0) and pan downward over the duration
    # while zooming from 1.0 → 1.06. d=N tells zoompan how many frames to emit.
    zoompan = (
        f"zoompan="
        f"z='min(zoom+0.0006,1.06)'"
        f":x='iw/2-(iw/zoom/2)'"
        f":y='(ih-oh/zoom)*on/{total_frames}'"
        f":d={total_frames}"
        f":s={CANVAS_W}x{CANVAS_H}"
        f":fps={fps}"
    )
    fade = (
        f"fade=t=in:st=0:d={fade_in:.2f},"
        f"fade=t=out:st={duration_s - fade_out:.2f}:d={fade_out:.2f}"
    )
    # `-loop 1` + zoompan with `d=N` was emitting N frames per input loop
    # iteration, producing 100× duration. Drop `-loop`; pass the still as a
    # single input and cap output via `-frames:v` so zoompan emits exactly
    # the frame budget we want.
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(screenshot_path),
        "-vf", f"{zoompan},{fade},format=yuv420p",
        "-frames:v", str(total_frames),
        "-r", str(fps),
        "-c:v", "libx264",
        "-crf", "18",
        "-preset", "medium",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(out_path),
    ]
    subprocess.run(cmd, check=True)


def capture_website(
    url: str,
    out_path: Path,
    *,
    duration_s: float = DEFAULT_DURATION,
    fps: int = DEFAULT_FPS,
    refresh: bool = False,
) -> Path:
    """Capture `url` and produce a 1080×1920 MP4 at `out_path`.

    Cache: if `out_path` exists and `refresh=False`, returns it unchanged.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists() and not refresh:
        print(f"[website-capture] cached {out_path.name}")
        return out_path

    screenshot_path = out_path.with_name(out_path.stem + ".png")
    print(f"[website-capture] {url} → {screenshot_path.name}")
    asyncio.run(_capture_screenshot(url, screenshot_path))

    print(f"[website-capture] Ken Burns → {out_path.name} ({duration_s:.1f}s)")
    _ken_burns(screenshot_path, out_path, duration_s, fps)
    return out_path


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser(description="Capture a website as a vertical reel B-roll cut.")
    ap.add_argument("url", help="URL to capture (https:// optional)")
    ap.add_argument("out", type=Path, help="Output .mp4 path")
    ap.add_argument("--duration", type=float, default=DEFAULT_DURATION, help="Seconds (default 4.0)")
    ap.add_argument("--fps", type=int, default=DEFAULT_FPS)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    capture_website(args.url, args.out, duration_s=args.duration, fps=args.fps, refresh=args.refresh)


if __name__ == "__main__":
    main()
