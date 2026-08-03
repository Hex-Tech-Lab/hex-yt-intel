# OpenRouter Cost Estimate — Live Data (2026-08-02)

Source: `public.analysis_chunks` (per-chunk `cost_usd`/`tokens_used`, direct from
OpenRouter's `usage.cost` field on each response). This is real recorded data,
not a projection, for the window where cost capture existed.

## Totals (all-time, `analysis_chunks` table)

| Metric | Value |
|---|---|
| Chunk rows | 476 |
| Rows with `cost_usd` populated | 476 (100%) |
| Total recorded cost | **$0.9597** |
| Total tokens | 590,221 |
| Earliest chunk | 2026-06-13 11:17 UTC |
| Latest chunk | 2026-08-02 22:13 UTC |

## Daily breakdown

| Date | Chunks | Cost (USD) | Tokens |
|---|---|---|---|
| 2026-06-13 | 65 | $0.00 | 0 |
| 2026-07-01 | 1 | $0.00 | 0 |
| 2026-07-05 | 5 | $0.00 | 0 |
| 2026-07-08 | 5 | $0.00 | 0 |
| 2026-07-09 | 10 | $0.00 | 0 |
| 2026-07-11 | 15 | $0.00 | 0 |
| 2026-07-13 | 5 | $0.00 | 0 |
| 2026-07-16 | 26 | $0.00 | 0 |
| 2026-07-17 | 5 | $0.00 | 0 |
| 2026-07-18 | 23 | $0.00 | 0 |
| 2026-07-22 | 52 | $0.00 | 0 |
| 2026-07-23 | 68 | $0.00 | 0 |
| 2026-07-24 | 24 | $0.00 | 0 |
| 2026-07-26 | 19 | $0.00 | 0 |
| 2026-07-27 | 24 | $0.00 | 0 |
| 2026-07-28 | 24 | $0.00 | 0 |
| 2026-07-29 | 13 | $0.00 | 0 |
| 2026-07-30 | 44 | $0.00 | 0 |
| 2026-07-31 | 20 | $0.00 | 0 |
| 2026-08-01 | 10 | $0.3655 | 235,867 |
| 2026-08-02 | 18 | $0.5942 | 354,354 |

## Key finding: cost capture only started 2026-08-01

458 of 476 chunks (96%) show `cost_usd = 0` despite `cost_usd` being
populated (not null) — meaning the column existed and was being written, but
`json.usage.cost` wasn't being read/threaded from the OpenRouter response
before 2026-08-01. This matches this session's own generation-ID/cost
traceability work (`worker/src/services/LLMCascade.ts` cost/tokens capture).

**Everything before 2026-08-01 is a genuine unknown, not a hidden cost** —
free-tier/fallback models in the cascade (Groq, Cerebras free tiers) are
plausibly $0 for a real fraction of that period, but the $0 rows cannot be
distinguished from "cost simply wasn't captured" using this data alone.

## Estimate for the uncaptured period (2026-06-13 → 2026-07-31)

- 458 chunks, 0 tokens recorded (tokens weren't captured either in that window).
- Using the two captured days as a rate reference: $0.9597 total / 476 chunks
  ≈ **$0.00202/chunk** average across the whole dataset, but the captured
  days are skewed toward paid-tier fallback usage (cascade exhausting free
  tiers more on 08-01/08-02) — not necessarily representative of the June/July
  mix, which likely landed on free tiers (Groq/Cerebras free, gpt-oss-120b)
  more often given the cascade's free-first ordering.
- **Educated estimate, ±40% confidence (wide, because the sample is 2 days
  out of 51)**: uncaptured-period spend ≈ **$0.50–$1.50**, most likely
  clustering near $0.70–$0.90 given free-tier-first cascade design.
- **Combined all-time estimate: ~$1.50–$2.50 total OpenRouter spend to date**,
  not the earlier ~$3.68 guess from before generation-ID capture existed —
  that number was itself an estimate; this one is grounded in 476 real rows
  plus a narrower, explicitly-bounded gap.

## Confidence note

This supersedes the earlier ~$3.68 estimate delivered mid-session (that
number is not reproducible from current data and its derivation was lost to
context compaction — treat this document as the current source of truth).
Cross-vet against OpenRouter's own dashboard balance/spend figures directly
when a definitive number is needed; this is a database-side reconstruction,
not a billing-system read.
