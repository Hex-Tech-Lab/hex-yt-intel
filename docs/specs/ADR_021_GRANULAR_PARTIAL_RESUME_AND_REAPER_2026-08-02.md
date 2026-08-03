# ADR 021: Granular Partial-Resume & Reaper Role Extension

Status: 🔍 Scoping — not yet implemented. This document exists to get sign-off
on the design before any code changes.

## Context

Today an analysis is all-or-nothing at the bundle level. 5 bundles fire in
parallel to the CF worker; if `abortOnPartialFailure` (default `true`) is on
and even one bundle fails (e.g. a transient network error), the whole
analysis is marked failed and nothing is persisted. A rerun redoes all 5
bundles from scratch — including the 4 that already succeeded and already
cost real LLM spend.

This surfaced from a live incident (video `LTNVA2iP9YU`, 2026-08-02): Bundle
1 completed, Bundle 5 hit a network error, the whole analysis was discarded.
User's explicit ask, paraphrased: *if 11 dimensions are outstanding and 8
already succeeded, why regenerate all 11? If a bundle of 3 has 2 that came
through, why redo all 3? The same logic should apply to every piece of an
analysis — dimensions, metadata, transcript, digest, comments — not just the
LLM cascade.*

The existing reaper (ADR 007, PR #110) already does a version of this
decision at the row level: it sweeps analyses stuck in `processing` past a
timeout and decides finalize-with-partial-results vs. discard. This ADR
extends that same decision to sub-row granularity instead of introducing a
new mechanism.

## Decision

**One rule, uniformly applied**: for every independently-fetchable piece of
an analysis (each of the ~16 dimensions, metadata, transcript, digest,
comment batches), track presence explicitly. On any resume — whether
triggered by the client retrying, or the reaper sweeping a stuck row — the
rule is the same: *present → leave alone. Missing → refetch that piece only.*

This is deliberately **not** a new "smart" decision engine. It's the
existing binary reaper decision (finalize vs. discard), just evaluated per
dimension instead of per row. The one place a second decision genuinely
exists (not a contradiction of the single-rule framing, a necessary
guardrail around it):

- **Staleness threshold**: how long a piece can sit "in flight" before it's
  treated as failed rather than just slow. The reaper already has this
  concept (its sweep timeout) — reused, not reinvented.
- **Retry ceiling**: a piece that fails N times in a row (video deleted,
  account banned, permanently malformed request) must stop being retried
  forever. Without this, a permanently-broken piece turns into an infinite
  reaper loop.

Everything else is the single rule above.

## What changes

### 1. Persistence — write per-piece, not just at final completion

Each dimension result, once returned by the LLM cascade, is persisted
immediately (not held in memory until all 5 bundles finish). The `analyses`
row already has per-dimension JSON columns for the final state — the change
is *when* they're written, not the schema shape. Same principle for
metadata/transcript/digest/comments: write as soon as available, not
batched behind the slowest piece.

### 2. Resume logic — check presence before requesting

On (re)start of an analysis — whether a fresh client retry or a reaper-driven
requeue — check what's already persisted per piece. Only request the LLM
cascade for genuinely-missing dimensions; only re-fetch metadata/transcript/
comments if those specific pieces are missing. This is Law #1 (pre-query
cache-hit) generalized from "is there a complete cached analysis" down to
"which specific pieces of this analysis are missing."

### 3. Reaper — extend finalize/discard to finalize/discard/requeue-partial

The reaper's sweep loop, timeout detection, and row-selection logic are
unchanged. Its decision function gains a third outcome: instead of only
"finalize with whatever's there" or "discard," it can "requeue only the
missing pieces" when partial data exists and the row hasn't hit the retry
ceiling. This directly extends PR #187's "salvage partial chunk sets instead
of discarding them" work — same spirit, applied one layer deeper.

### 4. Client — bundle orchestration becomes selective

`useSSEStream.ts`'s 5-parallel-bundle dispatch needs to know, on a retry,
which specific dimensions (not which whole bundles) to actually request.
This is the piece most likely to need a real redesign rather than an
extension — the current bundle boundary is a batching convenience for the
LLM cascade, not a semantically meaningful unit once resume is
per-dimension.

## Open questions (need answers before implementation starts)

1. **Bundle-level or dimension-level for v1?** — **RESOLVED (Product Owner Decision, 2026-08-03)**: **DIMENSION-LEVEL**. We go directly to per-dimension granular tracking and persistence for v1 rather than bundle-level batching.
2. **Does the client or the reaper own resume?** The client already retries
   on user action; the reaper resumes on a timer. Both paths need to agree
   on the same "what's missing" query, ideally one shared function, not two
   implementations that can drift.
3. **Staleness threshold value** — reuse the reaper's existing timeout
   constant, or does per-dimension staleness need its own (shorter) value
   since a single dimension is faster than a whole analysis?
4. **Retry ceiling** — how many attempts before a piece gives up permanently
   and surfaces to the user as "this specific part couldn't be completed"
   rather than silently retrying forever?

## Not in scope for this ADR

- The `ERR_NO_TRANSCRIPT`/`ERR_TRANSCRIPT_PIPELINE_UNAVAILABLE` distinction
  (already shipped, item 13 in `docs/TECH_DEBT_LEDGER.md`) is complementary
  but separate — that's about the *message*, this is about *what gets retried*.
- A universal `reportFailure()` telemetry helper (raised as a follow-up from
  the `MetadataScraper.ts` Sentry-parity fix, item 14) is unrelated scope,
  tracked separately.

## Next step

- **Phase 1 (Active)**: Implement **dimension-level** per-piece persistence. Each dimension result returned by the LLM cascade is written immediately to Supabase `analyses` (not held until all bundles finish).
- **Phases 2-4**: Presence check on resume, Reaper extension, and selective client bundle dispatch (will follow after Phase 1 lands).
