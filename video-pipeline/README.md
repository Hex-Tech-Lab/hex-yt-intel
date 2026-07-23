# video-pipeline (Wave C/F)

yt-dlp + FFmpeg scene-change screenshots + OCR, for the timestamp/screenshot
feature scoped in `docs/history/ROSTER_2026-07-20.md` (Wave B/C/F). Deployed
separately from the rest of the stack because it needs native binary
execution (yt-dlp, ffmpeg, tesseract) that neither Cloudflare Workers (V8
isolates, no subprocess exec) nor Vercel Functions (60s/300s timeout, too
short for scene detection on a long video) can provide.

**Status (2026-07-23): scaffold only.** `/health` and `/extract-metadata` are
real and working — they prove the container, binaries, and auth wiring end
to end. Scene detection + screenshot extraction + OCR (the actual feature)
is not built yet.

## Why Railway

Evaluated against Fly.io and Vercel (see memory
`project_wave_plan_and_prompts_in_db_20260723.md`): Vercel Functions are
ruled out by the timeout. Fly.io and Railway both run real Docker containers
with no per-request timeout. Railway was chosen because Fly.io's free trial
had expired on this account; Railway currently has a working free tier.

## Local development

```bash
cd video-pipeline
npm install
cp .env.example .env   # fill in PIPELINE_SHARED_SECRET
npm run dev
```

Note: `yt-dlp`/`ffmpeg`/`tesseract` must be installed on your machine for
local dev (`brew install yt-dlp ffmpeg tesseract` on macOS) — only the
Docker image guarantees them without a manual install.

## Deploying to Railway

1. Push this directory to the `hex-yt-intel` GitHub repo (already done as
   part of this commit).
2. In the Railway dashboard: **New Project → Deploy from GitHub repo**,
   select `Hex-Tech-Lab/hex-yt-intel`, and set **Root Directory** to
   `video-pipeline`. Railway auto-detects `Dockerfile` + `railway.json`.
3. Set the `PIPELINE_SHARED_SECRET` environment variable in Railway's
   dashboard (generate with `openssl rand -hex 32`) — must match whatever
   the main app is configured to send.
4. Railway assigns a public URL once deployed; verify with
   `curl https://<railway-url>/health` — should return
   `{"status":"ok","checks":{"yt-dlp":"...","ffmpeg":"...","tesseract":"..."}}`.

## API

- `GET /health` — unauthenticated. Confirms yt-dlp/ffmpeg/tesseract are
  actually installed and runnable (not just "the container started").
- `POST /extract-metadata` — `Authorization: Bearer <PIPELINE_SHARED_SECRET>`
  required. Body: `{"videoId": "<11-char YouTube ID>"}`. Returns
  `{videoId, title, duration, chapters}` via `yt-dlp --dump-json`.

## Not yet built

- Scene-change detection (FFmpeg `scdet`/`select='gt(scene,...)'`) +
  timestamped keyframe extraction.
- OCR pass over extracted frames (tesseract is installed and smoke-tested,
  not yet wired into a pipeline).
- Integration with the main app: how results get back to Supabase (S2S
  callback vs. polling), and how a video-analysis run triggers this service.
- Async/streaming progress reporting for long videos.
