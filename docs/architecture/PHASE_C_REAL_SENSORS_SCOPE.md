# Phase C real-sensor scope: diarization + multimodal A/V probe

Status: PROPOSAL for vendor lock-in (2026-10-04). Author: Claude (CCW lane). Branch off `phase-c`.
Prices were read from vendor pages on 2026-10-04 and decay fast; re-check before locking. Items marked **[UNVERIFIED]** were not confirmed against a primary source or by running them, and each is covered by a spike in section 5.

## 0. Decisions to lock

| # | Decision | Recommendation |
|---|---|---|
| D1 | Diarization provider | **pyannoteAI** (diarization-only, language-agnostic), Precision-2 by default, Community-1 hosted as the cost fallback |
| D2 | A/V model | **`gemini-3.5-flash-lite`** (one price for text/image/video/audio input), A/B against `gemini-3.1-flash-lite`; escalate ambiguous chunks to `gemini-3.8-flash` |
| D3 | Extraction runtime | A small container worker with `yt-dlp` + `ffmpeg` (not a Cloudflare Worker, not Vercel serverless). Host choice is open, see risk R1 |
| D4 | Router inputs | Add `turnEntropy` and `overlapRatio` to `FusionInput` only after the bake-off on real diarization shows they carry signal (they do not change any route today) |

Claude models are not used for the A/V probe: the Claude API takes images and PDFs, not audio or video, and prosody needs audio **[UNVERIFIED for the newest Claude models; check before final lock]**.

## 1. Diarization provider (the acoustic anchor)

We already hold the transcript, so the provider must do diarization only. Prices per hour of audio.

| Provider | Diarization-only? | Price/hr | Notes |
|---|---|---|---|
| **pyannoteAI Precision-2** | Yes | EUR 0.112 (Developer plan), EUR 0.096 (Starter) | Returns `{speaker,start,end}` segments; overlapping segments express overlap; `exclusive`, `confidence`, `numSpeakers/min/max` options; webhook delivery |
| pyannoteAI Community-1 (hosted) | Yes | about EUR 0.035 **[UNVERIFIED: search snippet, not the plans page]** | 28% worse DER than Precision-2 per pyannoteAI's own benchmark; also free to self-host via `pyannote.audio 4.0` |
| AssemblyAI | No: needs a transcript | $0.15/hr (Universal-2) + $0.02/hr diarization = $0.17/hr | Pays for a transcript we discard |
| Deepgram Nova-3 | No: needs a transcript | $0.0077/min + $0.0020/min = $0.0097/min = $0.58/hr | About 5x pyannoteAI |
| WhisperX on Replicate | No | about $0.074 per run with pyannote 3.0 | Per-run billing, hard to cost for long videos; runs the transcript we don't need |

**Recommendation: pyannoteAI.** It is the only option priced for diarization alone, and AssemblyAI/Deepgram would make us pay for a second transcript. Start on Precision-2; the bake-off decides whether Community-1 is accurate enough for S1/S2/S3 counts.

Note: pyannoteAI's own reference pages disagree on the premium model name (Precision-2 vs Precision-3). Confirm the model id and current price on the dashboard plans page at lock-in.

### 1.1 Request and response
- `POST https://api.pyannote.ai/v1/diarize` with `{ "url": <audio url>, "model": "precision-2", "webhook": <our url>, "exclusive": false, "confidence": true }`.
- Webhook payload: `{ jobId, status: "succeeded", output: { diarization: [ { start, end, speaker } ] } }`, retried up to 3 times; verify and persist it through the existing HMAC `/persist` path, never trust the webhook body unauthenticated.
- Audio goes in as a presigned R2 URL (bucket `vintel-ephemeral-probes`, 24h lifecycle TTL, key `audio/<videoId>.opus`) or pyannoteAI's temporary media upload **[UNVERIFIED: confirm the upload flow and accepted codecs]**.

### 1.2 Derived features (computed by us from the segments)
Let speech spans be the union of segments, `T_speech` their total duration, `t_i` speaker i's talk time.
- `diarizationSpeakerCount` = number of speakers with `t_i >= max(10 s, 5% of T_speech)`. Drops spurious micro-speakers (applause, intros). Both thresholds become registry keys `analysis.layer0.diarization.*`.
- `talkShare_i = t_i / sum(t)`; `turnEntropy = -sum(p_i log2 p_i) / log2(K)` over those speakers, 0 for a monologue, near 1 for an even panel (0 when K = 1).
- `overlapRatio = (duration where 2+ segments overlap) / T_speech`. Requires `exclusive: false`.
- `turnCount` = speaker changes after merging same-speaker gaps under 1 s. This is the acoustic replacement for the `>>` count.

### 1.3 Cost and latency (per video)
| Length | Precision-2 (Developer) | Community-1 | AssemblyAI | Deepgram |
|---|---|---|---|---|
| 10 min | EUR 0.019 | about EUR 0.006 | $0.028 | $0.097 |
| 30 min | EUR 0.056 | about EUR 0.018 | $0.085 | $0.29 |
| 60 min | EUR 0.112 | about EUR 0.035 | $0.17 | $0.58 |

Latency is not published on the pages I read; planning assumption **[UNVERIFIED]**: batch jobs finish in a small fraction of real time (low minutes for 60 min of audio), measured in spike S1. The job is async and webhook-driven, so it fits QStash and never blocks the user.

## 2. Multimodal A/V probe (the ephemeral extraction)

### 2.1 Where it runs
`yt-dlp` and `ffmpeg` cannot run in a Cloudflare Worker, and YouTube blocks most datacenter IPs. Run a small container worker (ADR 039's `processAv` port) triggered by QStash. The resolved media URLs are IP-bound and expire, so resolve and read them on the same host. Likely needs the existing residential/proxy account (ADR 016 key boundary) **[UNVERIFIED]**.

### 2.2 Timestamps
Use `calculateProbeTimestamps(durationSeconds)` (already merged): `N = clamp(ceil(min/12), 3, 15)`, 3% edge exclusion, one 15 s chunk per bin. 10 min gives 3 chunks, 60 min gives 5, 169+ min caps at 15.

### 2.3 Commands (draft, run in spike S2) **[UNVERIFIED]**
```bash
# 1) Resolve direct stream URLs once per video (low-res video + audio; prints video URL then audio URL)
yt-dlp --no-playlist -g -f "bv*[height<=360]+ba/b[height<=360]" "https://www.youtube.com/watch?v=$VIDEO_ID"

# 2) One 15 s chunk per timestamp T (seconds), streamed to stdout, never written to disk
ffmpeg -hide_banner -loglevel error \
  -ss "$T" -t 15 -i "$VIDEO_URL" -ss "$T" -t 15 -i "$AUDIO_URL" \
  -map 0:v:0 -map 1:a:0 -vf "scale=-2:360,fps=1" \
  -c:v libx264 -preset veryfast -crf 32 -c:a aac -b:a 48k -ac 1 -ar 16000 \
  -movflags +frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1 > "chunk_$T.mp4"
# fallback if range-seek on the DASH URLs fails:
# yt-dlp --download-sections "*${T}-$((T+15))" --force-keyframes-at-cuts -f "bv*[height<=360]+ba" -o "chunk_${T}.%(ext)s" URL

# 3) Full audio for diarization (mono opus, about 11 MB per hour), then upload to R2
yt-dlp --no-playlist -f ba -o - "https://www.youtube.com/watch?v=$VIDEO_ID" \
  | ffmpeg -hide_banner -loglevel error -i pipe:0 -vn -ac 1 -ar 16000 -c:a libopus -b:a 24k -f ogg pipe:1 > "$VIDEO_ID.opus"
```
Chunks go to Gemini inline (under 100 MB) or the Files API, and the R2 object is deleted only after the committed `succeeded` transition, as already implemented in the orchestrator.

### 2.3.1 Gemini 3.5 Flash-Lite call
- Structured JSON output with the schema below, `temperature: 0`, thinking at minimum so output tokens stay near the schema size.
- Token cost: video about 66 tokens/frame at low resolution and 1 fps, audio 32 tokens/s, so a 15 s chunk is about 1,470 media tokens plus a prompt of about 300.

### 2.4 Model choice
| Model | Input $/1M | Output $/1M | Role |
|---|---|---|---|
| `gemini-3.5-flash-lite` | 0.30 (all modalities) | 2.50 | **Primary** |
| `gemini-3.1-flash-lite` | 0.25 video, 0.50 audio | 1.50 | A/B challenger (cheaper output) |
| `gemini-2.5-flash-lite` | 0.10 video, 0.30 audio | 0.40 | Floor-cost baseline in the A/B |
| `gemini-3.8-flash` | 0.75 until 2026-12-31, then 1.50 | 3.75, then 7.50 | Escalation when a chunk's confidence is below the registry threshold |

No benchmark compares these on UI-frame and debate-prosody detection; the model choice is provisional until spike S2 scores them on the 14 hand-labeled videos.

### 2.5 Typed schema (strict)
```ts
interface ProbeChunkResult {
  uiFramesDetected: boolean;        // screen recording, app/UI chrome, terminal, slides with UI
  uiFramesConfidence: number;       // 0..1
  debateProsodyDetected: boolean;   // interruptions, raised/competing voices, rapid adversarial turn-taking
  debateProsodyConfidence: number;  // 0..1
}
```
Enforced with the Gemini response schema plus a Zod parse in our code; a malformed or out-of-range result throws, never a default (same rule as `parseJevTextScores`).

Aggregation across the N chunks (all thresholds are registry keys `analysis.layer0.probe.*`): a flag is true when the confidence-weighted share of chunks voting true is at least the registry threshold (proposed 0.34). `ProbeMetadata` stores the per-chunk results plus the aggregate so the bake-off can re-aggregate without new model calls.

### 2.6 Cost per video
Per chunk on `gemini-3.5-flash-lite` (1,770 input tokens, about 100 output): about $0.0008. A 10 min video (3 chunks) is about $0.0024; 60 min (5 chunks) about $0.004; the 15-chunk cap about $0.012.

### 2.7 All-in per video (sensors + JEV text)
JEV text cost observed at $0.04 for 79 chunk calls, so about $0.0005 per 8,000-char block.
- 10 min: about EUR 0.019 diarization + $0.0024 probe + about $0.002 JEV = about $0.025.
- 60 min: about EUR 0.112 + $0.004 + about $0.005 = about $0.12 (Community-1: about $0.045).
Diarization dominates; the probe is noise.

## 3. Integration with merged code
- `ProbeDeps.processAv` becomes the container worker: extraction, Gemini calls, per-chunk results into `ProbeMetadata`. Idempotent per `probe:<videoId>`, retry via `ProbeRetryableError` for 429/5xx/expired URLs.
- Diarization is a second sensor job with the same lease/CAS contract; it writes `{speakers, turnCount, turnEntropy, overlapRatio}` to the same metadata row.
- `routeFusion` consumes `diarizationSpeakerCount`, `uiFramesDetected`, `debateProsodyDetected` today. `turnEntropy` and `overlapRatio` are stored but unused until D4.
- DB: the `ProbeJobStore` port still has no implementation or table; the first build wave adds the migration and follows ADR 018 (`apply_migration`, then `list_migrations`, then rename the local file).

## 4. Validation plan (what the 100% mock result did not prove)
Run the 14 hand-labeled videos through the real sensors and compare route-by-route. Report separately: diarization speaker-count accuracy, UI-frame and debate-prosody accuracy, and final route agreement vs the hand labels. Target stays above 85% route agreement, but only the real-sensor run counts.

## 5. Risks and spikes (before any build)
| # | Risk | Spike |
|---|---|---|
| R1 | YouTube blocks datacenter IPs and the yt-dlp commands are untested here | S2: run section 2.3 from the chosen host on the 14 videos; record success rate, per-chunk seconds, proxy need |
| R2 | Real diarization miscounts speakers on short intros/outros | S1: run Precision-2 and Community-1 on the 14; compare `diarizationSpeakerCount` to labels |
| R3 | Gemini Flash-Lite misses UI frames or debate prosody | S2: score the three Gemini models on the 14, pick the cheapest that clears the target |
| R4 | Vendor retention/ToS for audio sent off-platform (ADR 012 72 h transcript retention) | Review pyannoteAI and Google data-use terms (paid Gemini tier does not train on content); confirm the 24 h R2 TTL covers presigned-URL exposure |
| R5 | Prices expire (Gemini 3.8 Flash doubles on 2027-01-01) | Re-check at lock-in; the model is a registry key, not hardcoded |

## 6. Proposed build waves (one agent per wave)
1. Migration + `ProbeJobStore` implementation + QStash handler wiring (no vendors).
2. Diarization sensor (pyannoteAI client, webhook via HMAC `/persist`, derived features).
3. A/V probe container worker (yt-dlp/ffmpeg, Gemini client, Zod schema, aggregation).
4. Real-sensor bake-off harness replacing `MockSensorRegistry`.

## Sources
- pyannoteAI: https://www.pyannote.ai/md/models, https://www.pyannote.ai/md/pyannoteai, https://docs.pyannote.ai/api-reference/diarize, https://docs.pyannote.ai/webhooks
- AssemblyAI: https://www.assemblyai.com/pricing.md
- Deepgram: https://smallest.ai/blog/deepgram-pricing-plans-cost-what-you-get-in-2026 (third-party summary of Deepgram rates)
- Gemini pricing and token rates: https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/video-understanding, https://ai.google.dev/gemini-api/docs/audio
