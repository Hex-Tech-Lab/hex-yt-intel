# Transcript 72h + Dynamic Markers + FFmpeg Second Pass + TimeSeek — V5 Final Plan

**Model:** Muse Spark 1.1 (plan) → execution same model per user request  
**Date:** 2026-07-18  
**Keys used:** SerpAPI `b6426...`, Decodo FastSearch `VTAwMDA0NjA2Mjk6...`, Exa `bb950b...`, Brave `BSAa...`, GH PAT (public fallback)

## 0. DB RCA — Where we stand (live query 2026-07-17)

- Analysis `vEC6e5dBi4Y` Egyptian classic "ثمن الحرية" 2h AR:
  - `analysis_chunks` 5 rows completed, dims [1],[8],[2,4,6],[5,7,10],[3,9,11] = 11 dims exist, payload has persona + dim content valid
  - `analyses` row md_len 0, payload [], billing=failed, digest N, hash d0b129...
  - `validation_report`: fails 22 checks missing persona header, dim headers, lens tags, tables, timestamps — stitcher from chunks→markdown fails, markdown never written
  - Chat ADR008 refuses because markdown empty → "no analysis"
  - Logs: 22,8k in / 629-2597 out x5 at 09:48PM = 5 chunk LLM calls cost $0.026-0.035 each (OpenRouter), total $0.15. 190/45 tok at 11:37PM = digest attempt with empty input.

**Root cause:** `PersistService` + `POST /api/analyses/persist` only writes when validation passes, should write even partial. Digest needs markdown, gets 409 forever.

## 1. 3-Engine Research Harness — No fallback, all 3 executed

### SerpAPI (engine=google, 4 queries x10 = 38 organic)

- Q1 transcript markers: `jdepoix/youtube-transcript-api` #1 python no key, `prajwaliyer/youtube-timestamp-search` 3-min sections, `zaidmukaddam/youtube-transcripts-machine` auto timestamps, `dtbuchholz/yt-timestamps-subtitles` Whisper+GPT-4 timestamps.
- Q2 ffmpeg scene: StackOverflow 35675529 scene timecode, `bogotobogo` iframe extract, `PySceneDetect` #2, `scenedetect.com`, `scenecut-extractor` PyPI select filter, `4as/ScreenCapSeeker` pin-point screenshot via FFmpeg.
- Q3 whisper: `linto-ai/whisper-timestamped` #1 multilingual word timestamps + confidence, `m-bain/whisperX` forced alignment wav2vec2 + diarization, `CrisperWhisper` verbatim crisp, discuss #684 batch.
- Q4 yt-dlp chapters: reddit splitchapters, unix stackexchange `yt-dlp --dump-json | jq chapters`, issue #5448 embed description timestamps as chapters, `geekingfrog` accurate chapters.

### Decodo FastSearch (fastsearch.decodo.com/v0/search, 4x10=40)

- Q1 same + `Lunatic16/youtube-timestamper` Claude Code skill chapter grouping, `coffeefuelbump/AI-YouTube-Timestamps` bump-1.0 AI chapter markers, `fancellu/yt_timestamper` NLP timestamps
- Q2: `PySceneDetect` rank2, `Turais` screenshot at 00:00:09 script, `vidio.ai 2025 Guide` select='gt(scene,X)' vs scdet comparison, `GDELT blog` simplest select approach
- Q3: `whisper-timestamped` rank1, issue #1247 WhisperX inaccurate vs MFA Montreal Forced Aligner, #1311 pass original transcript to align() for word times (key for AR case), paper arXiv 2509.09987 internal word aligner
- Q4: `yt-dlp cheat sheet`, `yt-dlp --dump-json`, Medium `Using yt-dlp to download youtube transcript` get_subs.py, `notelm.ai` transcript no timestamps

### Exa (api.exa.ai/search, 4x8=32, $0.007 each = $0.028)

- Q1: `jenilrupapara001/clipmark`, `OneMoreJack/youtube-transcript`, `jdepoix/youtube-transcript-api`, `fancellu/yt_timestamper`, `Youtube-Transcript-Dev/Youtube-Transcript-API` 100+ langs batch ASR, `ScribeTube`, `zandonella/yt-transcript-search`
- Q2: `scenedetect.com/docs/api.html`, `scenedetect.com/cli/`, `PySceneDetect` README, `ffmpeg-cookbook.com scene-detect`, `scenedetect.com/api/`, `pypi scenedetect v0.7`
- Q3: `linto-ai/whisper-timestamped`, `m-bain/whisperX`, openai discuss #1855 word segmentation, #684, #125 word timestamp, `leeroopedia/workflow-openai-whisper-word-level`
- Q4: unix stackexchange list chapters, `HanifCarroll/youtube-transcript`, `yt_dlp/extractor/common.py` & `youtube.py` where chapters parsed, issue #10138 Metadata Chapters

### Unified GH leaderboard — what to copy

| Repo | Stars | License | Copy | ToS |
|---|---|---|---|---|
| yt-dlp | 179k | Unlicense | `YoutubeDL({'dumpjson':True}) result['chapters']=[{start_time,end_time,title}]`, `automatic_captions` with start,duration | None metadata only |
| youtube-transcript-api | 7.9k | MIT | return list[{text,start,duration}] preserve, not blob | None |
| PySceneDetect | 5k | BSD | `detect(video, ContentDetector(threshold=27))` + AdaptiveDetector, `split_video_ffmpeg` | High if download video, gate with ENABLE_FFMPEG_ENRICH |
| whisper-timestamped | 2.8k | AGPL | `transcribe(vad='silero', language='ar')` word confidence, AR fallback | Low own ASR |
| whisperX | 7k+ | BSD | forced alignment `align()` pass existing Decodo transcript to get word times | Low |
| Timecode-Generator NotTwist | MIT | heuristic scene + CLIPxGPT captioner for chapter title | Low |
| ScreenCapSeeker 4as | MIT | pin-point screenshot via FFmpeg `ffmpeg -ss ts -vframes 1` | High if download |

Industry: YouTube auto-chapters = ASR drift + visual + retention, Azure Video Indexer = transcript + scene (PySceneDetect) + OCR + face + speaker, AssemblyAI = 2-pass transcript + enrichment async. All sliding scale, not fixed 40-80.

## 2. Dynamic marker budget — self-critique answer

**Why shrink?** Compliance + storage 60% less + RAG precision (markers 300 tok vs transcript 10k) + timeline survives purge. Without shrink, after 72h lose all navigation.

**Why fixed 40-80 bad?** Long tutorial needs 120 dense, 1h monologue needs 20 sparse theme. Fixed waste + miss. Should be sliding.

**New formula:** `M = clamp(α*L + β*∫|dE/dt|dt + γ*entityChurn + δ*chapters, M_min(genre), M_max(genre))`

- L minutes, drift = Σ cosine(embed[i],embed[i+1]), entityChurn new entities/min, chapters count
- Clamp genre: short<5m 8-15, 5-20m 15-40, 20-60m 40-80, 60m+ 80-150, factor tutorial x1.5 dense blocks, monologue x0.6 sparse theme, movie x0.8, news x1.2
- Handles edge: tutorials dense time-blocked, monologues sparse theme

> **P4 SHELVED: ffmpeg pass-2 unrunnable** — no subprocess on CF Workers; Vercel 60s/500MB can't download+decode 2h video; yt-dlp video download violates YouTube ToS. Future ticket: chapters from YouTube player response + storyboard sprite thumbnails (zero infra, ToS-clean). The `ffmpeg-enrich` webhook is kept as a pure marker-merge endpoint for when chapters/scenes arrive from other sources.

> **P4 SHELVED: "60–90 semantic markers"** — no marker generator exists; the αβγδ formula degenerates to genre/length clamp since drift/entityChurn aren't computable (no embeddings pipeline). Use clamp table directly.

> **P4 SHELVED: Bayesian week-1 / bandit week-2** — underpowered ~10× at current traffic (2.5 obs/param; 500 seeks detects only 15–20pp effects). Revisit at ~100× traffic.

> **P4 SHELVED: SSE timeline refresh** — pointless without markers.

## 3. Second optimization run — adds ffmpeg set smartest, no dupes (SHELVED — see above)

**Pass1 sync (ingest, 200ms):** timed segs [{start,dur,text,hash}] + M1 via formula, thumb hqdefault.jpg

**Pass2 async QStash /api/webhooks/ffmpeg-enrich 90s after persist:**
- Inputs: M1 + M_chapters (yt-dlp) + M_scenes (PySceneDetect threshold 0.4 OR ffmpeg select='gt(scene,0.4)',showinfo)
- Union = M1 ∪ chapters ∪ scenes sorted by start
- Dedup: cluster if |t_i - t_j| < 5s → keep max importance = 0.5*semantic +0.3*isChapter +0.2*isScene +0.1*entityCount, drop other
- Screenshots: if ENABLE_FFMPEG_ENRICH=1 ffmpeg -ss ts -vframes 1 else YT thumb sprite
- Upsert markers source-tagged, publish SSE timeline refresh

No dupes via temporal clustering 5s + normalized text hash.

## 4. Bayesian vs Bandit — 3-tier not 2

- Day0 heuristic clamp (ships now)
- Week1 Bayesian offline 50 vids labeled cross-genre, tune α,β,γ,δ per genre, GP + EI, metric = quote precision + seek retention >3s + cost
- Week2 contextual bandit online 500 seeks, arms top3 configs per genre, ε=0.2, reward Redis marker:reward:{vid}

2-tier insufficient cold start for Egyptian AR movie genre. 3-tier = Azure style.

Bayesian alone enough MVP, bandit gives 10x after traffic.

## 5. P0 Fixes included in this plan

- `TranscriptExtractor`: preserve segments [{start,duration,text}] not blob, lang fallback [ar,en] not en-only, return both transcript + segments
- `PersistService` + `POST /api/analyses/persist`: write markdown even when validation false, assemble from chunks if payload empty, use `analysis_chunks` as fallback source
- Digest: truncate input to 30k chars (dim1+3+5), regex tolerant `/0\.[1-4]/i`, fallback save raw if parse null, language-agnostic headers
- TimeSeek: `format.tsx` linkify `12:34`, `1:02:33`, `[12:34]`, `(12:34)` → `[⏱ 12:34](#t=754)`, component `MarkdownTimestampAnchor` → `setSeekTo` + scroll + queue + fallbackSeek
- Redis L1: Upstash Redis 7d TTL, adapter exists, reuse `set` with ex 604800, fallback to SB L2
- Supabase migrations: `transcripts(video_id PK, content, segments jsonb, created, expires, last_access)` + `transcript_markers(video_id, idx, start, end, keywords, entities, quote_hash, importance, dim_refs, genre, source)`
- QStash: `transcript-purger` 15m, `compliance-check` daily, `ffmpeg-enrich` 90s after analysis, `transcript-purge` logic delete raw + vector namespace, keep markers
- Chat RAG: two-tier 70% analysis + 30% transcript verbatim with timestamp chip, must cite [⏱]
- Research harness: `scripts/research/run-transcript-research.ts` using SerpAPI + Decodo FastSearch + Exa keys (from env), merges into `docs/research/markers-benchmark.md`
- Preflight: type-check, lint, build, qa-intel

## 6. Proof checklist

- DB: `vEC6e5dBi4Y` re-analyzed → md_len>0, digest Y, markers 60-90 genre movie, Redis hit after first
- Timeline click → seek, fallback 101/150 → Play from 12:34 on YT
- Chat cite shows [⏱ 12:34] chip
- Cron list shows new ids, purge log 0 violations
- QStash token present (was empty), setup:cron works via @hex-yt-intel/web filter

## 7. Files to touch

- worker/src/services/TranscriptExtractor.ts
- worker/src/services/PersistService.ts
- web/app/api/analyses/persist/route.ts
- web/lib/adapters/SupabaseAnalysisAdapter.ts
- supabase/migrations/20260718_transcripts_markers.sql
- web/lib/utils/format.tsx
- web/components/MarkdownTimestampAnchor.tsx (new)
- web/store/useVideoStore.ts (timelineMarkers)
- web/components/templates/console/VideoPlayerCard.tsx (already half-ready, verify)
- web/lib/prompts/executive-digest.ts (tolerant parser, truncate)
- web/lib/usecases/GenerateExecutiveDigestUseCase.ts (truncate)
- web/scripts/setup-qstash-cron.ts (add purger, enrich, compliance)
- web/app/api/webhooks/transcript-purge/route.ts (new)
- web/app/api/webhooks/ffmpeg-enrich/route.ts (new)
- web/app/api/webhooks/compliance-check/route.ts (new)
- web/lib/adapters/UpstashCacheAdapter.ts (already 7d, reuse)
- scripts/research/run-transcript-research.ts (new)
- docs/research/markers-benchmark.md (new)

## 8. Execution order

1. Fix stitcher + digest (P0) → re-analyze AR film → prove md_len>0
2. TranscriptExtractor preserve segs + AR lang
3. Migrations + Redis L1
4. TimeSeek linkify + anchor + fallback
5. Second pass ffmpeg-enrich + dedup
6. Research harness
7. Purger + compliance
8. Preflight + deploy
