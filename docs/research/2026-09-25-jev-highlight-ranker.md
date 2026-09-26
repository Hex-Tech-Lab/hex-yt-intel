# ADR Draft: Jev as the Importance Ranker for Highlight Candidates

**Status**: DRAFT — design only, no code. Needs user confirmation before any implementation.
**Date**: 2026-09-25
**Author**: OC (GLM-5.3-flash), dispatched highlights-coverage task
**Related**: 2026-09-25 highlights full-coverage RCA (analysis 434ef182, video f6We53TnkbU), `web/lib/usecases/ExtractHighlightsUseCase.ts` (windowed harvest), THOS 2026-09-24 §6 (Jev benchmark).

## 1. Context

The 2026-09-25 RCA showed the highlights reel must sample the WHOLE timeline, not trust a single LLM pass. The shipped fix harvests per-300s-window candidates and merges them deterministically (de-overlap + cap). What the fix does NOT solve is **ranking**: which candidate moments, once harvested across all windows, are the strongest, and how the merged set should be trimmed/ordered when it exceeds `highlights.maxCount` (currently: model order wins, then cap-by-pop — no cross-window importance comparison).

Jev (`~typesafe/jev-latest`, `jev-1.13-20260917`, Decisions API `POST /api/alpha/decisions`, ~0.5 s/decision) benchmarked well on exactly this shape of task in the 2026-09-24 THOS: dispatch-routing and triage with a calibrated confidence score and a usable `p` (self-containment) signal.

## 2. Proposal

Use Jev as a **ranker over already-harvested highlight candidates** — not as a generator, not as a replacement for the windowed harvest.

- **Inputs per decision** (one candidate = one decision call; batchable):
  - the candidate's label + its verbatim excerpt (already computed by `buildVerbatimExcerpt`),
  - the window's surrounding transcript context (~±15s, capped at ~1k chars),
  - the digest takeaways (for "how central is this moment to the video's thesis"),
  - the video's title/description/classification.
- **Question asked of Jev**: "Rank this candidate moment's reel-worthiness for this video" → score 0–1 + confidence. Optional second signal: "does this excerpt stand alone when a viewer jumps here mid-video?" (THOS showed Jev detects non-self-contained input reliably, p 0.04–0.06 in the benchmark).
- **Use of the score**:
  1. **Trimming**: when merged candidates exceed `highlights.maxCount`, keep the top-N by score instead of today's model-order pop.
  2. **Ordering**: the reel plays in timeline order (scrubber contract) regardless of score — the score is a selection signal only.
  3. **Low-confidence fallback**: if Jev confidence < 0.8 for a candidate (or the API is down), keep the candidate with its window-harvest position in today's order — never drop on low confidence. (Fail-open, same threshold guidance as THOS §6.)

## 3. Scoring prompt (draft)

```
system: You score one candidate highlight for a video's highlights reel.
Given the video context, the digest takeaways, and one candidate moment
(label + verbatim excerpt + surrounding transcript), return a JSON object:
{"score": <0..1, how reel-worthy this moment is for a viewer skimming this
video: key claims, demos, numbers, decisions score high; filler scores low>,
"confidence": <0..1, your confidence in the score>,
"standalone": <true|false, does the excerpt make sense when a viewer jumps
here mid-video>}.
user: VIDEO: <title> (<classification>)
TAKEAWAYS: <10 takeaways>
CANDIDATE: <label>
EXCERPT: <verbatim excerpt + ±15s context>
```

## 4. Cost per video

- Candidates to rank ≈ merged harvest size ≈ windowCount × perWindowQuota bounded by `highlights.maxCount` (40 default); realistically 10–20 per video after de-overlap.
- Jev benchmark: ~0.5 s/decision. Cost per decision not published in the THOS benchmark; assume OpenRouter-priced small-model call with ~1.5k input tokens + ~50 output tokens ≈ **<$0.001/decision** → **≤ ~$0.02/video** worst case at 40 candidates, typical ~$0.01. Needs one measured value before implementation (single live call on a real candidate row) per the no-unbacked-numbers rule.
- Added latency: sequential 0.5 s × N; parallelize (Promise.all, same pattern as the window harvest) → ~0.5–1 s wall clock.

## 5. Privacy

Transcript excerpt text would flow to TypeSafe via OpenRouter (sub-processor). Same concern class flagged in THOS §6 ("Product candidates... Privacy: transcript/comment text would go to TypeSafe via OpenRouter → sub-processor list before launch"). The reel pipeline already sends full transcripts to OpenRouter for the harvest itself, so Jev adds no NEW data class — but the sub-processor list check still applies before launch.

## 6. Fallback / failure semantics

- Jev down / all-low-confidence / parse-invalid → keep today's behavior (window-harvest order, cap-by-pop). Highlights are best-effort; the ranker must never block or wipe a set.
- Only `highlights.maxCount`-driven trimming consumes scores; nothing else changes shape (schema, persistence, scrubber untouched).

## 7. Alternatives considered

- **Score with the same cheap LLM cascade** (one call ranking all candidates): 1 call instead of N, but no calibrated confidence, and the 2026-09-24 benchmark showed the flash-class models over-rate "should-fix" items — the same over-rating bias would inflate marginal candidates.
- **Heuristic local scoring** (keyword overlap with takeaways): free, deterministic, already proven weak — the digest takeaways only cover 10 topics and keyword overlap mis-locates content (the root cause family of this whole RCA).
- **Do nothing**: model-order wins within each window, first-window-wins across windows. Deterministic but arbitrary — a window's top-3 pop order is just the model's stream order, and cross-window trimming (when over cap) would systematically favor early windows, i.e. the same early-bias bug this task set out to fix, reintroduced through the back door.

## 8. Decision requested

Confirm: (a) adopt Jev as candidate ranker, (b) accept ~$0.01–0.02/video added cost, (c) sub-processor check for transcript excerpts via OpenRouter. If confirmed, implementation is a single post-merge step inside `ExtractHighlightsUseCase` between merge and save, plus one Settings-Registry key for the confidence threshold.
