#!/usr/bin/env bash
# Vendor the reel render pipeline (skalers/backend/content) into the container
# build context. Source only — node_modules + the bundled Chromium are installed
# at image build time (see container/Dockerfile), never committed.
#
# Re-run this whenever the upstream content/ pipeline changes:
#   ./scripts/vendor-content.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"      # content-os/
SRC="$HERE/../backend/content"                # skalers/backend/content
DST="$HERE/container/content"

if [ ! -d "$SRC" ]; then
  echo "source not found: $SRC" >&2
  exit 1
fi

# Dependency closure of reel_editor.cmd_pipeline (talking_head/raw/broll paths).
FILES=(
  reel_editor.py
  caption_builder.py
  transcript_cleanup.py
  broll_planner.py
  reel_templates.py
  broll_animator.py
  broll_format.py
  thumbnail_builder.py
  brand_profile.py
  website_capture.py
  __init__.py
)

rm -rf "$DST"
mkdir -p "$DST/fonts"
for f in "${FILES[@]}"; do
  cp "$SRC/$f" "$DST/$f"
done
cp "$SRC/fonts/"*.ttf "$DST/fonts/" 2>/dev/null || true

# HyperFrames CLI project: vendor the manifest + hand-authored references only.
# `npm install` in the Dockerfile pulls node_modules + the bundled Chromium.
RP="$HERE/container/reel_pipeline"
rm -rf "$RP"
mkdir -p "$RP"
cp "$SRC/reel_pipeline/package.json" "$RP/"
cp "$SRC/reel_pipeline/package-lock.json" "$RP/" 2>/dev/null || true
cp -R "$SRC/reel_pipeline/references" "$RP/references"

echo "vendored:"
echo "  $(ls "$DST"/*.py | wc -l | tr -d ' ') python modules + $(ls "$DST/fonts" 2>/dev/null | wc -l | tr -d ' ') fonts -> container/content/"
echo "  reel_pipeline (package.json + references/$(ls "$RP/references" | wc -l | tr -d ' ')) -> container/reel_pipeline/"
