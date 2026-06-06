"""Hand-authored, world-class motion-graphic templates for reel b-roll overlays.

Replaces the old approach where an LLM wrote per-beat HTML+GSAP on the fly (a
single unregistered timeline or malformed selector silently produced a fully
transparent clip — the 2026-06 "no motion graphics" incident). Each layout here
is a fixed, brand-locked HyperFrames composition; the LLM only supplies the text
fields in broll-plan.json. Output is deterministic and always renders.

Authoring contract (matches reel_pipeline/references/*/index.html):
  - #root carries data-composition-id="main" + data-start/duration/width/height
  - the visible card is `.card.clip` with data-start/duration/data-track-index
  - a paused GSAP timeline is registered at window.__timelines["main"]
  - transparent background (alpha .mov overlay), bottom-anchored, face kept clear

Brand (skalers.io/brand): Archivo Black 900 display, Poppins 700 sub, Inter body,
Ink #222 card @ 88%, hairline #3a3a3a, radius 8px, single gold #f8d380.

Public API:
  render_template_html(layout, fields, duration, width=1080, height=1920) -> str
  LAYOUTS  (the set this module renders)
  one_word(text) -> str   (Instagram keyword rule: keywords are ALWAYS one word)
"""
from __future__ import annotations

import html as _html
import re

GOLD = "#f8d380"
LAYOUTS = ("big_quote", "comparison", "stack", "counter", "cta",
           "statement_sub", "statement")


def esc(v) -> str:
    return _html.escape(str(v if v is not None else ""), quote=True)


def one_word(text: str) -> str:
    """Instagram comment-to-DM keywords are ALWAYS a single word.
    'Content OS' -> 'CONTENTOS'. Strips spaces/punctuation, uppercases."""
    if not text:
        return ""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", str(text))
    return cleaned.upper()


# ── Shared head + base CSS ──────────────────────────────────

_BASE_CSS = """
* { margin:0; padding:0; box-sizing:border-box; }
html, body {
  width:%(W)dpx; height:%(H)dpx; overflow:hidden; background:transparent;
  font-family:"Inter",system-ui,sans-serif; -webkit-font-smoothing:antialiased; color:#fff;
}
/* Card anchored to bottom safe-zone; grows up, capped so the face stays clear. */
.card {
  position:absolute; left:80px; right:80px; bottom:230px;
  padding:46px 52px; background:rgba(34,34,34,0.90); backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px); border:1px solid #3a3a3a; border-radius:8px;
  box-shadow:0 24px 80px rgba(0,0,0,0.45);
  opacity:0; transform:translateY(48px);
}
.eyebrow {
  font-family:"Poppins",system-ui,sans-serif; font-size:24px; font-weight:700;
  letter-spacing:0.22em; text-transform:uppercase; color:rgba(255,255,255,0.62);
}
.gold { color:%(GOLD)s; }
.glow {
  filter:drop-shadow(0 0 10px rgba(248,211,128,0.55))
         drop-shadow(0 0 26px rgba(248,211,128,0.28))
         drop-shadow(0 0 52px rgba(248,211,128,0.14));
}
""".strip()


def _doc(width: int, height: int, extra_css: str, body: str, timeline_js: str,
         duration: float) -> str:
    base_css = _BASE_CSS % {"W": width, "H": height, "GOLD": GOLD}
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width={width}, height={height}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap" rel="stylesheet" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
{base_css}
{extra_css}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{duration:.2f}" data-width="{width}" data-height="{height}">
  <div class="card clip" id="card" data-start="0" data-duration="{duration:.2f}" data-track-index="1">
{body}
  </div>
</div>
<script>
const E_OUT="cubic-bezier(0,0,0.2,1)", E_STD="cubic-bezier(0.4,0,0.2,1)";
window.__timelines = window.__timelines || {{}};
const tl = gsap.timeline({{ paused:true }});
tl.to("#card", {{ opacity:1, y:0, duration:0.42, ease:E_OUT }}, 0.0);
{timeline_js}
window.__timelines["main"] = tl;
</script>
</body>
</html>"""


# ── Layout: big_quote ───────────────────────────────────────
# fields: quote, key_word, attribution

def _big_quote(fields: dict, duration: float, w: int, h: int) -> str:
    quote = str(fields.get("quote") or fields.get("line") or "").strip().rstrip(".")
    key = str(fields.get("key_word") or "").strip()
    attribution = str(fields.get("attribution") or "").strip()
    key_norm = re.sub(r"[^a-z0-9]", "", key.lower())
    css = """
.bq-eyebrow { margin-bottom:26px; opacity:0; transform:translateY(10px); }
.bq-quote {
  font-family:"Archivo Black",system-ui,sans-serif; font-weight:900;
  font-size:90px; line-height:1.06; letter-spacing:-0.02em; color:#fff;
}
.bq-quote .word { display:inline-block; opacity:0; transform:translateY(24px); }
"""
    # Build per-word spans on PLAIN text (no nested markup to shred); the first
    # word matching key_word gets the gold-glow classes.
    spans, matched = [], False
    for wtok in quote.split():
        wnorm = re.sub(r"[^a-z0-9]", "", wtok.lower())
        is_key = bool(key_norm) and not matched and wnorm == key_norm
        matched = matched or is_key
        cls = "word gold glow" if is_key else "word"
        spans.append(f'<span class="{cls}">{esc(wtok)}</span>')
    quote_html = " ".join(spans)
    eyebrow = f'<div class="eyebrow bq-eyebrow" id="bqEye">{esc(attribution)}</div>' if attribution else ""
    body = f"""    {eyebrow}
    <div class="bq-quote" id="bqQuote">{quote_html}</div>"""
    tjs = """
tl.to("#bqEye", { opacity:1, y:0, duration:0.32, ease:E_OUT }, 0.16);
tl.to("#bqQuote .word", { opacity:1, y:0, duration:0.46, ease:E_OUT, stagger:0.05 }, 0.28);
"""
    return _doc(w, h, css, body, tjs, duration)


# ── Layout: comparison (OLD WAY vs NEW WAY) ─────────────────
# fields: header, left_label, left_text, right_label, right_text

def _comparison(fields: dict, duration: float, w: int, h: int) -> str:
    header = fields.get("header") or "OLD WAY vs NEW WAY"
    ll = fields.get("left_label") or "OLD WAY"
    lt = fields.get("left_text") or ""
    rl = fields.get("right_label") or "NEW WAY"
    rt = fields.get("right_text") or ""
    css = """
.cmp-header { text-align:center; margin-bottom:30px; opacity:0; transform:translateY(10px); }
.cmp-grid { display:grid; grid-template-columns:1fr 1fr; gap:22px; align-items:stretch; }
.cmp-col {
  border-radius:10px; padding:34px 30px; min-height:300px; display:flex;
  flex-direction:column; gap:18px; opacity:0; transform:translateY(28px);
}
.cmp-old { background:rgba(255,255,255,0.04); border:1px solid #3a3a3a; }
.cmp-new { background:rgba(248,211,128,0.08); border:1px solid rgba(248,211,128,0.45); }
.cmp-tag {
  font-family:"Poppins",system-ui,sans-serif; font-weight:700; font-size:26px;
  letter-spacing:0.14em; text-transform:uppercase;
}
.cmp-old .cmp-tag { color:rgba(255,255,255,0.55); }
.cmp-new .cmp-tag { color:%(GOLD)s; }
.cmp-body { font-family:"Inter",system-ui,sans-serif; font-weight:500; font-size:38px; line-height:1.28; color:#fff; }
.cmp-old .cmp-body { color:rgba(255,255,255,0.78); }
.cmp-mark { font-size:30px; }
.cmp-old .cmp-mark { color:rgba(255,120,120,0.9); }
.cmp-new .cmp-mark { color:%(GOLD)s; }
""".replace("%(GOLD)s", GOLD)
    body = f"""    <div class="eyebrow cmp-header" id="cmpHead">{esc(header)}</div>
    <div class="cmp-grid">
      <div class="cmp-col cmp-old" id="cmpL">
        <div class="cmp-tag"><span class="cmp-mark">✗</span> {esc(ll)}</div>
        <div class="cmp-body">{esc(lt)}</div>
      </div>
      <div class="cmp-col cmp-new" id="cmpR">
        <div class="cmp-tag"><span class="cmp-mark">✓</span> {esc(rl)}</div>
        <div class="cmp-body">{esc(rt)}</div>
      </div>
    </div>"""
    tjs = """
tl.to("#cmpHead", { opacity:1, y:0, duration:0.32, ease:E_OUT }, 0.16);
tl.to("#cmpL", { opacity:1, y:0, duration:0.44, ease:E_OUT }, 0.30);
tl.to("#cmpR", { opacity:1, y:0, duration:0.44, ease:E_OUT }, 0.46);
"""
    return _doc(w, h, css, body, tjs, duration)


# ── Layout: stack (label + rows + footer) ───────────────────
# fields: label, rows[], footer, gold

def _stack(fields: dict, duration: float, w: int, h: int) -> str:
    label = fields.get("label") or ""
    rows = fields.get("rows") or []
    if isinstance(rows, str):
        rows = [r.strip() for r in re.split(r"[\n,]", rows) if r.strip()]
    footer = fields.get("footer") or ""
    gold = str(fields.get("gold") or "").strip()
    css = """
.stk-label { margin-bottom:30px; opacity:0; transform:translateY(10px); }
.stk-row {
  display:flex; align-items:center; gap:22px; padding:22px 0;
  border-bottom:1px solid rgba(255,255,255,0.08); opacity:0; transform:translateX(-26px);
}
.stk-row:last-of-type { border-bottom:none; }
.stk-check {
  flex:0 0 auto; width:54px; height:54px; border-radius:50%;
  background:rgba(248,211,128,0.14); border:1px solid rgba(248,211,128,0.5);
  display:flex; align-items:center; justify-content:center; color:%(GOLD)s; font-size:30px;
}
.stk-text { font-family:"Archivo Black",system-ui,sans-serif; font-weight:900; font-size:54px; color:#fff; letter-spacing:-0.01em; }
.stk-footer { margin-top:30px; font-family:"Inter",system-ui,sans-serif; font-weight:500; font-size:30px; color:rgba(255,255,255,0.62); opacity:0; transform:translateY(8px); }
""".replace("%(GOLD)s", GOLD)
    row_html = "\n".join(
        f'      <div class="stk-row" id="stkRow{i}"><div class="stk-check">✓</div>'
        f'<div class="stk-text">{esc(r)}</div></div>'
        for i, r in enumerate(rows)
    )
    foot = ""
    if footer:
        ftxt = esc(footer)
        if gold:
            ftxt = re.sub(rf"(?i)\b({re.escape(esc(gold))})\b", r'<span class="gold">\1</span>', ftxt, count=1)
        foot = f'<div class="stk-footer" id="stkFoot">{ftxt}</div>'
    body = f"""    <div class="eyebrow stk-label" id="stkLabel">{esc(label)}</div>
{row_html}
    {foot}"""
    tjs = """
tl.to("#stkLabel", { opacity:1, y:0, duration:0.32, ease:E_OUT }, 0.16);
tl.to(".stk-row", { opacity:1, x:0, duration:0.40, ease:E_OUT, stagger:0.13 }, 0.30);
tl.to("#stkFoot", { opacity:1, y:0, duration:0.34, ease:E_OUT }, 0.30 + 0.13*%(N)d);
""" % {"N": max(len(rows), 1)}
    return _doc(w, h, css, body, tjs, duration)


# ── Layout: counter (number + suffix + timeframe) ───────────
# fields: label, value_target, value_prefix, value_suffix, timeframe

def _counter(fields: dict, duration: float, w: int, h: int) -> str:
    label = fields.get("label") or ""
    try:
        target = int(float(fields.get("value_target") or 0))
    except (TypeError, ValueError):
        target = 0
    prefix = fields.get("value_prefix") or ""
    suffix = fields.get("value_suffix") or ""
    timeframe = fields.get("timeframe") or ""
    css = """
.cnt-label { text-align:center; margin-bottom:14px; opacity:0; transform:translateY(10px); }
.cnt-row { display:flex; align-items:baseline; justify-content:center; gap:14px; }
.cnt-num {
  font-family:"Archivo Black",system-ui,sans-serif; font-weight:900; font-size:184px;
  line-height:1; letter-spacing:-0.03em; color:%(GOLD)s; opacity:0;
}
.cnt-suffix { font-family:"Archivo Black",system-ui,sans-serif; font-weight:900; font-size:62px; color:rgba(255,255,255,0.88); opacity:0; transform:translateY(8px); }
.cnt-time { text-align:center; margin-top:10px; font-family:"Inter",system-ui,sans-serif; font-weight:500; font-size:30px; color:rgba(255,255,255,0.6); opacity:0; transform:translateY(8px); }
""".replace("%(GOLD)s", GOLD)
    body = f"""    <div class="eyebrow cnt-label" id="cntLabel">{esc(label)}</div>
    <div class="cnt-row">
      <span class="cnt-num" id="cntNum" data-target="{target}" data-prefix="{esc(prefix)}">{esc(prefix)}0</span>
      <span class="cnt-suffix" id="cntSuffix">{esc(suffix)}</span>
    </div>
    <div class="cnt-time" id="cntTime">{esc(timeframe)}</div>"""
    tjs = """
tl.to("#cntLabel", { opacity:1, y:0, duration:0.32, ease:E_OUT }, 0.16);
tl.to("#cntNum", { opacity:1, duration:0.30, ease:E_OUT }, 0.42);
tl.to("#cntSuffix", { opacity:1, y:0, duration:0.30, ease:E_OUT }, 0.50);
tl.to("#cntTime", { opacity:1, y:0, duration:0.30, ease:E_OUT }, 0.60);
tl.add(()=>document.getElementById("cntNum").classList.add("glow"), 1.30);
const _n=document.getElementById("cntNum"), _t=parseInt(_n.dataset.target||"0",10), _p=_n.dataset.prefix||"";
const CS=0.42, CE=1.30;
function _paint(){ const t=(window.__timelines.main&&window.__timelines.main.time)?window.__timelines.main.time():0;
  const u=Math.min(1,Math.max(0,(t-CS)/(CE-CS))); const v=1-Math.pow(1-u,1.8);
  _n.textContent=_p+Math.round(_t*v); }
window.addEventListener("hf-seek", _paint); _paint();
"""
    return _doc(w, h, css, body, tjs, duration)


# ── Layout: cta (keyword DM) ────────────────────────────────
# fields: headline, sub, pulse_word  (pulse_word is ALWAYS one word)

def _cta(fields: dict, duration: float, w: int, h: int) -> str:
    headline = fields.get("headline") or "DM me the word below"
    sub = fields.get("sub") or ""
    keyword = one_word(fields.get("pulse_word") or fields.get("keyword") or "")
    css = """
.cta-head { font-family:"Poppins",system-ui,sans-serif; font-weight:700; font-size:46px; line-height:1.18; color:#fff; text-align:center; opacity:0; transform:translateY(12px); }
.cta-pill {
  margin:30px auto 0; display:flex; align-items:center; justify-content:center; gap:18px;
  padding:26px 44px; border-radius:8px; background:rgba(248,211,128,0.10);
  border:1px solid rgba(248,211,128,0.5); width:max-content; max-width:100%;
  opacity:0; transform:scale(0.9);
}
.cta-arrow { font-size:40px; color:%(GOLD)s; }
.cta-word { font-family:"Archivo Black",system-ui,sans-serif; font-weight:900; font-size:74px; letter-spacing:0.01em; color:%(GOLD)s; }
.cta-sub { margin-top:24px; text-align:center; font-family:"Inter",system-ui,sans-serif; font-weight:500; font-size:30px; color:rgba(255,255,255,0.65); opacity:0; transform:translateY(8px); }
""".replace("%(GOLD)s", GOLD)
    body = f"""    <div class="cta-head" id="ctaHead">{esc(headline)}</div>
    <div class="cta-pill" id="ctaPill">
      <span class="cta-arrow">\U0001F4AC</span>
      <span class="cta-word glow" id="ctaWord">{esc(keyword)}</span>
    </div>
    {f'<div class="cta-sub" id="ctaSub">{esc(sub)}</div>' if sub else ''}"""
    tjs = """
tl.to("#ctaHead", { opacity:1, y:0, duration:0.36, ease:E_OUT }, 0.16);
tl.to("#ctaPill", { opacity:1, scale:1, duration:0.42, ease:"back.out(1.6)" }, 0.34);
tl.to("#ctaSub", { opacity:1, y:0, duration:0.32, ease:E_OUT }, 0.56);
tl.to("#ctaWord", { scale:1.06, duration:0.6, ease:"sine.inOut", yoyo:true, repeat:-1 }, 0.9);
"""
    return _doc(w, h, css, body, tjs, duration)


# ── Layout: statement_sub (headline + sub) ──────────────────
# fields: headline, sub, gold

def _statement_sub(fields: dict, duration: float, w: int, h: int) -> str:
    headline = fields.get("headline") or fields.get("text") or fields.get("line") or ""
    sub = fields.get("sub") or ""
    gold = str(fields.get("gold") or "").strip()
    safe = esc(headline)
    if gold:
        safe = re.sub(rf"(?i)\b({re.escape(esc(gold))})\b", r'<span class="gold">\1</span>', safe, count=1)
    css = """
.ss-head { font-family:"Archivo Black",system-ui,sans-serif; font-weight:900; font-size:72px; line-height:1.08; letter-spacing:-0.02em; color:#fff; opacity:0; transform:translateY(22px); }
.ss-sub { margin-top:24px; font-family:"Inter",system-ui,sans-serif; font-weight:500; font-size:34px; line-height:1.32; color:rgba(255,255,255,0.62); opacity:0; transform:translateY(10px); }
"""
    body = (f'    <div class="ss-head" id="ssHead">{safe}</div>'
            + (f'\n    <div class="ss-sub" id="ssSub">{esc(sub)}</div>' if sub else ''))
    tjs = """
tl.to("#ssHead", { opacity:1, y:0, duration:0.44, ease:E_OUT }, 0.14);
tl.to("#ssSub", { opacity:1, y:0, duration:0.36, ease:E_OUT }, 0.34);
"""
    return _doc(w, h, css, body, tjs, duration)


# ── Layout: statement (single bold line) ────────────────────
# fields: headline / text, gold

def _statement(fields: dict, duration: float, w: int, h: int) -> str:
    text = fields.get("headline") or fields.get("text") or fields.get("line") or ""
    gold = str(fields.get("gold") or "").strip()
    safe = esc(text)
    if gold:
        safe = re.sub(rf"(?i)\b({re.escape(esc(gold))})\b", r'<span class="gold glow">\1</span>', safe, count=1)
    css = """
.st-text { font-family:"Archivo Black",system-ui,sans-serif; font-weight:900; font-size:84px; line-height:1.06; letter-spacing:-0.02em; color:#fff; opacity:0; transform:translateY(24px); }
"""
    body = f'    <div class="st-text" id="stText">{safe}</div>'
    tjs = '\ntl.to("#stText", { opacity:1, y:0, duration:0.46, ease:E_OUT }, 0.14);\n'
    return _doc(w, h, css, body, tjs, duration)


_DISPATCH = {
    "big_quote": _big_quote,
    "comparison": _comparison,
    "stack": _stack,
    "counter": _counter,
    "cta": _cta,
    "statement_sub": _statement_sub,
    "statement": _statement,
}


_DEFAULT_FONTS_LINK = (
    '<link href="https://fonts.googleapis.com/css2?family=Archivo+Black'
    '&family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap" rel="stylesheet" />'
)


def _hex_rgb(hex_str: str) -> tuple[int, int, int]:
    h = (hex_str or "").lstrip("#")
    if len(h) != 6:
        h = "f8d380"
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _apply_brand(doc: str) -> str:
    """Swap the baked Skalers tokens (gold accent + Archivo Black / Inter /
    Poppins fonts) for the buyer's brand_profile values. A no-op when the
    profile is the Skalers default, so the live pipeline is unchanged."""
    try:
        import brand_profile as _bp
        accent = _bp.gold_hex()
        disp = _bp.display_font()
        body = _bp.body_font()
        sub = _bp.sub_font()
    except Exception:
        return doc

    sub_family = (
        sub.replace(" Bold", "").replace(" SemiBold", "").replace(" Regular", "").strip()
        or "Poppins"
    )

    if accent.lower() != GOLD.lower():
        doc = doc.replace(GOLD, accent)
        r, g, b = _hex_rgb(accent)
        doc = doc.replace("248,211,128", f"{r},{g},{b}")

    if disp != "Archivo Black":
        doc = doc.replace('"Archivo Black"', f'"{disp}"')
    if body != "Inter":
        doc = doc.replace('"Inter"', f'"{body}"')
    if sub_family != "Poppins":
        doc = doc.replace('"Poppins"', f'"{sub_family}"')

    if disp != "Archivo Black" or body != "Inter" or sub_family != "Poppins":
        fams: list[str] = []
        for n in (disp, body, sub_family):
            f = n.strip().replace(" ", "+")
            if f and f not in fams:
                fams.append(f)
        link = (
            '<link href="https://fonts.googleapis.com/css2?'
            + "&".join(f"family={f}:wght@400;500;600;700" for f in fams)
            + '&display=swap" rel="stylesheet" />'
        )
        doc = doc.replace(_DEFAULT_FONTS_LINK, link)

    return doc


def render_template_html(layout: str, fields: dict, duration: float,
                         width: int = 1080, height: int = 1920) -> str:
    """Return a complete HyperFrames composition HTML for the given layout,
    rebranded to the active brand_profile (no-op for the Skalers default)."""
    fn = _DISPATCH.get(layout)
    if not fn:
        raise ValueError(f"unknown layout {layout!r}; known: {sorted(_DISPATCH)}")
    html = fn(fields or {}, float(duration or 3.0), int(width), int(height))
    return _apply_brand(html)
