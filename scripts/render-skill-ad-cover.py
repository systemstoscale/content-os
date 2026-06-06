#!/usr/bin/env python3
"""
Render a per-skill Meta Lead Ad hero cover for the Content OS funnel.

One hero cover per individual Claude skill. The locked hook:
    "THE [SKILL] / I INSTALL IN / $100M BUSINESSES. FREE."

Built on top of the shared Skalers cover generator at
`.claude/skills/2-instagram-thumbnail/scripts/generate_thumbnail.py`, which
auto-appends the locked brand-style.md (dark interior, gold #f8d380 accent,
Archivo Black UPPERCASE, bald Max, no hair, no em dashes).

Usage:
    python3 skalers/content-os/scripts/render-skill-ad-cover.py \\
        --skill-slug viral-ai-tools \\
        --skill-name "Viral AI Tools" \\
        --hologram "A glowing gold phone hologram showing AI tool icons floating beside Max"

Output:
    skalers/content-os/outputs/ad-covers/{skill-slug}.png   (1080x1920)

Environment:
    GEMINI_API_KEY must be set (same as the underlying script).
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
RENDERER = REPO_ROOT / ".claude" / "skills" / "2-instagram-thumbnail" / "scripts" / "generate_thumbnail.py"
HEADSHOT = REPO_ROOT / ".claude" / "skills" / "2-instagram-thumbnail" / "headshots" / "max.jpg"
OUTPUT_DIR = REPO_ROOT / "skalers" / "content-os" / "outputs" / "ad-covers"
VENV_PYTHON = REPO_ROOT / ".venv" / "bin" / "python"
ENV_SHARED = REPO_ROOT / ".env.shared"


def load_env_shared():
    """Per Skalers CLAUDE.md, credentials live in .env.shared. Inject into the
    current env so the underlying renderer (which only reads .env) still finds them."""
    if not ENV_SHARED.exists():
        return
    for line in ENV_SHARED.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def parse_args():
    p = argparse.ArgumentParser(description="Render one Content OS skill ad cover")
    p.add_argument("--skill-slug", required=True, help="kebab-case slug, e.g. viral-ai-tools")
    p.add_argument("--skill-name", required=True, help="Display name, e.g. 'Viral AI Tools'")
    p.add_argument(
        "--hologram",
        default=None,
        help="One-sentence description of the gold holographic UI element beside Max. "
             "Default: stylized gold phone hologram showing the skill's UI.",
    )
    p.add_argument(
        "--expression",
        default="confident, mid-explain, pointing at the hologram",
        help="Max's expression for this cover.",
    )
    p.add_argument(
        "--output",
        default=None,
        help="Override output path. Default: skalers/content-os/outputs/ad-covers/{slug}.png",
    )
    return p.parse_args()


def build_prompt(skill_name: str, hologram: str, expression: str) -> str:
    """
    Build the per-skill prompt. The locked brand-style.md is appended automatically
    by generate_thumbnail.py, so we only describe what varies for THIS skill.
    """
    skill_upper = skill_name.upper()
    layer_a = "THE CLAUDE SKILL"
    layer_b_top = f"I INSTALL IN"
    layer_b_bottom = "$100M BUSINESSES"
    # Eyebrow / pre-headline reads: "FREE: [SKILL NAME]"
    eyebrow = f"FREE. {skill_upper}."

    return f"""\
A professional Instagram reel cover image in 9:16 vertical aspect ratio (phone format).
Skalers.io brand. Warm-lit dark interior. Single gold #f8d380 accent.

PRIMARY DIRECTIVE — FACE FIDELITY (do not deviate):
The person in this image is Max (Image 1). His face must be PHOTOGRAPHICALLY IDENTICAL to the headshot. Lock these features verbatim from Image 1:
- Bald clean-shaven head, smooth scalp, no hair, no hairline, no scalp stubble
- FULL dark brown beard — not stubble — with a defined mustache connecting to a goatee chin patch, with beard hair along the jawline. Medium-short, dense, well-groomed. Slight reddish cast on cheeks.
- Light blue-grey eyes (not brown)
- Dark defined eyebrows
- Angular lean face with prominent cheekbones, narrower jaw, longer face shape (NOT round, NOT chubby)
- Fair European skin, slight warm flush
- Lean athletic build, mid-30s
Do not interpolate toward a generic bearded bald man. This is THIS specific person.

This is a Meta Lead Ad creative for the Skalers Content OS funnel. The free Claude skill being offered is "{skill_name}".

ATTACHED IMAGES:
- Image 1 (headshot): The exact reference of Max's face. Treat as a photograph — render his face PHOTOGRAPHICALLY MATCHING this image. Do NOT stylize, do NOT smooth, do NOT slim, do NOT broaden, do NOT add hair, do NOT thin out the beard.

PERSON (Max):
Photograph of the exact person from Image 1. Waist-up, slightly to the right of center, facing camera.
Re-apply the locked features above (bald + full goatee beard + blue-grey eyes + angular face + lean build).
Dramatic warm side-lighting on the face. Soft rim light on the top of the bald head.
Expression: {expression}.
Wardrobe: black tee, charcoal shirt, or the Skalers black hoodie with the gold "S" logo. Neutral dark only.

BACKGROUND:
Warm-lit dark interior — a $100M founder's home office at 10pm. Bookshelves with warm spine glow, a lamp casting a gold pool of light, a softly glowing monitor (gold-tinted, never blue) behind Max. Real depth, real texture. Color cast reads as Skalers #222 ink.

HOLOGRAPHIC UI ELEMENT:
{hologram or f"A floating gold-tinted glass phone hologram beside Max showing a stylized {skill_name} interface. Semi-transparent, soft rgba(248,211,128,0.15) outer glow. Single element only."}

TEXT (render exactly these strings, nothing else — no font names, no quotation marks, no labels, no annotations from this prompt should appear in the image):

Eyebrow tag (small, GOLD #f8d380, letter-spaced UPPERCASE sans-serif, sits in a thin gold-outlined pill at the very top):
{eyebrow}

Headline (3 stacked lines, all UPPERCASE, heavy black sans-serif like Archivo Black, pixel-clean letters):
Line 1 (WHITE #ffffff, medium-large): {layer_a}
Line 2 (WHITE #ffffff, large): {layer_b_top}
Line 3 (GOLD #f8d380, largest): {layer_b_bottom}

All four text strings sit stacked vertically in the upper third of the frame, above Max's head. Letters MUST be pixel-clean — no garbled glyphs, no extra letters, no labels like "Line 1" or "Poppins" or anything from this prompt rendered into the image.

STYLE:
Skalers dark-only single-gold palette. Cinematic, premium, polished, not cluttered. NO cyan, NO blue, NO purple, NO red, NO neon, NO light backgrounds, NO em dashes, NO hair on Max's head, NO logos in the background, NO watermarks.

FACE FIDELITY REMINDER (restated, do not forget):
The face MUST match Image 1 photographically. Full dark beard (not stubble), light blue-grey eyes, angular lean face, bald clean-shaven scalp. If your draft of the face does not match Image 1, redraw it.
"""


def main():
    args = parse_args()

    if not RENDERER.exists():
        print(f"Error: renderer not found at {RENDERER}", file=sys.stderr)
        sys.exit(1)
    if not HEADSHOT.exists():
        print(f"Error: headshot not found at {HEADSHOT}", file=sys.stderr)
        sys.exit(1)

    output_path = Path(args.output) if args.output else OUTPUT_DIR / f"{args.skill_slug}.png"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    prompt = build_prompt(args.skill_name, args.hologram, args.expression)

    load_env_shared()
    python_bin = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable

    cmd = [
        python_bin,
        str(RENDERER),
        "--headshot", str(HEADSHOT),
        "--prompt", prompt,
        "--output", str(output_path),
    ]

    print(f"Rendering ad cover for skill: {args.skill_name}")
    print(f"Output: {output_path}")
    result = subprocess.run(cmd)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
