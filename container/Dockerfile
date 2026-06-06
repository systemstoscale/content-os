# ContentOS render container — ffmpeg + Node 20 + Playwright Chromium +
# HyperFrames + the brand fonts + the vendored reel pipeline. Ports the proven
# Modal image recipe (skalers/backend/modal/editor_render_app.py) to a Worker
# container. Two pipelines live here:
#   /process-reel, /transcribe, /audio-to-wav  — lean faster-whisper (avatar reels)
#   /render-reel, /preview                      — full cinematic pipeline (content/)
FROM python:3.12-slim

# System deps: ffmpeg + fontconfig + the Chromium runtime libs Playwright needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg fontconfig curl ca-certificates gnupg git \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
      libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Brand fonts (skalers.io/brand defaults): Archivo Black 900 / Inter / Poppins.
# Buyer-custom Google fonts are fetched at render time by the HTML/Chromium path;
# these baked ones cover the libass caption burn + the default look.
RUN mkdir -p /usr/share/fonts/custom \
 && curl -fsSL -o /usr/share/fonts/custom/ArchivoBlack-Regular.ttf 'https://github.com/google/fonts/raw/main/ofl/archivoblack/ArchivoBlack-Regular.ttf' \
 && curl -fsSL -o /usr/share/fonts/custom/Inter-Regular.ttf 'https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf' \
 && curl -fsSL -o /usr/share/fonts/custom/Poppins-Bold.ttf 'https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf' \
 && curl -fsSL -o /usr/share/fonts/custom/Poppins-Regular.ttf 'https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Regular.ttf' \
 && curl -fsSL -o /usr/share/fonts/custom/Poppins-SemiBold.ttf 'https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-SemiBold.ttf' \
 && fc-cache -f

# Node 20 LTS — needed for `npx hyperframes` (cinematic b-roll renderer).
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && node --version && npm --version

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Chromium for Playwright (broll_animator frame-stepping + thumbnail render).
RUN playwright install --with-deps chromium

# Vendored reel pipeline (skalers/backend/content -> ./content). Source only;
# node_modules + the HyperFrames-bundled Chromium are installed below.
COPY content ./content
COPY reel_pipeline ./content/reel_pipeline

# HyperFrames CLI deps + its bundled Chromium, then mirror the runtime manifest
# where HyperFrames' loader expects it (PRODUCER_DIR/core/dist), matching the
# Modal recipe so `hyperframes render` resolves its runtime in production.
RUN cd /app/content/reel_pipeline \
 && npm install --no-audit --no-fund \
 && ./node_modules/.bin/hyperframes browser ensure \
 && mkdir -p /app/content/core/dist \
 && cp node_modules/hyperframes/dist/hyperframe.manifest.json /app/content/core/dist/ \
 && (cp node_modules/hyperframes/dist/hyperframe.runtime.iife.js /app/content/core/dist/ || true)

ARG CACHEBUST=1
COPY app ./app

# Make the vendored content/ importable; tell the pipeline it's not local
# (env comes from the Worker-injected container vars, not .env.shared).
ENV PYTHONPATH=/app/content \
    SKALERS_RUN_IN_MODAL=1 \
    PORT=8080
EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
