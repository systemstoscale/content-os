"""Render an HTML card into an animated overlay (alpha channel).

Workflow:
    html + duration → paused frame-stepping via Playwright → ffmpeg → .mov (ProRes 4444)

The HTML authors motion via CSS `@keyframes` + `animation`. We pause every
document animation and step `currentTime` per frame, screenshot with
`omit_background=True`, then encode to ProRes 4444 (yuva444p10le) — alpha
reliably survives the round-trip and FFmpeg filter graphs consume it natively.

Use this INSTEAD OF a static PNG when a B-roll card should fade/slide/pop.
`reel_editor.py render` treats `.mov`/`.webm` overlays as animated
(setpts-shifted to the overlay's `start`, enable-gated to the overlay window).

Output format is picked from the output extension:
    .mov  → ProRes 4444 (default, reliable alpha)
    .webm → libvpx-vp9 yuva420p (smaller but some ffmpeg builds drop alpha)

CLI:
    python3 skalers/backend/content/broll_animator.py <html> <out.mov> --duration 4.0
"""
from __future__ import annotations

import argparse
import asyncio
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright

CANVAS_W = 1080
CANVAS_H = 1920
DEFAULT_FPS = 30


async def _capture_frames(html_path: Path, frames_dir: Path, duration_s: float, fps: int) -> int:
    total_frames = max(1, int(round(duration_s * fps)))
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(
            viewport={"width": CANVAS_W, "height": CANVAS_H},
            device_scale_factor=1,
        )
        page = await context.new_page()
        await page.goto(f"file://{html_path.resolve()}")
        await page.wait_for_load_state("networkidle")
        await page.evaluate("document.fonts.ready")

        for i in range(total_frames):
            t_ms = (i / fps) * 1000.0
            await page.evaluate(
                "(t) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; } }",
                t_ms,
            )
            await page.screenshot(
                path=str(frames_dir / f"{i:04d}.png"),
                omit_background=True,
                clip={"x": 0, "y": 0, "width": CANVAS_W, "height": CANVAS_H},
            )
        await browser.close()
    return total_frames


def _encode_cmd(out_path: Path, frames_glob: Path, fps: int) -> list[str]:
    ext = out_path.suffix.lower()
    base = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-framerate", str(fps),
        "-i", str(frames_glob),
    ]
    if ext == ".webm":
        return base + [
            "-c:v", "libvpx-vp9",
            "-pix_fmt", "yuva420p",
            "-b:v", "0", "-crf", "30",
            "-auto-alt-ref", "0",
            str(out_path),
        ]
    # default: ProRes 4444 MOV (reliable alpha on macOS ffmpeg builds)
    return base + [
        "-c:v", "prores_ks",
        "-profile:v", "4444",
        "-pix_fmt", "yuva444p10le",
        "-qscale:v", "11",
        str(out_path),
    ]


def render(html_path: Path, out_path: Path, duration_s: float, fps: int = DEFAULT_FPS) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        frames_dir = Path(tmp)
        total = asyncio.run(_capture_frames(html_path, frames_dir, duration_s, fps))
        cmd = _encode_cmd(out_path, frames_dir / "%04d.png", fps)
        subprocess.run(cmd, check=True)
        print(f"[broll-animator] {out_path.name}  {total} frames @ {fps}fps  ({duration_s:.2f}s)")


def main() -> None:
    ap = argparse.ArgumentParser(description="HTML card → animated overlay with alpha (.mov / .webm)")
    ap.add_argument("html", type=Path, help="Input HTML file (use CSS @keyframes for motion)")
    ap.add_argument("out", type=Path, help="Output .mov (recommended) or .webm")
    ap.add_argument("--duration", type=float, required=True, help="Total seconds")
    ap.add_argument("--fps", type=int, default=DEFAULT_FPS)
    args = ap.parse_args()
    if not args.html.exists():
        sys.exit(f"HTML not found: {args.html}")
    render(args.html, args.out, args.duration, args.fps)


if __name__ == "__main__":
    main()
