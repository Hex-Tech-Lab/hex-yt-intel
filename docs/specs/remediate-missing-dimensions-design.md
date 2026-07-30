# remediate-missing-dimensions — Design (not yet implemented)

## Problem

`sweepStuckAnalyses` (`web/lib/services/analysis-reaper.ts`, ADR 007) settles
analyses stuck in `billing_status = 'processing'` to a terminal state
(`completed`/`failed`). It never regenerates content — a genuinely
missing dimension in an otherwise-`completed` analysis stays missing
forever. Today the only user-facing remediation is the full "Re-analyze"
button, which regenerates all 11 dimensions even if only 1 is missing.

## Reuse, not reinvent

Two pieces of existing infrastructure already do everything this needs —
confirmed via direct code trace, not assumption:

1. **Per-dimension generation is already a live capability of the worker
   route**, not something to build. `worker/src/routes/analysis.ts:840`
   threads `req.dimensions: number[]` straight into
   `engine.executeAndStream({ dimensions: req.dimensions, ... })`
   (`ReasoningEnginePort.executeAndStream`, `worker/src/ports/ReasoningEnginePort.ts:51`).
   The web side's bundle orchestration already calls this same endpoint 5x
   in parallel, each call scoped to a subset of dimension numbers. A
   remediation call is structurally identical to one bundle call — just
   with `dimensions: [missingDimNumber]` and no siblings.

2. **Merging generated content back into the stored payload is already a
   named, extracted port.** `stitchChunksIntoPayload`
   (`web/lib/services/stitch-analysis-chunks.ts:86`) was pulled out of
   `persist/route.ts` specifically so the reaper's chunk-recovery path
   (`tryChunkRecovery`) could reuse the exact same stitching/validation
   logic instead of a second divergent copy — its own docstring says so.
   Remediation reuses this port the same way `tryChunkRecovery` already
   does.

Nothing here needs new generation or merge logic. It needs new
**orchestration**: decide which analyses have a missing dimension, call
the existing per-dimension port for just that dimension, stitch the
result in with the existing port, persist.

## Architecture: separate route, separate cron, single responsibility

Per the earlier discussion in this session, this stays **out of**
`analysis-reaper.ts`. `sweepStuckAnalyses` has exactly one consumer today
(billing/history status settlement) with one guarantee (never leaves an
analysis in `processing` past the grace window). Adding remediation would
give the same function two callers with different guarantees — a stuck
sweep that also silently retries content generation changes its blast
radius and its failure semantics. Keep them siblings, not one merged
function.

```
web/lib/services/dimension-remediation.ts   (new — mirrors analysis-reaper.ts's shape)
  findAnalysesWithMissingDimensions(opts?: { limit?: number }): Promise<AnalysisGap[]>
  remediateAnalysis(gap: AnalysisGap): Promise<RemediationResult>

web/app/api/webhooks/remediate-dimensions/route.ts   (new — mirrors webhooks/reaper/route.ts exactly)
  POST: verifyQStashSignature → for each gap, remediateAnalysis() → return stats

web/scripts/setup-qstash-cron.ts
  new schedule: dimension-remediation, e.g. */30 * * * * (separate cadence from the
  15-min reaper — remediation is lower urgency than stuck-state settlement)
```

## `findAnalysesWithMissingDimensions`

**Verified against production data (2026-07-30, 179 total analyses):**
partial analyses are NOT tagged `billing_status = 'partial'` — the
reaper's `buildSettlePatch` settles them to `billing_status = 'failed'`
with `validation_report.status = 'partial'`. The correct target query is
`billing_status = 'failed' AND validation_report->>'status' = 'partial'`
(never `processing` — that is the reaper's territory, not this one), plus
a markdown-length floor (`length(analysis_markdown) > 0`) to exclude total
losses. Real distribution found: 8 `completed`/`partial` + 31
`failed`/`partial` + 6 `failed`/null-with-content = **~45 of 179 analyses
(25%)** have real partial content and no path back to completion today
except a full re-run. This is not a rare edge case — it justifies
building this now rather than leaving it as a spec.

Also confirm `completedDimensions.length < TOTAL_DIMENSIONS` via the same
dimension-counting logic `web/app/api/analyses/[id]/status/route.ts`
already uses (`parseToUCISDimensions` → `completedDimensions`) — reuse
that too rather than re-deriving dimension counts a third way. The
`validation_report.status = 'partial'` tag is the cheap first filter;
the parsed dimension count is the authoritative check before spending a
worker call on it.

Cap the batch per run (`limit`, default e.g. 10) so one cron tick can't
fan out unboundedly if a schema issue suddenly makes many analyses look
incomplete at once. At ~45 backlog rows today, a first backfill run will
need several ticks regardless — don't try to clear the backlog in one
invocation.

## `remediateAnalysis(gap)`

1. Compute `missingDimensions = allDimensions - gap.completedDimensions`.
2. Call the worker's existing `/analyze` (bundle) endpoint once with
   `dimensions: missingDimensions` — same shape as any other bundle call,
   just scoped to the gap instead of a fixed 1/5 partition.
3. On success, run `stitchChunksIntoPayload` against
   `[...existingChunks, newChunk]` — the existing port already handles
   merging N chunks into one payload; feeding it the old payload's chunks
   plus the new one is exactly what it already does for the 5-bundle case.
4. Persist via the same `AnalysisPersistencePort` write path
   `CreateAnalysisUseCase` and the reaper both already use — no new
   persistence code.
5. Idempotency/concurrency: **implemented as a harness**, not a bare loop.
   A single Redis run-level lock (NX+TTL) guarantees at most one harness
   invocation is ever active repo-wide — the primary guard against two
   overlapping cron ticks double-processing (and double-paying for) the
   same candidates. The final write is guarded on `billing_status='failed'`
   (same single-winner pattern `sweepStuckAnalyses` uses) so a concurrent
   "Re-analyze" always wins. Candidates within a run are processed
   sequentially with an explicit stagger delay between worker calls, so a
   larger batch never fires many simultaneous OpenRouter calls. (An earlier
   draft also had a per-row Postgres claim/lease; removed after review as
   redundant once the run-level lock guarantees no two callers can ever
   reach the same row concurrently.)

## Failure handling

Per this session's "Sentry is part of every contract" mandate and the
newly-added `SILENT_ERROR_RETURN_NO_TELEMETRY` contract-auditor rule: any
non-2xx from the worker call or any stitch/persist failure must
`Sentry.captureException`/`captureMessage` before returning — do not let
a remediation failure silently no-op the way the original LLMCascade gap
did. A failed remediation attempt should leave the analysis exactly as it
was (still missing the same dimension) and log why, so the next cron tick
retries with full context available if it happens again.

## Explicitly out of scope for this design

- No change to the "Re-analyze" button's full-regeneration behavior.
- No change to `sweepStuckAnalyses` itself.
- No UI surfacing of "this analysis was remediated" — status route already
  reports `completedDimensions`, that's enough for now.

## Status

Design only. Not implemented, not scheduled. Confirm before building:
cron cadence, batch limit, and whether remediation should be opt-in
per-analysis (a button) vs. fully automatic on a schedule.
