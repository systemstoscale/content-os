"""Build a brand-aligned thumbnail for a finished reel.

Output: `thumbnail.png` at 1080×1920 (full reel size — center-crop fits the
1080×1350 IG cover slot too).

Pipeline:
  1. Pick a "good" frame from `reel-cut.mp4` (default: 25% through the cut).
  2. Ask Claude (Sonnet 4.6) for a 2–3 word punchy headline + a `gold_word`
     to highlight, drawn from the actual transcript. (Models the 3 examples
     Max showed: "$250,000 on ads / Per week", "Give more, Sell less?",
     "Paid in full VS Monthly recurring".)
  3. Render an HTML page with the frame as full-bleed background + a vertical
     dark gradient over the bottom 40% + the headline burned in Archivo Black
     900 (with the gold word in #f8d380), via Playwright screenshot.
  4. Save to `<folder>/thumbnail.png`.

Brand: skalers.io/brand
  - Display: Archivo Black 900
  - Gold: #f8d380 on dark
  - Hairline `#3a3a3a`
  - NO em dashes anywhere
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import subprocess
from pathlib import Path


THUMBNAIL_MODEL = os.environ.get("THUMBNAIL_MODEL", "claude-sonnet-4-6")
CANVAS_W = 1080
CANVAS_H = 1920


# ---------------------------------------------------------------------------
# Headline picking (Claude)
# ---------------------------------------------------------------------------


THUMBNAIL_PROMPT = """You are writing ONE magazine-cover headline for a Skalers.io vertical short-form reel thumbnail. Treat this like a newsstand cover line: massive Archivo Black 900 type, dominating the lower half of the canvas, with the number/tier highlighted in gold (#f8d380) — designed to stop one specific person mid-scroll among thousands of competing covers.

REFERENCE: classic newsstand attention-grabbing-headline formulas (https://afritechglobal.com/timeless-formulas-for-writing-attention-grabbing-headlines-that-will-pull-prospects-to-your-platform/) — every word fights for its real estate, the number is the anchor, no padding, no articles.

YOUR ICP — picture this person scrolling at 11pm:
  6-figure founder, $10K–$100K/mo, exhausted, on Reels for 4 minutes "to relax" before bed.
  They've ALREADY scrolled past 50 thumbnails today saying "AI will replace you", "How I scaled to 7 figures", "The truth about [thing]".
  Their thumb stops on ONE thing: a SPECIFIC element they haven't seen — a number, a contrast, a contrarian claim — that opens a curiosity gap their brain CAN'T LEAVE UNOPENED.
  Your job: engineer that one element.

OUTPUT
Return ONLY a JSON object — no preamble, no markdown — in this exact shape:
{
  "headline": "the full headline as one string. May contain a single \\n where the line breaks for layout (max 2 lines).",
  "gold_phrase": "1–4 word substring within `headline` to highlight gold. Must appear verbatim.",
  "framework": "one of: dollar_amount | counter_question | vs_framing | contrarian_claim | specific_outcome | stop_doing | open_loop_secret",
  "rationale": "30 words on why this stops the scroll for a 6-figure founder. Specifically: what curiosity gap does it open?"
}

PRIORITY RULE: NUMBERS WIN.

If the transcript contains ANY specific number — a dollar amount, an X-figure tier, a percentage, a count, a multiplier, a time anchor (days/weeks/months/years), an outcome metric — prefer the framework that USES it. Numbers stop the scroll faster than any other element. Scan the transcript first for these signals:

  X-figure tiers:     "8-figure founder", "7-figure business", "6-figure", "9-figure". TREAT AS FIRST-CLASS NUMBERS — they tell the founder exactly which tier the story is about. Render as "8-Figure", "7-Figure" (capital F, hyphen).
  $$$ amounts:        $1k, $10K, $100K, $1M, $10M, "thousand", "million", "billion"
  Time anchors:       "in 7 days", "30 days", "90 days", "in 6 months", "by [year]", "in 18 months"
  Counts / lists:     "the 7 systems", "3 questions", "the 4 Ws", "5 step", "10x", "100x", "1000x"
  Ratios:             "10:1", "1 in 100", "2x revenue", "half the team"
  Percentages:        "90% less", "doubled", "tripled", "cut in half", "1% of"
  Specific outcomes:  "$0 to $100K/mo", "from 6 to 7 figures", "$250K/week"

If ANY number or X-figure tier exists, the headline MUST use it. The gold_phrase SHOULD be that number/tier. ONLY fall back to a non-numeric framework if the transcript truly has no specific quantity worth surfacing.

X-FIGURE EXAMPLES (use when speaker names a tier — note NO leading articles):
  "8-Figure Founder's / Jail Cell"     gold_phrase = "8-Figure"
  "7-Figure / Founders Quit Calls"     gold_phrase = "7-Figure"
  "Inside an / 8-Figure Brain"         gold_phrase = "8-Figure"
  "9-Figure / Mistake"                 gold_phrase = "9-Figure"

THE 7 HOOK FRAMEWORKS (pick one, lean hard into it — number-bearing frameworks first)

1. `dollar_amount` — Specific dollar number + time anchor. **PREFER this when a $ amount exists in the transcript.**
   Examples: "$250,000 on ads / Per week" • "$10M in 12 months" • "$0 → $100K/mo (90 days)"
   Why it works: the brain auto-extrapolates and demands "how?".

2. `counter_question` — Question that contradicts conventional wisdom.
   Examples: "Give more, / Sell less?" • "Hire less, / Earn more?" • "Post less, / Grow faster?"
   Why it works: violates a heuristic the founder uses daily; brain HAS to resolve the contradiction.

3. `vs_framing` — Hard side-by-side that makes them pick.
   Examples: "Paid in full VS / Monthly recurring" • "Hiring VS / Hiring AI" • "$10K coach VS / $200 AI"
   Why it works: forces self-classification — "which side am I on?".

4. `contrarian_claim` — Statement that violates their tribe's belief.
   Examples: "I fired my entire sales team" • "Sales calls killed my business" • "I deleted my CRM"
   Why it works: pattern-interrupt; can't scroll past without knowing if you're crazy or correct.

5. `specific_outcome` — Outcome + specific timeframe + (optional) specific tool.
   Examples: "Scaled to $100K/mo with 0 calls" • "Closed $50K in 7 days from one IG post" • "Built it in 6 hours"
   Why it works: feels achievable, immediately schedules a "show me how".

6. `stop_doing` — Imperative that their tribe is doing the thing wrong.
   Examples: "Stop hiring closers" • "Stop building funnels" • "Stop posting carousels"
   Why it works: they're DOING the thing right now. Implication: "you're losing money this minute".

7. `open_loop_secret` — Promise of one specific thing the speaker found out.
   Examples: "The 1 thing 8-figure founders don't do" • "What ChatGPT WON'T tell you about scaling" • "The system $100M founders won't share"
   Why it works: assumes existence of insider info; curiosity gap is widest framework — but ALSO most clichéd, so use sparingly.

CONSTRAINTS

- The headline MUST be drawn from concepts/words actually in the transcript. Don't fabricate claims the speaker didn't make.
- **≤ 30 chars TOTAL.** Magazine-cover density. Every word earns its space. If your draft is 32+ chars, cut.
- **NO leading articles.** Strip "The", "A", "An", "This", "That", "My" off the front. They waste the first eye-stop slot. "8-Figure Founder's Jail Cell" beats "The 8-Figure Founder's Jail Cell" every time.
- **NO filler words mid-headline** ("of", "and", "with", "for") unless cutting them breaks meaning.
- ≤ 2 lines. ONE concept that may break for layout. Don't write two unrelated thoughts.
- `gold_phrase` is the part the eye lands on FIRST. **When a number or X-figure tier exists, gold_phrase = ONLY that number/tier — not the words around it.** Examples: gold_phrase = "8-Figure" (NOT "The 8-Figure"), gold_phrase = "$250K" (NOT "$250K/week"), gold_phrase = "100x" (NOT "100x faster").
- Reuse the speaker's actual phrasing where possible.
- NO question marks unless the framework is `counter_question`.
- NO weak openers: "How I", "Why I", "What I", "The truth about". These are scroll-past patterns.

Brand vocabulary KEEP (always full caps): SCALING, SMART, SCALING System, 7 Systems, 4Ws, Skalers.io
Brand vocabulary BANS (NEVER appear in any field):
- NO em dashes (—) anywhere. Use commas, colons, or periods.
- NO "rung" — use "milestone".
- NO "quick".
- NO "7-9 figure" — say "$1M-$100M" or omit.
- NEVER claim 7-figure status for the speaker. He is at 6 scaling to 7.
- NEVER call Skalers a "coaching program", "agency", or "mastermind".

CRITIQUE GATE — re-read your output and answer in `rationale`:
1. **Numbers check.** Did the transcript have ANY specific number ($, %, count, time anchor, multiplier) OR X-figure tier (6/7/8/9-figure)? If YES, did your headline USE it? If you skipped one, regenerate using `dollar_amount` or `specific_outcome` framework with that number/tier as gold_phrase.
2. Would a 6-figure founder who's seen 50 AI thumbnails today STOP on this one? If you can't say yes with confidence, regenerate.
3. Does it have ONE specific element (number, contrast, contrarian claim) they haven't seen 100 times?
4. Is the gold_phrase the SHARPEST part of the headline (not a generic word)? When a number or X-figure tier exists, the gold_phrase MUST be the number/tier.
5. Is total char count ≤ 30? Count it. (Magazine density — fewer words = bigger type = more stop-the-scroll.)
6. Did you strip every leading article ("The", "A", "An", "This", "My")? If "The X" reads fine as just "X", drop "The".
7. Did you avoid every weak opener and clichéd framing?

If any answer fails, regenerate before returning.

Generate now."""


def _request_headline(transcript_text: str) -> dict:
    import anthropic

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=THUMBNAIL_MODEL,
        max_tokens=1024,
        system=THUMBNAIL_PROMPT,
        messages=[{
            "role": "user",
            "content": json.dumps({"transcript": transcript_text[:6000]}, ensure_ascii=False),
        }],
    )
    text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].lstrip()
    return json.loads(text)


# ---------------------------------------------------------------------------
# Frame extraction
# ---------------------------------------------------------------------------


def _media_duration(media: Path) -> float:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(media)],
        text=True,
    ).strip()
    return float(out)


def _extract_frame(video: Path, t: float, out: Path) -> None:
    """Extract a single PNG frame at `t` seconds. `-ss` after `-i` is
    frame-accurate (input seek is keyframe-only)."""
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(video),
        "-ss", f"{t:.3f}",
        "-frames:v", "1",
        "-q:v", "2",
        str(out),
    ]
    subprocess.run(cmd, check=True)


def _png_to_data_url(png: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(png.read_bytes()).decode("ascii")


# ---------------------------------------------------------------------------
# HTML composition
# ---------------------------------------------------------------------------


def _highlight_gold(text: str, gold: str | None) -> str:
    if not gold:
        return text
    pattern = re.escape(gold.strip())
    if not pattern:
        return text
    return re.sub(pattern, lambda m: f'<span class="gold">{m.group(0)}</span>',
                  text, count=1, flags=re.IGNORECASE)


def _brand_font_link(font: str) -> str:
    """Build a Google Fonts <link> for the brand display font.

    Google Fonts expects the family name with spaces replaced by '+'. We
    pass `display=swap` so the screenshot doesn't block on font fetch.
    """
    slug = font.strip().replace(" ", "+")
    return (
        '<link rel="preconnect" href="https://fonts.googleapis.com" />'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />'
        f'<link href="https://fonts.googleapis.com/css2?family={slug}:wght@900&display=swap" rel="stylesheet" />'
    )


def _thumbnail_html(frame_data_url: str, headline: str, gold: str | None) -> str:
    """Render the thumbnail HTML.

    `headline` may contain a single `\\n` to break to a second line for layout.
    The gold substring is highlighted in #f8d380 across whichever line(s) it
    appears in.
    """
    # Split into lines BEFORE highlighting so the gold span doesn't cross newlines
    raw_lines = headline.split("\n")[:2]
    line_html = "".join(
        f'<span class="line">{_highlight_gold(line, gold)}</span>'
        for line in raw_lines if line
    )
    import brand_profile
    brand_display_font = brand_profile.display_font()
    brand_gold_hex     = brand_profile.gold_hex()
    brand_font_link    = _brand_font_link(brand_display_font)
    tstyle             = brand_profile.thumbnail_style()
    title_skew         = float(tstyle.get("title_skew", -7))
    title_size         = int(tstyle.get("title_size", 168))
    scrim_opacity      = float(tstyle.get("scrim_opacity", 0.94))
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width={CANVAS_W}, height={CANVAS_H}" />
  {brand_font_link}
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body {{
      width: {CANVAS_W}px;
      height: {CANVAS_H}px;
      overflow: hidden;
      background: #111;
      font-family: "{brand_display_font}", system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
    }}
    .frame {{
      position: absolute; inset: 0;
      background-image: url('{frame_data_url}');
      background-size: cover;
      background-position: center;
    }}
    /* Vertical dark gradient over the bottom ~50% so the headline stays
       legible regardless of what's behind. Brand spec: solid dark, no
       gradient on type — the gradient is on the BACKDROP, not the type. */
    .scrim {{
      position: absolute;
      left: 0; right: 0;
      bottom: 0;
      height: 56%;
      background: linear-gradient(
        to bottom,
        rgba(0, 0, 0, 0)                       0%,
        rgba(0, 0, 0, {scrim_opacity * 0.30:.2f})  20%,
        rgba(0, 0, 0, {scrim_opacity * 0.66:.2f})  45%,
        rgba(0, 0, 0, {scrim_opacity * 0.91:.2f})  75%,
        rgba(0, 0, 0, {scrim_opacity:.2f}) 100%
      );
    }}
    /* Magazine-cover headline: positioned inside the strict safe overlap of
       Reels-feed (y in [220, 1470]) AND profile-feed crop (y in [285, 1635]).
       At bottom: 520, a 2-line 168px block (~309px tall) sits at y in
       [1091, 1400], visible on both surfaces. */
    .headline {{
      position: absolute;
      left: 48px;
      right: 48px;
      bottom: 520px;
      color: #ffffff;
      font-weight: 900;
      font-size: {title_size}px;
      line-height: 0.92;
      letter-spacing: -0.025em;
      text-transform: none;
      transform: skewX({title_skew}deg);
      transform-origin: left bottom;
      text-shadow:
        0 4px 18px rgba(0, 0, 0, 0.65),
        0 2px 4px  rgba(0, 0, 0, 0.85);
    }}
    .headline .line {{ display: block; }}
    .headline .line + .line {{ margin-top: 4px; }}
    .gold {{ color: {brand_gold_hex}; }}
  </style>
</head>
<body>
  <div class="frame"></div>
  <div class="scrim"></div>
  <div class="headline">{line_html}</div>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Playwright single-shot render
# ---------------------------------------------------------------------------


async def _render_thumbnail(html_path: Path, out_path: Path) -> None:
    from playwright.async_api import async_playwright
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
        # Auto-fit headline. Two-constraint shrink:
        #   1. Horizontal: if any single word is wider than the container
        #      (e.g. ENVIRONMENT, WORKFLOW), scrollWidth > clientWidth and
        #      we shrink. Multi-word lines wrap naturally first, so we don't
        #      have to fit "CURATE YOUR ENVIRONMENT," on one line at 168px.
        #   2. Vertical: after wrapping, total scrollHeight must stay inside
        #      the strict safe overlap. Bottom edge of .headline at y=1400
        #      (bottom: 520 of 1920 canvas); profile-feed safe-zone ceiling
        #      is y=285, giving ~1115px of vertical budget.
        # Iterate (max 4 passes) because each shrink changes wrap behavior.
        # 0.92 horizontal safety covers the skewX(-7deg) bounding-box growth
        # (~tan(7°)·height of extra width) plus a margin.
        await page.evaluate("""
            () => {
              const h = document.querySelector('.headline');
              if (!h) return;
              const targetW = h.clientWidth * 0.92;
              const targetH = 1115 * 0.95;
              for (let i = 0; i < 4; i++) {
                const overW = h.scrollWidth  > targetW ? h.scrollWidth  / targetW : 1;
                const overH = h.scrollHeight > targetH ? h.scrollHeight / targetH : 1;
                const worst = Math.max(overW, overH);
                if (worst <= 1) break;
                const base = parseFloat(getComputedStyle(h).fontSize);
                h.style.fontSize = Math.floor(base / worst) + 'px';
              }
            }
        """)
        await page.screenshot(
            path=str(out_path),
            full_page=False,
            clip={"x": 0, "y": 0, "width": CANVAS_W, "height": CANVAS_H},
        )
        await browser.close()


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------


def _format_thumbnail_headline(headline: str, gold_phrase: str = "") -> tuple[str, str]:
    """Compress a caption headline into a thumbnail-friendly form:
    <= 2 lines, <= 28 chars per line.

    Strategy:
      1. Strip leading articles ('The', 'A', 'An') and the word 'how'.
      2. UPPERCASE.
      3. If short enough already, split on a word boundary near the middle.
      4. If too long, call Sonnet with a tight compression prompt.
    Returns (formatted_headline_with_newline, gold_phrase_preserved).
    """
    cleaned = (headline or "").strip()
    # Drop leading articles + low-info words for thumbnail punch
    for prefix in ("the ", "a ", "an ", "how to ", "how "):
        if cleaned.lower().startswith(prefix):
            cleaned = cleaned[len(prefix):]
            break
    cleaned = cleaned.rstrip(".!?")
    upper = cleaned.upper()
    gold_upper = (gold_phrase or "").upper().strip()

    # Already fits on one line
    if len(upper) <= 28:
        return upper, gold_upper

    # Try to split on a word boundary near the middle, with both halves <= 28 chars
    words = upper.split()
    if len(words) >= 2:
        for i in range(1, len(words)):
            line1 = " ".join(words[:i])
            line2 = " ".join(words[i:])
            if len(line1) <= 28 and len(line2) <= 28:
                # Prefer splits that put the gold phrase entirely on one line
                if gold_upper and (gold_upper in line1 or gold_upper in line2):
                    return f"{line1}\n{line2}", gold_upper
                # Otherwise pick the most balanced
                if abs(len(line1) - len(line2)) <= 8:
                    return f"{line1}\n{line2}", gold_upper

    # Too long even after splitting. Ask the LLM to compress.
    if not os.environ.get("ANTHROPIC_API_KEY"):
        # Last-resort hard truncate
        truncated = upper[:28] + "\n" + upper[28:56]
        return truncated, gold_upper

    try:
        import anthropic
        cli = anthropic.Anthropic()
        sys = (
            "Compress the headline into a 2-line thumbnail title.\n"
            "Constraints:\n"
            "- MAX 2 lines\n"
            "- MAX 28 characters per line\n"
            "- ALL UPPERCASE\n"
            "- Preserve the gold phrase verbatim if provided\n"
            "- Drop articles, fillers, and low-info words\n"
            "- Keep the meaning, keep numbers and X-figure tiers\n\n"
            "Format the output as a JSON object with one key 'lines' whose value\n"
            "is an array of exactly 1 or 2 uppercase strings. Output nothing else.\n"
            "Example output:\n"
            '{"lines":["3 THINGS TO WIN","WITH AI IN 2026"]}'
        )
        user = f"HEADLINE: {upper}\nGOLD PHRASE TO PRESERVE: {gold_upper or '(none)'}"
        resp = cli.messages.create(
            model=os.environ.get("THUMBNAIL_MODEL", "claude-sonnet-4-6"),
            max_tokens=120,
            system=sys,
            messages=[{"role": "user", "content": user}],
        )
        out = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        out = out.strip("`").strip()
        if out.lower().startswith("json"):
            out = out[4:].lstrip()
        data = json.loads(out)
        lines = [str(ln).strip() for ln in (data.get("lines") or []) if str(ln).strip()][:2]
        if lines and all(len(ln) <= 28 for ln in lines):
            return "\n".join(lines), gold_upper
    except Exception as e:
        print(f"[thumbnail] compress LLM failed: {e}", file=__import__('sys').stderr)

    # Fallback hard truncate
    return upper[:28] + "\n" + upper[28:56], gold_upper


def generate_thumbnail(folder: Path, *, refresh: bool = False, frame_t: float | None = None,
                       caption_payload: dict | None = None) -> Path:
    """Generate `<folder>/thumbnail.png` from the cut + (optional) caption_payload.

    Reads:
      - `<folder>/reel-cut.mp4` — source video for the frame extract
      - `<folder>/transcript.json` — only consulted if caption_payload is None

    When `caption_payload` is provided (preferred path used by the Modal
    renderer), the thumbnail headline is derived deterministically from
    `caption_payload['headline']` + `caption_payload['gold_phrase']` and
    constrained to <= 2 lines x <= 28 chars. No separate transcript-driven
    LLM call. This is the framework-aligned path.

    When `caption_payload` is None, falls back to the legacy
    `_request_headline(transcript_text)` LLM call (kept for the standalone
    CLI use case).

    Cache: skips if `thumbnail.png` exists and is newer than `reel-cut.mp4`,
    unless `refresh=True`.
    """
    cut_path = folder / "reel-cut.mp4"
    transcript_path = folder / "transcript.json"
    if not cut_path.exists():
        raise SystemExit(f"No reel-cut.mp4 in {folder}; run `cut` first.")

    out_path = folder / "thumbnail.png"
    if (
        out_path.exists()
        and out_path.stat().st_mtime >= cut_path.stat().st_mtime
        and not refresh
    ):
        print(f"[thumbnail] cached {out_path.name}")
        return out_path

    # 1. Pick a frame
    duration = _media_duration(cut_path)
    if frame_t is None:
        frame_t = max(1.0, min(duration - 0.2, duration * 0.25))

    frame_path = folder / "thumbnail-frame.png"
    print(f"[thumbnail] extracting frame at t={frame_t:.2f}s of {duration:.2f}s")
    _extract_frame(cut_path, frame_t, frame_path)

    # 2. Resolve headline + gold phrase
    if caption_payload and caption_payload.get("headline"):
        src_headline = caption_payload["headline"]
        src_gold = caption_payload.get("gold_phrase", "") or ""
        headline, gold = _format_thumbnail_headline(src_headline, src_gold)
        framework = "framework-aligned"
        rationale = f"from caption_payload: {src_headline[:120]!r}"
        # Cache for debugging
        (folder / "thumbnail-llm.json").write_text(json.dumps(
            {"headline": headline, "gold_phrase": gold, "source": "caption_payload",
             "src_headline": src_headline},
            indent=2,
        ))
    else:
        # Legacy path: transcript-driven LLM call.
        if not transcript_path.exists():
            raise SystemExit(f"No transcript.json in {folder} and no caption_payload supplied.")
        transcript = json.loads(transcript_path.read_text())
        text = transcript.get("text", "") or " ".join(
            w.get("word", "") for w in transcript.get("words", [])
        )
        cache_path = folder / "thumbnail-llm.json"
        headline_data: dict | None = None
        if cache_path.exists() and not refresh:
            try:
                headline_data = json.loads(cache_path.read_text())
                print(f"[thumbnail] using cached headline ({cache_path.name})")
            except Exception:
                headline_data = None
        if headline_data is None:
            if not os.environ.get("ANTHROPIC_API_KEY"):
                raise SystemExit("ANTHROPIC_API_KEY missing — cannot pick thumbnail headline")
            print(f"[thumbnail] (legacy) asking {THUMBNAIL_MODEL} for a punchy headline...")
            headline_data = _request_headline(text)
            cache_path.write_text(json.dumps(headline_data, indent=2))
        headline = str(headline_data.get("headline", "")).strip()
        gold = headline_data.get("gold_phrase") or None
        framework = headline_data.get("framework") or "legacy-transcript"
        rationale = headline_data.get("rationale") or ""
    print(f"[thumbnail]   HEADLINE  = {headline!r}")
    print(f"[thumbnail]   GOLD      = {gold!r}")
    print(f"[thumbnail]   FRAMEWORK = {framework}")
    if rationale:
        print(f"[thumbnail]   WHY       = {rationale[:140]}")

    # 3. Compose HTML with the frame as data URL (Playwright file:// can't
    # easily reference sibling files for CSS background-image without CORS
    # quirks; data URL is reliable).
    frame_data_url = _png_to_data_url(frame_path)
    html_path = folder / "thumbnail.html"
    html_path.write_text(_thumbnail_html(frame_data_url, headline, gold), encoding="utf-8")

    # 4. Render via Playwright single-shot screenshot
    print(f"[thumbnail] rendering to {out_path.name}...")
    asyncio.run(_render_thumbnail(html_path, out_path))

    size_kb = out_path.stat().st_size / 1024
    print(f"[thumbnail] ✅ {out_path.name} ({size_kb:.0f} KB)")
    # Tidy up: keep thumbnail-frame.png + thumbnail.html for debugging
    return out_path


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser(description="Generate a brand-aligned thumbnail for a reel folder.")
    ap.add_argument("folder", type=Path, help="Reel folder containing reel-cut.mp4 + transcript.json")
    ap.add_argument("--frame-t", type=float, default=None, help="Seconds into the cut for the still frame (default: 25%% through)")
    ap.add_argument("--refresh", action="store_true", help="Force re-pick frame + headline")
    args = ap.parse_args()
    generate_thumbnail(args.folder.resolve(), refresh=args.refresh, frame_t=args.frame_t)


if __name__ == "__main__":
    main()
