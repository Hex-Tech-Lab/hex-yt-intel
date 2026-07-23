# Wave C/F: yt-dlp + FFmpeg scene-change screenshots + OCR.
# Deliberately NOT Cloudflare Workers (no native binary exec in V8 isolates)
# and NOT Vercel Functions (60s/300s timeout, too short for scene detection
# on an hour+ video) -- this needs a real container with a real filesystem
# and no per-request time limit, which is what Railway provides.

FROM node:24-slim AS base

# ffmpeg: scene detection + keyframe extraction
# tesseract-ocr: text extraction from extracted frames
# python3/pip + curl: yt-dlp itself (installed as the standalone binary below,
# not via pip, so it isn't tangled with the Node dependency graph)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    tesseract-ocr \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp_linux is the PyInstaller-built self-contained binary (no Python
# interpreter needed at runtime) -- NOT the plain "yt-dlp" release asset,
# which is a Python zipapp that fails at runtime in this image without a
# python3 install (caught by actually running the built container, not
# just building it -- see verification below).
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Install with devDependencies (typescript is already declared there) so the
# build step below uses the pinned version from package.json instead of
# re-resolving an ad hoc install, then prune dev deps from the final image.
COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
