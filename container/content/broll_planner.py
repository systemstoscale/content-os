"""Auto-design B-roll cards for a vertical reel.

Two-stage LLM pipeline:

  Stage 1 — `plan_broll(folder)` reads `transcript.json` (cut timeline, word-level),
            asks Sonnet 4.6 to pick 3–6 emphatic beats AND assign each a layout from
            the LAYOUTS registry, with per-layout fields filled in.

  Stage 2 — `design_card(beat)` calls Sonnet 4.6 again, per beat, with the cinematic
            prompt. The LLM generates a full HyperFrames composition (HTML + GSAP)
            grounded in the 3 hand-authored reference cards (counter, network,
            logo_glow). Output is a self-contained index.html ready for
            `npx hyperframes render --format webm --output ...`.

Each composition is rendered to alpha .webm via the HyperFrames CLI; the existing
`reel_editor.py cmd_render` composites those .webm files (alpha-aware) over the cut.

Legacy path (--no-cinematic flag in reel_editor) still uses the original simple-
template-string `render_card_html()` + `broll_animator.render()` flow as fallback
for the 4 simple layouts (statement, statement_sub, stack, cta).

Layouts (10 total — registry below):
  Simple (legacy fallback ok):  statement, statement_sub, stack, cta
  Cinematic (HyperFrames-only): counter, chart_line, network, logo_glow,
                                 comparison, big_quote

Default model: Sonnet 4.6 (override via `BROLL_PLANNER_MODEL` env). Sonnet beats
Haiku meaningfully on both beat selection and motion-graphics code generation.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import reel_templates  # hand-authored, deterministic motion-graphic templates
import brand_profile as _bp


PLANNER_MODEL = os.environ.get("BROLL_PLANNER_MODEL", "claude-sonnet-4-6")
GOOGLE_FONTS_URL = (
    "https://fonts.googleapis.com/css2?"
    "family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800"
    "&display=swap"
)
CANVAS_W = 1080
CANVAS_H = 1920
ENTER_S = 0.36
EXIT_S = 0.22
MIN_DURATION = 1.4   # below this, the entrance/exit eat the whole hold
MAX_DURATION = 5.0   # above this the card overstays

# ---------------------------------------------------------------------------
# Tooling paths (HyperFrames CLI + reference compositions)
# ---------------------------------------------------------------------------

_THIS_DIR = Path(__file__).resolve().parent
REEL_PIPELINE_DIR = _THIS_DIR / "reel_pipeline"
HF_BIN = REEL_PIPELINE_DIR / "node_modules" / ".bin" / "hyperframes"
REFERENCES_DIR = REEL_PIPELINE_DIR / "references"

# ---------------------------------------------------------------------------
# LAYOUTS registry — 10 layouts, each with a use_when guideline + per-layout
# field schema. The Stage 1 LLM picks a layout AND fills in the fields. The
# Stage 2 LLM consumes those fields as context when designing the composition.
# ---------------------------------------------------------------------------

LAYOUTS: dict[str, dict] = {
    # ---- Simple layouts (legacy fallback supported) ---------------------
    "statement": {
        "use_when": "Single punchy claim. No supporting line needed.",
        "fields": {
            "headline": "≤6 words, ≤38 chars; verbatim or near-verbatim from the speaker",
            "gold": "(optional) substring of headline to highlight in gold",
        },
    },
    "statement_sub": {
        "use_when": "Claim + supporting detail in one beat.",
        "fields": {
            "headline": "≤6 words, ≤38 chars",
            "sub": "≤14 words, ≤90 chars; the supporting line",
            "gold": "(optional) substring of headline",
        },
    },
    "stack": {
        "use_when": "Enumeration of 3–5 items (1-1-1-1-1 style).",
        "fields": {
            "label": "≤4 words ALL CAPS (e.g. THE RULE)",
            "rows": "list of 3–5 strings, each ≤4 words ≤22 chars",
            "footer": "≤8 words; the closing summary",
            "gold": "(optional) substring of footer",
        },
    },
    "cta": {
        "use_when": "FINAL card only. 'Comment X for Y' close.",
        "fields": {
            "headline": "≤8 words; the call to action",
            "sub": "≤14 words; what they get",
            "pulse_word": "EXACTLY ONE word, ALL CAPS, no spaces (Instagram comment keywords are always a single token, e.g. CONTENTOS not 'CONTENT OS'); the keyword that pulses gold",
        },
    },
    # ---- Cinematic layouts (HyperFrames-rendered) -----------------------
    "counter": {
        "use_when": "Specific numbers, $ amounts, %, timeframes. Visualises growth with chart.",
        "fields": {
            "label": "≤4 words ALL CAPS (e.g. REVENUE GROWTH)",
            "value_target": "integer (count rolls 0 → this number)",
            "value_prefix": "string ≤2 chars (e.g. $)",
            "value_suffix": "string ≤8 chars (e.g. K/mo, %, X)",
            "timeframe": "≤4 words (e.g. in 18 months)",
            "axis_y_max_label": "≤6 chars (e.g. $100K)",
            "axis_y_mid_label": "≤6 chars (e.g. $50K)",
            "axis_y_min_label": "≤4 chars (e.g. $0)",
            "axis_x_start_label": "≤8 chars (e.g. Month 1)",
            "axis_x_end_label": "≤8 chars (e.g. Month 18)",
        },
    },
    "chart_line": {
        "use_when": "Growth/transformation claim WITHOUT a specific target number.",
        "fields": {
            "headline": "≤6 words",
            "sub": "≤14 words",
            "from_label": "≤8 chars (left endpoint annotation)",
            "to_label": "≤8 chars (right endpoint annotation)",
            "gold": "(optional) substring of headline",
        },
    },
    "network": {
        "use_when": "Multiple connected concepts. Hub-and-spoke (1 hub + 6 outer).",
        "fields": {
            "header": "≤4 words ALL CAPS (e.g. 7 SCALING SYSTEMS)",
            "hub_label": "1–4 chars (the central hub)",
            "outer_labels": "list of EXACTLY 6 strings, each 1–4 chars",
            "footer": "≤8 words; the takeaway",
            "footer_gold": "(optional) substring of footer to highlight",
        },
    },
    "logo_glow": {
        "use_when": "Brand mention. Wordmark reveal with mask + glow.",
        "fields": {
            "small_label": "(optional) ≤8 chars label above wordmark",
            "wordmark_main": "≤10 chars (e.g. SKALERS)",
            "wordmark_accent": "(optional) ≤4 chars rendered in gold (e.g. .io)",
            "tagline_line1": "≤7 words; first line below the mark",
            "tagline_line2": "(optional) ≤7 words; second line",
            "gold_in_tagline": "(optional) substring of tagline to highlight gold",
        },
    },
    "comparison": {
        "use_when": "Before/after, old/new, without/with split.",
        "fields": {
            "header": "(optional) ≤6 words context above the split",
            "left_label": "≤2 words (e.g. WITHOUT)",
            "left_text": "≤6 words",
            "right_label": "≤2 words (e.g. WITH)",
            "right_text": "≤6 words",
        },
    },
    "big_quote": {
        "use_when": "Punchline, contrarian quote, the line you want remembered.",
        "fields": {
            "quote": "≤14 words; the full quote",
            "key_word": "1–3 words within `quote` to highlight gold",
            "attribution": "(optional) ≤8 chars (e.g. — MAX)",
        },
    },
    "website_capture": {
        "use_when": (
            "Speaker mentions a website URL or brand domain that should be "
            "shown — full-frame screen-recording cut to the website for "
            "~3-4s, then back to the talking head. Use for: skalers.io, "
            "mdb.ai, mdm.ai, milliondollarbrand.ai, milliondollarman.ai, "
            "or any URL the speaker explicitly directs viewers to. "
            "Pick `start_s` at the moment the URL is spoken."
        ),
        "fields": {
            "url": "the full URL or domain (e.g. skalers.io, mdb.ai)",
            "label": "(optional) ≤4 word context label, not displayed but logged",
        },
    },
}

CINEMATIC_LAYOUTS = {"counter", "chart_line", "network", "logo_glow", "comparison", "big_quote"}
SIMPLE_LAYOUTS = {"statement", "statement_sub", "stack", "cta"}
WEBSITE_LAYOUTS = {"website_capture"}
ALL_LAYOUTS = set(LAYOUTS.keys())


def _layouts_for_prompt() -> str:
    """Build the layout reference block for the Stage 1 SYSTEM_PROMPT."""
    lines = []
    for name, spec in LAYOUTS.items():
        fields_str = ", ".join(spec["fields"].keys())
        lines.append(f"- `{name}` — {spec['use_when']}")
        lines.append(f"  Fields: {{ {fields_str} }}")
    return "\n".join(lines)


SYSTEM_PROMPT = """You are designing cinematic B-roll cards for a Skalers.io vertical short-form reel (Instagram / TikTok / YouTube Shorts). The talking-head face is in the UPPER 50% of the frame. Cards live in the BOTTOM safe-zone (most layouts y=1020–1700 on a 1080×1920 canvas) — they must NEVER cover the face.

You will receive a JSON array of words from a Whisper transcript on the CUT timeline (silences and fillers already removed). Your job: pick 3 to 6 emphatic beats and design a card for each — choose the BEST layout from the 10-card library AND fill in its fields.

Beat selection rules:
- Pick beats where on-screen motion graphics would AMPLIFY the spoken line, not just repeat it.
  Good targets: specific numbers, dollar amounts, percentages, growth claims, named systems, contrarian beliefs, brand mentions, comparisons (before/after, with/without), the punchline, the close.
  Bad targets: generic transitions, throat-clear sentences, "so the thing is".
- Cards must NOT overlap. Sort by `start_s` ascending.
- First card: start_s ≥ 1.5 (let the face land first).
- CTA RULE (mandatory): if the reel's closing lines contain a call-to-action — e.g. "DM me <word>", "comment <word>", "send me <word>", "DM me below <word>" — the LAST card MUST be layout='cta', timed over that closing line, with pulse_word set to the single keyword in ALL CAPS (one token, no spaces: "content OS" -> "CONTENTOS"). Do not drop or skip this card; the keyword on screen is how the funnel works.
- Total card coverage: under ~50% of the reel duration. Less is more.
- Every card duration: between 1.4 and 5.0 seconds. Counter / network / cinematic layouts want 2.8–4.0s to breathe; statements can be tighter.
- Each card stays on screen ~0.4s past the spoken line so the viewer can read it.

Layout selection — pick the layout whose `use_when` matches the spoken line's intent:
{layouts_block}

Layout-specific fields you must fill in (per layout):
- `counter`     numbers + chart growth (uses target value + axis labels)
- `chart_line`  generic growth (no numeric target, just a from→to story)
- `network`     hub + 6 outer nodes connecting (e.g. 7 SCALING Systems)
- `logo_glow`   brand wordmark reveal with mask + glow + tagline
- `comparison`  before/after split panel
- `big_quote`   punchline / contrarian quote — full quote with one highlighted phrase
- `statement`, `statement_sub`, `stack`, `cta` — text-first cards

Brand vocabulary (use exactly):
- SCALING (always full caps, never "Scale")
- Skalers.io, the SCALING System, 7 Systems, 4Ws
- The 7 SCALING letters: S (SMART Offer), C (Conversion), A (Attention), L (Leads), I (Implementation), N (Nurture), G (Growth)
- Reuse the speaker's actual phrasing where possible. Don't paraphrase into words the speaker didn't say.

Brand vocabulary BANS (never appear in any field of any card):
- NO em dashes (—) anywhere. Use commas, periods, or colons. The brand has zero tolerance.
- NO "rung" — use "milestone".
- NO "quick" (quick question / call / favor) — use "fast" or omit.
- NO "7-9 figure" — say "$1M-$100M businesses".
- NEVER claim 7-figure status for the speaker. He is at 6 scaling to 7.
- NEVER call Skalers a "coaching program", "agency", or "mastermind".

Return ONLY a JSON object — no preamble, no markdown — in this exact shape:

{
  "cards": [
    {
      "start_s": 18.5,
      "end_s": 22.5,
      "line": "the exact spoken phrase this card sits on",
      "layout": "counter",
      "fields": {
        "label": "REVENUE GROWTH",
        "value_target": 100,
        "value_prefix": "$",
        "value_suffix": "K/mo",
        "timeframe": "in 18 months",
        "axis_y_max_label": "$100K",
        "axis_y_mid_label": "$50K",
        "axis_y_min_label": "$0",
        "axis_x_start_label": "Month 1",
        "axis_x_end_label": "Month 18"
      }
    },
    {
      "start_s": 60.0,
      "end_s": 64.5,
      "line": "the seven scaling systems are all connected",
      "layout": "network",
      "fields": {
        "header": "7 SCALING SYSTEMS",
        "hub_label": "S",
        "outer_labels": ["C", "A", "L", "I", "N", "G"],
        "footer": "One SCALING System per letter.",
        "footer_gold": "SCALING System"
      }
    }
  ],
  "notes": "one short line summarising the beat-selection logic"
}"""


def _brand_vocab_preamble() -> str:
    """Brand vocabulary + voice prepended to the beat-selection prompt so the
    card text fields match the buyer's brand. No-op-equivalent for the Skalers
    default (it restates the values already baked into the spec below)."""
    keep = ", ".join(_bp.vocab_keep())
    bans = "; ".join(_bp.vocab_bans())
    lines = [f"Brand voice: {_bp.voice_prompt()}"]
    if keep:
        lines.append(f"Vocabulary to use verbatim where relevant: {keep}")
    if bans:
        lines.append(f"Never use: {bans}")
    lines.append("These brand rules OVERRIDE any example vocabulary in the spec below.")
    return "\n".join(lines)


def _build_system_prompt() -> str:
    return _brand_vocab_preamble() + "\n\n" + SYSTEM_PROMPT.replace("{layouts_block}", _layouts_for_prompt())


# ---------------------------------------------------------------------------
# Card HTML rendering (extracted from outputs/2-posting/2026/w17/03-11111-rule/reel/broll/render.py)
# ---------------------------------------------------------------------------


def _highlight_gold(text: str, gold: str | None) -> str:
    """Wrap the first occurrence of `gold` in <span class="gold">. Word-boundary safe."""
    if not gold:
        return text
    pattern = re.escape(gold.strip())
    if not pattern:
        return text
    return re.sub(pattern, lambda m: f'<span class="gold">{m.group(0)}</span>', text, count=1, flags=re.IGNORECASE)


def _card_inner_html(card: dict) -> str:
    layout = card.get("layout", "statement")

    # Read from card["fields"] first (Stage 1 LLM puts simple-layout fields
    # there), fall back to top-level keys (legacy + downgraded paths put
    # them at the top level of the item).
    fields = card.get("fields") or {}

    def field(key, default=""):
        v = fields.get(key)
        if v in (None, "", []):
            v = card.get(key, default)
        return v if v is not None else default

    gold = field("gold", None)

    if layout == "statement":
        headline = _highlight_gold(field("headline"), gold)
        return f'<div class="big">{headline}</div>'

    if layout == "statement_sub":
        headline = _highlight_gold(field("headline"), gold)
        sub = field("sub")
        return f'<div class="big">{headline}</div><div class="sub">{sub}</div>'

    if layout == "stack":
        rows = field("rows", []) or []
        rows_html = "".join(
            f'<div class="stack-row"><span class="num">{i + 1}</span>{row}</div>'
            for i, row in enumerate(rows)
        )
        footer = _highlight_gold(field("footer"), gold)
        label = field("label")
        return (
            f'<div class="top-label">{label}</div>'
            f'<div class="stack">{rows_html}</div>'
            f'<div class="bottom-label">{footer}</div>'
        )

    if layout == "cta":
        pulse = field("pulse_word", "").upper()
        headline = field("headline")
        if pulse:
            headline = headline.replace(pulse, f'<span class="gold pulse">{pulse}</span>')
        sub = field("sub")
        return f'<div class="big">{headline}</div><div class="sub">{sub}</div>'

    # Fallback: treat as statement
    return f'<div class="big">{_highlight_gold(field("headline"), gold)}</div>'


def _css_for(duration: float) -> str:
    """Brand-aligned CSS scaffold for the 4 simple legacy layouts.

    Brand spec (skalers.io/brand):
      Display: Archivo Black 900 — `.big` / `.stack-row .num`
      Sub-display: Poppins 700 — `.top-label`
      Body: Inter 400/500/600 — body default + `.sub` / `.bottom-label`
      Card radius 8px, hairline border `#3a3a3a` over Ink `#222` 88%.
    """
    hold = max(0.0, duration - ENTER_S - EXIT_S)
    exit_delay = ENTER_S + hold
    fonts_url = (
        "https://fonts.googleapis.com/css2?"
        "family=Archivo+Black"
        "&family=Inter:wght@400;500;600"
        "&family=Poppins:wght@600;700"
        "&display=swap"
    )
    return (
        f"@import url('{fonts_url}');"
        "* { margin: 0; padding: 0; box-sizing: border-box; }"
        f"html, body {{ width: {CANVAS_W}px; height: {CANVAS_H}px; "
        "background: transparent; font-family: 'Inter', sans-serif; "
        "-webkit-font-smoothing: antialiased; color: #ffffff; }"
        ".card { position: absolute; left: 80px; right: 80px; bottom: 220px; "
        "height: auto; min-height: 220px; max-height: 680px; "
        "padding: 30px 40px; background: rgba(34, 34, 34, 0.88); "
        "backdrop-filter: blur(8px); border: 1px solid #3a3a3a; "
        "border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; "
        "justify-content: center; align-items: center; gap: 14px; opacity: 0; "
        "transform: translateY(40px); animation: enter "
        f"{ENTER_S}s cubic-bezier(.2,.9,.3,1) forwards, "
        f"exit {EXIT_S}s {exit_delay:.3f}s ease-in forwards; }}"
        ".card.tall { min-height: 440px; padding: 22px 36px; gap: 8px; }"
        "@keyframes enter { to { opacity: 1; transform: translateY(0); } }"
        "@keyframes exit  { to { opacity: 0; transform: translateY(-14px); } }"
        ".gold { color: #f8d380 !important; }"
        ".big { font-family: 'Archivo Black', sans-serif; font-size: 64px; "
        "font-weight: 900; line-height: 1.06; text-align: center; "
        "letter-spacing: -0.01em; }"
        ".sub { font-family: 'Inter', sans-serif; font-size: 28px; font-weight: 500; "
        "text-align: center; color: rgba(255,255,255,0.85); line-height: 1.35; }"
        ".top-label { font-family: 'Poppins', sans-serif; font-size: 26px; "
        "font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; "
        "color: rgba(255,255,255,0.65); }"
        ".stack { display: flex; flex-direction: column; gap: 6px; "
        "align-items: flex-start; align-self: center; }"
        ".stack-row { font-family: 'Inter', sans-serif; font-size: 36px; "
        "font-weight: 600; line-height: 1.05; display: flex; align-items: center; "
        "gap: 18px; }"
        ".stack-row .num { font-family: 'Archivo Black', sans-serif; "
        "display: inline-block; font-size: 44px; font-weight: 900; "
        "color: #f8d380; min-width: 36px; text-align: center; }"
        ".bottom-label { font-family: 'Archivo Black', sans-serif; "
        "font-size: 34px; font-weight: 900; text-align: center; "
        "border-top: 1px solid rgba(255,255,255,0.15); padding-top: 8px; "
        "margin-top: 2px; white-space: nowrap; }"
        ".pulse { display: inline-block; "
        f"animation: pulse 1.1s {ENTER_S}s ease-in-out infinite; }}"
        "@keyframes pulse { 0%,100% { transform: scale(1); } "
        "50% { transform: scale(1.08); } }"
    )


def render_card_html(card: dict, duration: float) -> str:
    """Build the standalone HTML for a single card."""
    css = _css_for(duration)
    card_class = "card tall" if card.get("layout") == "stack" else "card"
    body = _card_inner_html(card)
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        f'<style>{css}</style></head>'
        f'<body><div class="{card_class}">{body}</div></body></html>'
    )


# ---------------------------------------------------------------------------
# Planner
# ---------------------------------------------------------------------------


@dataclass
class PlannedCard:
    start: float
    end: float
    line: str
    layout: str
    asset: str
    raw: dict


def _request_plan(transcript: dict) -> dict:
    import anthropic

    words = transcript.get("words", [])
    duration = float(transcript.get("duration_cut", 0)) or (
        max((float(w["end"]) for w in words), default=0.0)
    )

    payload = {
        "duration_s": round(duration, 2),
        "words": [
            {"i": i, "t": round(float(w["start"]), 2), "w": w["word"]}
            for i, w in enumerate(words)
        ],
    }

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=PLANNER_MODEL,
        max_tokens=4096,
        system=_build_system_prompt(),
        messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
    )
    text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].lstrip()
    return json.loads(text)


def _slug_for_card(c: dict, layout: str) -> str:
    """Pick a stable slug from per-layout fields for the asset filename."""
    fields = c.get("fields", {}) if isinstance(c.get("fields"), dict) else {}
    slug_source = (
        fields.get("headline")
        or fields.get("label")
        or fields.get("header")
        or fields.get("wordmark_main")
        or fields.get("quote")
        or c.get("line")
        or layout
    )
    slug = re.sub(r"[^a-z0-9]+", "-", str(slug_source).lower()).strip("-")[:40]
    return slug or layout


def _normalise_cards(parsed: dict, max_t: float, *, cinematic: bool) -> list[PlannedCard]:
    raw_cards = parsed.get("cards", []) if isinstance(parsed, dict) else []
    cards: list[PlannedCard] = []

    for i, c in enumerate(raw_cards):
        try:
            s = float(c["start_s"])
            e = float(c["end_s"])
        except (KeyError, ValueError, TypeError):
            continue
        layout = c.get("layout", "statement")
        if layout not in ALL_LAYOUTS:
            layout = "statement"
        # When --no-cinematic is on, downgrade cinematic-only layouts to a
        # text-first equivalent so the legacy renderer can handle them.
        if not cinematic and layout in CINEMATIC_LAYOUTS:
            layout = {
                "counter": "statement_sub",
                "chart_line": "statement_sub",
                "network": "stack",
                "logo_glow": "statement_sub",
                "comparison": "statement_sub",
                "big_quote": "statement",
            }.get(layout, "statement")

        # Clamp duration to the allowed window.
        dur = max(MIN_DURATION, min(MAX_DURATION, e - s))
        e = s + dur
        if e > max_t - 0.05:
            e = max_t - 0.05
            if e - s < MIN_DURATION:
                continue
        s = round(max(s, 0.0), 3)
        e = round(e, 3)
        if e <= s:
            continue

        slug = _slug_for_card(c, layout)
        # Asset extension by layout family:
        #   - cinematic / simple: .mov (ProRes 4444 yuva444p12le, alpha preserved)
        #   - website_capture: .mp4 (opaque, full-frame cut — replaces base
        #     during the item window, not an alpha overlay)
        ext = ".mp4" if layout in WEBSITE_LAYOUTS else ".mov"
        asset = f"broll/{i + 1:02d}-{slug}{ext}"
        cards.append(PlannedCard(start=s, end=e, line=str(c.get("line", ""))[:200],
                                 layout=layout, asset=asset, raw=c))

    # Drop overlaps: keep the earlier card, skip any that would intersect.
    cards.sort(key=lambda c: c.start)
    deduped: list[PlannedCard] = []
    for c in cards:
        if deduped and c.start < deduped[-1].end + 0.10:
            continue
        deduped.append(c)
    return deduped


_CTA_TRIGGER_RE = re.compile(
    r"(?i)\b(?:dm|comment|send|message)\b\s+(?:me\s+|us\s+)?"
    r"(?:below\s+|the\s+word\s+|me\s+the\s+word\s+)?([A-Za-z][A-Za-z0-9]{2,30})"
)


def _ensure_cta_card(cards: list, transcript: dict, duration: float) -> list:
    """Deterministically guarantee a closing CTA beat with the one-word keyword.

    The planner LLM is unreliable about emitting the CTA card (the funnel
    mechanic), so if the transcript tail contains a "DM/comment <word>" CTA and
    no cta card exists, append one timed over the closing line. The on-screen
    keyword is forced to a single token via reel_templates.one_word."""
    if any(getattr(c, "layout", None) == "cta" for c in cards):
        return cards
    words = transcript.get("words", [])
    if not words:
        return cards
    tail = words[-40:]
    m = _CTA_TRIGGER_RE.search(" ".join(w.get("word", "") for w in tail))
    if not m:
        return cards
    keyword = reel_templates.one_word(m.group(1))
    if len(keyword) < 3:
        return cards

    end = min(float(tail[-1]["end"]), duration - 0.05)
    trig = m.group(0).split()[0].strip(".,!?").lower()
    start = end - MAX_DURATION
    for w in tail:
        if w.get("word", "").strip(".,!?").lower() == trig and float(w["start"]) < end:
            start = float(w["start"])
            break
    if cards:
        start = max(start, cards[-1].end + 0.10)
    start = max(start, 0.0)
    if end - start < MIN_DURATION:
        start = max(0.0, end - MIN_DURATION)
    if end - start < MIN_DURATION:
        return cards  # no room to place it

    idx = len(cards) + 1
    cards.append(PlannedCard(
        start=round(start, 3), end=round(end, 3),
        line="DM me the word below", layout="cta",
        asset=f"broll/{idx:02d}-cta-{keyword.lower()}.mov",
        raw={"fields": {
            "headline": "DM me the word below",
            "sub": "I'll send you the full system.",
            "pulse_word": keyword,
        }},
    ))
    print(f"[broll-plan]   + injected CTA beat ({start:.2f}-{end:.2f})  keyword={keyword}")
    return cards


def plan_broll(folder: Path, *, refresh: bool = False, cinematic: bool = True) -> dict:
    """Stage 1: pick beats + assign layouts. Writes broll-plan.json.

    For each card:
      - cinematic=True:  asset is `broll/NN-<slug>.webm` — the eventual
                         HyperFrames-rendered output. Stage 2 will write the
                         composition folder + run the renderer.
      - cinematic=False: asset is `broll/NN-<slug>.mov` — Stage 2 is skipped;
                         `render_cards()` (legacy) generates the HTML and runs
                         broll_animator.render().

    Returns the plan_doc. Reuses cached LLM response unless `refresh=True`.
    """
    transcript_path = folder / "transcript.json"
    if not transcript_path.exists():
        raise SystemExit(f"No transcript.json in {folder}; run `cut` first.")
    transcript = json.loads(transcript_path.read_text())
    if not transcript.get("words"):
        raise SystemExit("transcript.json has no words; nothing to plan against.")

    plan_path = folder / "broll-plan.json"
    cache_path = folder / "broll-plan-llm.json"

    parsed: dict | None = None
    if cache_path.exists() and not refresh:
        try:
            parsed = json.loads(cache_path.read_text())
            print(f"[broll-plan] using cached LLM plan ({cache_path.name})")
        except Exception:
            parsed = None

    if parsed is None:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise SystemExit("ANTHROPIC_API_KEY missing — cannot plan broll")
        print(f"[broll-plan] asking {PLANNER_MODEL} to pick beats + layouts...")
        parsed = _request_plan(transcript)
        cache_path.write_text(json.dumps(parsed, indent=2))

    duration = float(transcript.get("duration_cut", 0)) or max(
        (float(w["end"]) for w in transcript["words"]), default=0.0
    )
    cards = _normalise_cards(parsed, max_t=duration, cinematic=cinematic)
    cards = _ensure_cta_card(cards, transcript, duration)

    plan_doc = {
        "notes": parsed.get("notes", "") if isinstance(parsed, dict) else "",
        "model": PLANNER_MODEL,
        "cinematic": cinematic,
        "captions": True,
        "items": [
            {
                "start": c.start,
                "end": c.end,
                "asset": c.asset,
                "line": c.line,
                "layout": c.layout,
                "fields": c.raw.get("fields", {}),
            }
            for c in cards
        ],
    }
    plan_path.write_text(json.dumps(plan_doc, indent=2))
    print(f"[broll-plan] {len(cards)} cards → {plan_path.name}  (cinematic={cinematic})")
    for c in cards:
        print(f"[broll-plan]   {c.start:6.2f}-{c.end:6.2f}  {c.layout:13s}  {Path(c.asset).stem}")
    return plan_doc


# ===========================================================================
# Stage 2 — cinematic per-card composition design via Sonnet 4.6 + HyperFrames
# ===========================================================================


CINEMATIC_DESIGN_PROMPT = """You are a senior motion-graphics designer producing one cinematic B-roll card for a Skalers.io vertical short-form reel. The card will render to a transparent .webm via HyperFrames CLI and composite over a talking-head iPhone recording.

OUTPUT
Return ONLY a JSON object — no preamble, no markdown — in this exact shape:
{
  "compositionId": "<kebab-case-slug, ≤32 chars>",
  "html": "<COMPLETE self-contained HTML document, including the <!doctype>, fonts link, GSAP <script> tag, all CSS in a <style> tag, and the inline <script> that registers window.__timelines>",
  "rationale": "60–120 word designer's note: which easing curves you used, total stagger budget, what each animation choice does. ALSO confirm: every animation ≤ 400ms (or which one is the hero exception), all easing in the 5 allowed curves, no width/height/top/left animated, glow uses 3-layer drop-shadow with opacity-only animation."
}

NON-NEGOTIABLE CONSTRAINTS
1. Canvas: 1080×1920, alpha background (`background: transparent` on body, never set a body bg color).
2. Safe-zone: card content fits inside y ∈ [1020, 1700]. Face is in the upper half of the frame — DO NOT cover y < 960. The card chrome itself can sit at top: 1020 (tall card 680px) or top: 1180 (small card 280px).
3. Brand tokens (skalers.io/brand — use these EXACT values):
   - Card fill: rgba(34, 34, 34, 0.88)        // Ink #222 at 88% over a hairline
   - Card border: 1px solid #3a3a3a            // Hairline (brand spec). NO 2px gold borders.
   - Card border-radius: 8px                   // BRAND: 8px exactly. NEVER 24/28.
   - Card backdrop-filter: blur(8px)
   - Gold accent (the system anchor): #f8d380
   - Text white: #ffffff, muted: rgba(255, 255, 255, 0.7)
   - Card MUST have `overflow: hidden`
   - Card POSITIONING: anchor to BOTTOM, NOT top. Use this exact pattern:
       position: absolute;
       left: 80px; right: 80px;     /* width derived = 920px */
       bottom: 220px;               /* anchor at y=1700, the bottom of the safe-zone */
       height: auto;                /* card grows up only as far as content needs */
       min-height: <see below>;     /* per layout, see #3b */
       max-height: 680px;           /* never push higher than y=1020 */
   NEVER set `top:` on the card. NEVER set a fixed `height`. Short content = short card = face stays maximally visible above.
3b. Per-layout min-height (so visual-heavy layouts have room to breathe):
   - counter, chart_line, network: min-height: 620px   (chart/hex needs vertical room)
   - logo_glow: min-height: 460px                       (wordmark + tagline)
   - comparison: min-height: 380px                      (split panel)
   - big_quote: min-height: 280px                       (typography only)
   - statement, statement_sub, stack, cta: min-height: 220px (tight text cards)
4. Fonts (Google Fonts — use this exact link):
   <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
   - Display (hero, banner text, big numbers, headline): "Archivo Black", weight 900, sizes 64–132px
   - Sub-display (eyebrow labels, CTA buttons, all-caps category labels): "Poppins", weight 700, sizes 18–28px, letter-spacing 0.18–0.22em
   - Body (subtitles, paragraph copy, axis labels): "Inter", weights 400/500/600 — 400 paragraphs, 500 emphasis, 600 inline labels — sizes 22–36px
   - body { font-family: "Inter", system-ui, sans-serif; } as the default; switch to Archivo Black or Poppins explicitly per element.
5. NEVER use em dashes (—) ANYWHERE. Use commas, periods, or colons instead. The brand has zero tolerance for em dashes.
6. Brand vocabulary bans (NEVER use):
   - "rung" → use "milestone"
   - "quick" (quick question / call / favor) → use "fast" or omit
   - "7-9 figure" → say "$1M-$100M businesses"
   - Don't claim 7-figure status for the speaker; he is at 6 scaling to 7
   - Don't call Skalers a "coaching program", "agency", or "mastermind"
7. Brand vocabulary KEEP (always full caps): SCALING, SMART, the SCALING System, 7 Systems, 4Ws, Skalers.io
8. The 7 SCALING letters: S (SMART Offer), C (Conversion), A (Attention), L (Leads), I (Implementation), N (Nurture), G (Growth)
9. Composition contract — REQUIRED:
   - Root: `<div id="root" data-composition-id="main" data-start="0" data-duration="{duration_s}" data-width="1080" data-height="1920">`
   - The card div MUST have `class="clip"` and `data-start="0" data-duration="{duration_s}" data-track-index="1"`
   - Register a single paused GSAP timeline on `window.__timelines["main"]`
   - GSAP global is loaded via `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>` in <head>
10. Easing — ONLY these 5 curves (no exceptions):
    - Standard: cubic-bezier(0.4, 0, 0.2, 1)
    - Deceleration / entrance: cubic-bezier(0, 0, 0.2, 1)
    - Acceleration / exit: cubic-bezier(0.4, 0, 1, 1)
    - Sharp: cubic-bezier(0.4, 0, 0.6, 1)
    - Overshoot (typography only): cubic-bezier(0.34, 1.56, 0.64, 1)
11. Per-element duration ≤ 400 ms. Stagger 60–80 ms. Total stagger budget ≤ 400 ms.
    ONE hero element (chart line draw, mask reveal, etc.) MAY exceed 400ms (up to 900ms). Call it out explicitly in your `rationale`.
12. Animate ONLY: opacity, transform, filter, clip-path, stroke-dashoffset, CSS custom-properties. NEVER animate width, height, top, left, margin, padding.
13. Glow: stack 3 drop-shadow filters (8/18/36 px radii at the gold accent). Animate opacity of the parent group via a `.glow` class snap-on (or a 2-step fade-in tween), NOT the radii.
14. Number counters: listen to the `hf-seek` event on `window` and read `window.__timelines.main.time()` inside the handler to update textContent. DO NOT call `requestAnimationFrame` directly. It runs on wall-clock time, not the seekable HyperFrames timeline, and will desync during render. The pattern:
    ```
    function paintCounter() {
      const t = (window.__timelines.main && window.__timelines.main.time)
        ? window.__timelines.main.time() : 0;
      // compute u from t, update textContent
    }
    window.addEventListener("hf-seek", paintCounter);
    paintCounter();
    ```
15. SVG line draw: `stroke-dasharray = path.getTotalLength()`, animate `stroke-dashoffset` from path-length → 0.
16. SVG scale animations are FORBIDDEN: GSAP bypasses CSS `transform-box: fill-box` and scales SVG elements around the viewBox centre, not the element's own centre. Use opacity-only on SVG, or wrap the SVG element in an HTML div and animate the div.
17. CSS `transform: translate(-50%, -50%)` on a GSAP-animated element is FORBIDDEN: GSAP overwrites the entire transform property. Instead, do `gsap.set(".node", { xPercent: -50, yPercent: -50, y: <initial> })` BEFORE the timeline.
18. Contrast: gold text on dark backdrop only. NEVER place gold text on white. Headline white > 4.5:1 against the card fill.
19. NO external CDN imports beyond Google Fonts (Archivo Black + Inter + Poppins) and the GSAP script tag.
20. Hold phase silent: after the entrance/reveal completes, the primary content does not move. Decoration shimmers may loop with finite `animation-iteration-count`, never infinite.

CINEMATIC DESCRIPTOR ANCHORS (design intent — these elevate output meaningfully)
- "weighty inertia" → asymmetric easing; deceleration on entrance shorter than acceleration on exit
- "atmospheric depth" → layered opacity (background grid 0.04, midground accent 0.12, foreground 1.0)
- "practical light source" → glow originates from a single anchor element
- "kinetic confidence" → overshoot easing on the keyword, hard stop on the rest
- "dolly stillness" → no continuous loops during hold; hold is silent

ANTI-PATTERNS — REJECT YOUR OWN OUTPUT IF
- Any em dash (—) anywhere in any text content. Use commas, periods, or colons.
- Any banned vocabulary: "rung", "quick", "7-9 figure", or claims of 7-figure status.
- Any non-hero animation > 500 ms.
- Any easing outside the 5 curves listed.
- Any `width`, `height`, `top`, `left`, `margin`, `padding` in @keyframes or GSAP tweens.
- Any card border-radius other than 8px.
- Any 2px gold border on cards. Use 1px hairline `#3a3a3a`.
- Any "Poppins" weight 800 or 900 for headlines. Headlines = Archivo Black 900.
- Any text on white that isn't dark.
- Any `:hover` or async state.
- Any `<script src>` to an unspecified CDN.
- Any "fade in 0% to 100%" without easing.
- CSS `translate(-50%, -50%)` on a GSAP-animated element.

REFERENCE EXAMPLES — these are the QUALITY BAR. Match this rigour.
The references are full hand-authored HyperFrames compositions. Use the one whose layout matches your `layout` field as the structural anchor; extrapolate to other layouts as needed.

<reference id="counter">
{REFERENCE_COUNTER}
</reference>

<reference id="network">
{REFERENCE_NETWORK}
</reference>

<reference id="logo_glow">
{REFERENCE_LOGO_GLOW}
</reference>

CRITIQUE GATE
Before returning, re-read your output and confirm in `rationale`:
- ZERO em dashes anywhere in HTML text content?
- Card border-radius is 8px (not 24/28)?
- Card border is 1px solid #3a3a3a hairline (not 2px gold)?
- Headlines use Archivo Black 900 (not Poppins)?
- Body text uses Inter (not Poppins)?
- Every animation duration ≤ 400 ms (or list the ONE hero exception)?
- Every easing in the allowed set?
- Total stagger budget ≤ 400 ms?
- Hold phase silent on the primary content?
- Glow uses 3-layer drop-shadow with opacity-only animation?
- No SVG scale animations?
- No CSS translate(-50%, -50%) on GSAP-animated elements?
- No banned vocabulary ("rung", "quick", "7-9 figure", 7-figure claims)?

If any answer fails, regenerate before returning.

Generate now."""


@lru_cache(maxsize=1)
def _load_references() -> dict[str, str]:
    """Load the 3 hand-authored reference HTMLs into memory once."""
    refs = {}
    for name in ("counter", "network", "logo_glow"):
        p = REFERENCES_DIR / name / "index.html"
        if not p.exists():
            raise SystemExit(f"Missing reference card: {p}. Re-author it before running cinematic broll.")
        refs[name] = p.read_text(encoding="utf-8")
    return refs


def _build_design_prompt(duration_s: float) -> str:
    refs = _load_references()
    return (
        CINEMATIC_DESIGN_PROMPT
        .replace("{duration_s}", f"{duration_s:.2f}")
        .replace("{REFERENCE_COUNTER}", refs["counter"])
        .replace("{REFERENCE_NETWORK}", refs["network"])
        .replace("{REFERENCE_LOGO_GLOW}", refs["logo_glow"])
    )


def design_card(beat: dict) -> dict:
    """Stage 2: per-card cinematic design call.

    Input  : a single item from broll-plan.json (start, end, line, layout, fields).
    Output : { compositionId, html, rationale }.
    Caller is responsible for caching + writing the composition to disk.
    """
    import anthropic

    duration_s = float(beat["end"]) - float(beat["start"])
    user_payload = {
        "spoken_line": beat.get("line", ""),
        "card_duration_s": round(duration_s, 2),
        "layout": beat.get("layout"),
        "layout_fields": beat.get("fields", {}),
        "reel_position_role": beat.get("role", "middle"),
    }

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=PLANNER_MODEL,
        max_tokens=8192,
        system=_build_design_prompt(duration_s),
        messages=[{"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)}],
    )
    text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].lstrip()
    parsed = json.loads(text)
    if not isinstance(parsed, dict) or "html" not in parsed:
        raise RuntimeError(f"design_card returned malformed JSON: keys={list(parsed) if isinstance(parsed, dict) else type(parsed)}")
    return parsed


# ---------------------------------------------------------------------------
# Composition folder I/O + HyperFrames CLI invocation
# ---------------------------------------------------------------------------


_HYPERFRAMES_JSON = (
    '{\n'
    '  "$schema": "https://hyperframes.heygen.com/schema/hyperframes.json",\n'
    '  "registry": "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",\n'
    '  "paths": {\n'
    '    "blocks": "compositions",\n'
    '    "components": "compositions/components",\n'
    '    "assets": "assets"\n'
    '  }\n'
    '}\n'
)


def _composition_dir_for(folder: Path, asset: str) -> Path:
    """Compositions live alongside the rendered .webm:
       <folder>/broll/NN-<slug>.webm   (rendered output)
       <folder>/broll/NN-<slug>/       (composition source: hyperframes.json + index.html)
    """
    asset_path = folder / asset
    return asset_path.with_suffix("")


def write_composition_folder(folder: Path, item: dict, design: dict) -> Path:
    """Write hyperframes.json + index.html for one card. Returns the comp dir."""
    comp_dir = _composition_dir_for(folder, item["asset"])
    comp_dir.mkdir(parents=True, exist_ok=True)
    (comp_dir / "hyperframes.json").write_text(_HYPERFRAMES_JSON, encoding="utf-8")
    (comp_dir / "index.html").write_text(design["html"], encoding="utf-8")
    rationale = design.get("rationale", "")
    if rationale:
        (comp_dir / "rationale.txt").write_text(rationale, encoding="utf-8")
    return comp_dir


def _hf_lint(comp_dir: Path) -> tuple[bool, str]:
    """Run `hyperframes lint`. Returns (ok, output).

    Treats WARNINGS as non-fatal (the CLI exits 0 on warnings; only true
    errors should fail the gate). Hyperframes prints e.g. `0 error(s), 2 warning(s)`.

    Runs with cwd=REEL_PIPELINE_DIR so HF can walk up and find its own
    `node_modules/hyperframes/dist/hyperframe.manifest.json` runtime artifact.
    Without this, on Modal where comp_dir lives at /tmp/, HF can't find its
    runtime and falls back to a dev-only `../../../core/dist/...` path that
    doesn't exist in production.
    """
    if not HF_BIN.exists():
        return False, f"HyperFrames CLI not installed at {HF_BIN}. Run npm install in reel_pipeline/."
    proc = subprocess.run(
        [str(HF_BIN), "lint", str(comp_dir)],
        cwd=str(REEL_PIPELINE_DIR),
        capture_output=True, text=True, timeout=60,
    )
    out = proc.stdout + proc.stderr
    # The lint exits 0 on pass + warnings; non-zero only on actual errors.
    return proc.returncode == 0, out


def _hf_render(comp_dir: Path, output_mov: Path) -> tuple[bool, str]:
    """Run `hyperframes render --format mov` for alpha-preserved ProRes 4444.

    `--format webm` advertises transparency but actually outputs yuv420p (no
    alpha) in HyperFrames 0.5.3. ProRes 4444 (yuva444p12le) reliably carries
    alpha through ffmpeg's overlay chain.
    """
    if not HF_BIN.exists():
        return False, f"HyperFrames CLI not installed at {HF_BIN}."
    output_mov.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            str(HF_BIN), "render", str(comp_dir),
            "--format", "mov",
            "--quality", "high",
            "--output", str(output_mov),
            "--quiet",
        ],
        cwd=str(REEL_PIPELINE_DIR),
        capture_output=True, text=True, timeout=300,
    )
    out = proc.stdout + proc.stderr
    return (proc.returncode == 0 and output_mov.exists()), out


def _render_template_item(folder: Path, item: dict) -> tuple[bool, str]:
    """Render one beat from a hand-authored reel_templates layout to its alpha
    .mov asset. Deterministic — no LLM, no lint, no downgrade. This is what
    replaced the fragile LLM-writes-HTML path that once shipped blank overlays."""
    layout = item["layout"]
    dur = float(item["end"]) - float(item["start"])
    comp_dir = write_composition_folder(folder, item, {
        "html": reel_templates.render_template_html(
            layout, item.get("fields", {}) or {}, dur, CANVAS_W, CANVAS_H),
    })
    return _hf_render(comp_dir, folder / item["asset"])


def design_and_render_compositions(folder: Path, *, refresh: bool = False) -> dict:
    """Stage 2 + 3 + 4: per-card design via LLM → composition folder → lint → render.

    Iterates broll-plan.json items where layout ∈ CINEMATIC_LAYOUTS. For each:
      1. Cache hit? (composition folder exists with index.html newer than plan)
      2. design_card() → write_composition_folder()
      3. lint → if fails, downgrade card to legacy layout + .mov asset, log
      4. render → output .webm at <folder>/broll/NN-<slug>.webm

    Returns a summary dict { rendered: N, downgraded: N, errors: N }.
    """
    plan_path = folder / "broll-plan.json"
    if not plan_path.exists():
        raise SystemExit(f"No broll-plan.json in {folder}; run plan_broll first.")
    plan = json.loads(plan_path.read_text())
    items = plan.get("items", [])
    if not items:
        return {"rendered": 0, "downgraded": 0, "errors": 0}

    summary = {"rendered": 0, "cached": 0, "downgraded": 0, "errors": 0}
    plan_changed = False

    for idx, item in enumerate(items):
        layout = item.get("layout")
        asset_path = folder / item["asset"]

        # Hand-authored templates (reel_templates) — deterministic, brand-locked,
        # always render. Replaces the fragile LLM-writes-HTML path for these
        # layouts (a malformed timeline once shipped a fully transparent overlay
        # = the 2026-06 "no motion graphics" incident).
        if layout in reel_templates.LAYOUTS:
            print(f"[broll-template] {asset_path.name}  ({layout}, {item['end'] - item['start']:.2f}s)")
            ok, render_out = _render_template_item(folder, item)
            if ok:
                summary["rendered"] += 1
            else:
                # FAIL LOUD — never silently ship a beat with no motion graphic.
                summary["errors"] += 1
                print(f"[broll-template]   RENDER FAILED for {asset_path.name}:")
                for line in render_out.strip().splitlines()[-15:]:
                    print(f"[broll-template]     {line}")
            continue

        if layout not in CINEMATIC_LAYOUTS:
            continue  # legacy items handled by render_cards()

        comp_dir = _composition_dir_for(folder, item["asset"])
        index_html = comp_dir / "index.html"

        # Cache: if both the composition source and rendered .webm exist, and
        # the .webm is newer than index.html, skip everything.
        if (
            asset_path.exists()
            and index_html.exists()
            and asset_path.stat().st_mtime >= index_html.stat().st_mtime
            and not refresh
        ):
            print(f"[broll-design] cached {asset_path.name}")
            summary["cached"] += 1
            continue

        # If the composition source is missing or stale, ask the LLM.
        if not index_html.exists() or refresh:
            print(f"[broll-design] designing card {idx + 1}/{len(items)}  ({layout}, {item['end'] - item['start']:.2f}s)")
            try:
                design = design_card(item)
            except Exception as e:
                print(f"[broll-design]   LLM design failed: {e}")
                _downgrade_to_legacy(item, idx, folder, summary)
                plan_changed = True
                continue
            write_composition_folder(folder, item, design)
            print(f"[broll-design]   wrote {comp_dir.relative_to(folder)}/index.html")

        # Lint
        ok, lint_out = _hf_lint(comp_dir)
        if not ok:
            print(f"[broll-design]   lint FAILED for {comp_dir.name}:")
            for line in lint_out.strip().splitlines()[:20]:
                print(f"[broll-design]     {line}")
            _downgrade_to_legacy(item, idx, folder, summary)
            plan_changed = True
            continue

        # Render
        print(f"[broll-render] {asset_path.name}")
        ok, render_out = _hf_render(comp_dir, asset_path)
        if not ok:
            print(f"[broll-render]   render FAILED for {comp_dir.name}:")
            for line in render_out.strip().splitlines()[-15:]:
                print(f"[broll-render]     {line}")
            _downgrade_to_legacy(item, idx, folder, summary)
            plan_changed = True
            continue

        summary["rendered"] += 1

    if plan_changed:
        plan_path.write_text(json.dumps(plan, indent=2))
        print("[broll-design] broll-plan.json updated with downgrades")

    return summary


def _downgrade_to_legacy(item: dict, idx: int, folder: Path, summary: dict) -> None:
    """Convert a cinematic card to a legacy text card and let render_cards() handle it.

    Mutates `item` in-place: changes layout to a simple equivalent and asset
    extension from .webm to .mov. Synthesises rough headline/sub fields from
    the cinematic fields so the legacy renderer has something to work with.
    """
    fields = item.get("fields", {}) or {}
    original_layout = item.get("layout")
    legacy_map = {
        "counter": "statement_sub",
        "chart_line": "statement_sub",
        "network": "stack",
        "logo_glow": "statement_sub",
        "comparison": "statement_sub",
        "big_quote": "statement",
    }
    item["layout"] = legacy_map.get(original_layout, "statement")

    # Synthesise legacy fields from cinematic fields. The legacy renderer reads
    # them directly off the item dict (not nested in `fields`).
    if original_layout == "counter":
        prefix = fields.get("value_prefix", "")
        target = fields.get("value_target", "")
        suffix = fields.get("value_suffix", "")
        item["headline"] = f"{prefix}{target}{suffix}".strip() or fields.get("label", "")
        item["sub"] = fields.get("timeframe", "")
        item["gold"] = item["headline"]
    elif original_layout == "chart_line":
        item["headline"] = fields.get("headline", "")
        item["sub"] = fields.get("sub", "")
        item["gold"] = fields.get("gold")
    elif original_layout == "network":
        item["label"] = fields.get("header", "7 SCALING SYSTEMS")
        item["rows"] = fields.get("outer_labels", []) or [fields.get("hub_label", "S")]
        item["footer"] = fields.get("footer", "")
        item["gold"] = fields.get("footer_gold")
    elif original_layout == "logo_glow":
        main = fields.get("wordmark_main", "")
        accent = fields.get("wordmark_accent", "")
        item["headline"] = f"{main}{accent}".strip()
        line1 = fields.get("tagline_line1", "")
        line2 = fields.get("tagline_line2", "")
        item["sub"] = (line1 + " " + line2).strip()
        item["gold"] = fields.get("gold_in_tagline")
    elif original_layout == "comparison":
        item["headline"] = fields.get("right_label", "") + ": " + fields.get("right_text", "")
        item["sub"] = fields.get("left_label", "") + ": " + fields.get("left_text", "")
    elif original_layout == "big_quote":
        item["headline"] = fields.get("quote", "")
        item["gold"] = fields.get("key_word")

    # Asset extension stays .mov; render_cards now discriminates by layout name.
    print(f"[broll-design]   downgraded {original_layout} → {item['layout']} (asset {item['asset']})")
    summary["downgraded"] += 1


# ===========================================================================
# Stage 4 (legacy) — html → .mov via broll_animator (used for simple layouts
# AND cinematic-downgrade fallbacks). Untouched from previous version.
# ===========================================================================


def render_cards(folder: Path, *, refresh: bool = False) -> int:
    """Render each LEGACY card to an alpha .mov via broll_animator.render().

    Only operates on items whose layout is in SIMPLE_LAYOUTS. Cinematic items
    go through `design_and_render_compositions()`; website items go through
    `render_website_captures()`.
    """
    from broll_animator import render as render_mov

    plan_path = folder / "broll-plan.json"
    if not plan_path.exists():
        raise SystemExit(f"No broll-plan.json in {folder}; run plan_broll first.")
    plan = json.loads(plan_path.read_text())
    items = plan.get("items", [])
    if not items:
        print("[broll-render] plan has no items — nothing to render")
        return 0

    rendered = 0
    for item in items:
        layout = item.get("layout", "statement")
        if layout in CINEMATIC_LAYOUTS or layout in WEBSITE_LAYOUTS:
            continue  # handled by other dispatch functions
        asset = folder / item["asset"]
        duration = float(item["end"]) - float(item["start"])

        # Hand-authored template layouts are normally rendered by the cinematic
        # pass; this is the safety net for cinematic=False runs (render here if
        # the asset is still missing) so they never silently drop out.
        if layout in reel_templates.LAYOUTS:
            # Already rendered by the cinematic pass (design_and_render_compositions);
            # only render here as a safety net for cinematic=False runs.
            if asset.exists():
                continue
            print(f"[broll-template] {asset.name}  ({layout}, {duration:.2f}s)")
            ok, _out = _render_template_item(folder, item)
            if ok:
                rendered += 1
            continue

        # Generate the HTML in a sibling .html file so broll_animator (which
        # takes a path, not a string) has something to read. Cache by mtime.
        html_path = asset.with_suffix(".html")
        html = render_card_html(item, duration=duration)
        html_path.write_text(html, encoding="utf-8")

        if (
            asset.exists()
            and asset.stat().st_mtime >= html_path.stat().st_mtime
            and not refresh
        ):
            print(f"[broll-render] cached {asset.name}")
            continue

        print(f"[broll-render] {asset.name} ({duration:.2f}s)  legacy {item.get('layout')}")
        render_mov(html_path, asset, duration)
        rendered += 1
    return rendered


# ===========================================================================
# Website capture — Playwright screenshot + Ken Burns full-frame .mp4
# ===========================================================================


def render_website_captures(folder: Path, *, refresh: bool = False) -> int:
    """Generate the website-capture .mp4 for each `website_capture` item in
    the plan. The asset is a 1080×1920 opaque MP4 that `cmd_render` treats as
    a full-frame cut (replaces the talking head for the item's window).
    """
    plan_path = folder / "broll-plan.json"
    if not plan_path.exists():
        raise SystemExit(f"No broll-plan.json in {folder}; run plan_broll first.")
    plan = json.loads(plan_path.read_text())
    items = plan.get("items", [])
    if not items:
        return 0

    rendered = 0
    for item in items:
        if item.get("layout") not in WEBSITE_LAYOUTS:
            continue
        fields = item.get("fields", {}) or {}
        url = fields.get("url") or ""
        if not url:
            print(f"[website-capture] skip {item.get('asset')!r} — no url field")
            continue
        asset = folder / item["asset"]
        duration = max(2.5, min(5.0, float(item["end"]) - float(item["start"])))
        if asset.exists() and not refresh:
            print(f"[website-capture] cached {asset.name}")
            continue
        try:
            from website_capture import capture_website
            capture_website(url, asset, duration_s=duration, refresh=refresh)
            rendered += 1
        except Exception as e:
            import traceback
            print(f"[website-capture] FAILED for {url}: {e}")
            print(traceback.format_exc())
    return rendered


# ===========================================================================
# Top-level orchestrator — used by reel_editor.py cmd_pipeline
# ===========================================================================


def plan_design_render(folder: Path, *, refresh: bool = False, cinematic: bool = True) -> dict:
    """End-to-end Stage 1 → 2 → 3 → 4 for a folder containing transcript.json.

    cinematic=True  : Stage 1 selects from all 10 layouts; cinematic layouts go
                      through the LLM design call + HyperFrames CLI render;
                      simple layouts go through the legacy broll_animator path.
    cinematic=False : Stage 1 only picks from the 4 simple layouts; everything
                      renders through broll_animator.

    Returns a summary dict.
    """
    plan_broll(folder, refresh=refresh, cinematic=cinematic)
    summary = {"cinematic_rendered": 0, "cinematic_cached": 0, "downgraded": 0,
               "legacy_rendered": 0, "website_rendered": 0, "errors": 0}
    if cinematic:
        cinematic_summary = design_and_render_compositions(folder, refresh=refresh)
        summary["cinematic_rendered"] = cinematic_summary.get("rendered", 0)
        summary["cinematic_cached"] = cinematic_summary.get("cached", 0)
        summary["downgraded"] = cinematic_summary.get("downgraded", 0)
        summary["errors"] = cinematic_summary.get("errors", 0)
    summary["legacy_rendered"] = render_cards(folder, refresh=refresh)
    summary["website_rendered"] = render_website_captures(folder, refresh=refresh)
    print(
        f"[broll] done. cinematic rendered={summary['cinematic_rendered']} "
        f"(cached {summary['cinematic_cached']}, downgraded {summary['downgraded']}); "
        f"legacy rendered={summary['legacy_rendered']}; "
        f"website rendered={summary['website_rendered']}"
    )
    return summary
