# video-pipeline (Wave C/F)

yt-dlp + FFmpeg scene-change screenshots + OCR, for the timestamp/screenshot
feature scoped in `docs/history/ROSTER_2026-07-20.md` (Wave B/C/F). Deployed
separately from the rest of the stack because it needs native binary
execution (yt-dlp, ffmpeg, tesseract) that neither Cloudflare Workers (V8
isolates, no subprocess exec) nor Vercel Functions (60s/300s timeout, too
short for scene detection on a long video) can provide.

**Status (2026-07-24): storyboard-sprite path is real and working.**
`/health`, `/extract-metadata`, and `/extract-storyboard` all work end to
end (Docker-built and run, hit over HTTP with real YouTube video IDs —
verified real chapter timestamps and real OCR'd text, not just a type-check).

Full-video download + FFmpeg scene-change detection + OCR of decoded frames
(the originally-planned `/extract-scenes`) is **intentionally not
implemented.** A legal/ToS review concluded that downloading YouTube's
audiovisual stream via yt-dlp violates the YouTube API Services ToS
unconditionally ("download, import, backup, cache, or store copies of
YouTube audiovisual content without YouTube's prior written approval"),
regardless of video ownership, plus a separate DMCA-adjacent risk around
yt-dlp's cipher-defeat mechanism. This is a parked *decision*, not a parked
route — no `/extract-scenes` code exists in this file or on any sibling
branch as of this writing. It may be revisited later per a legal-strategy
note outside the scope of this service; that is a future call, not this
codebase's default.

The active Wave C/F path instead uses data YouTube already serves
officially and separately from the video stream itself:

- **Chapters** — from `yt-dlp --dump-json`'s `chapters` field. Metadata
  only, no download.
- **Storyboard sprite thumbnails** — the small preview-image grids YouTube
  serves for the player's scrub bar (`i.ytimg.com/sb/...`), also surfaced
  via `yt-dlp --dump-json`'s `formats[]` (entries with `rows`/`columns`/
  `fragments`). Same trust tier as the `i.ytimg.com/vi/{id}/hqdefault.jpg`
  thumbnail this app already fetches directly elsewhere (see
  `web/components/templates/console/VideoPlayerCard.tsx`) — a small preview
  image fetch, not a video/audio stream download.

`/extract-storyboard` slices each sprite sheet into its individual tiles
(via `ffmpeg -vf crop=...` — no new image-processing dependency, ffmpeg was
already a required binary in this image) and OCRs the tile nearest each
chapter boundary (or an even 60s sampling if the video has no chapters),
returning `{videoId, chapters, storyboardResolution, tiles: [{timestamp,
text}]}` — the same timestamp+text shape a scene-screenshot endpoint would
have returned, so downstream integration isn't blocked by this decision.

**Known, accepted quality tradeoff:** storyboard tiles top out around
160-320px wide (YouTube's highest scrub-preview tier, video-dependent) —
far below a real decoded video frame. Verified against two real videos: a
960x540 sheet (320x180/tile) OCR'd cleanly-legible short strings; a
160x90/tile sheet on a code-tutorial video returned mostly empty strings
with occasional legible fragments (e.g. "python"). This is the expected,
inherent ceiling of using preview thumbnails instead of downloaded frames —
documented rather than silently degraded further or worked around with a
disallowed approach.

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
- `POST /extract-storyboard` — `Authorization: Bearer <PIPELINE_SHARED_SECRET>`
  required. Body: `{"videoId": "<11-char YouTube ID>"}`. Returns
  `{videoId, chapters, storyboardResolution: {width, height}, tiles: [{timestamp,
  text}]}`. Fetches chapters + the highest-resolution storyboard sprite tier
  via `yt-dlp --dump-json`, crops the tile nearest each chapter boundary (or
  an even 60s sampling if no chapters, capped at 20 tiles per request) with
  `ffmpeg`, and OCRs each tile with `tesseract`. No video/audio stream is
  downloaded — see the storyboard-sprite explanation above.

## Not yet built

- Full-video scene-change detection + OCR of decoded frames — intentionally
  **not** planned; see the ToS explanation above.
- Integration with the main app: how `/extract-storyboard` results get back
  to Supabase (S2S callback vs. polling), and how a video-analysis run
  triggers this service.
- Async/streaming progress reporting for long videos — `/extract-storyboard`
  is currently synchronous and could take several seconds per tile on a
  video with many chapters.
- Sheet-fetch/OCR result caching — repeat requests for the same video
  re-fetch and re-OCR from scratch.
