# ADR 021: Granular Partial-Resume & Reaper Role Extension

**Filename**: `ADR_021_GRANULAR_PARTIAL_RESUME_AND_REAPER_2026-08-02.md`
**Location**: `docs/specs/`
**Version**: 1.1 (Phase 1 implementation note corrected 2026-08-07 per
Cubic PR #216 review -- see `docs/agent-prompts/2026-08-07-self-pr216-cubic-fixes.md`)
**Build**: hex-yt-intel `feat/adr021-phase1-dimension-persist` (PR #216)
**Timestamp**: Originated 2026-08-02, Phase 1 implemented + corrected 2026-08-07
**Purpose**: Extend the ADR 007 reaper's finalize-vs-discard decision from
whole-row to per-piece (dimension/metadata/transcript/digest/comments)
granularity, so a partial failure only loses the specific piece that failed
instead of the entire analysis.

Status: 🔍 Phase 1 (dimension-level persistence) implemented 2026-08-07 —
see "Phase 1 Implementation Note" below. Phases 2-4 (presence-check-on-resume,
Reaper extension, selective client bundle dispatch) remain 🔍 scoping, not
started.

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
2. **Does the client or the reaper own resume?** — **RESOLVED (Product Owner
   Decision, 2026-08-07)**: neither owns a new tracking mechanism. Reuse the
   existing `remediation_retry_count` field already stored in
   `validation_report` (`web/lib/services/dimension-remediation.ts`) — the
   remediation/reaper path already knows how to query "what's missing" once
   per-dimension data exists to query against (see Phase 1 Implementation
   Note: it already does, via `analysis_chunks.dimensions_covered` /
   `analysis_chunks.payload`, not a new column). No new "what's missing"
   query needed for Phase 1; Phases 2-3 wire the reaper's existing
   finalize/discard decision to read this instead of inventing a parallel
   check.
3. **Staleness threshold value** — reuse the reaper's existing timeout
   constant, or does per-dimension staleness need its own (shorter) value
   since a single dimension is faster than a whole analysis? Still open,
   Phase 2/3 scope.
4. **Retry ceiling** — **RESOLVED (Product Owner Decision, 2026-08-07)**:
   already enforced via the existing Settings Registry key
   `remediation.maxRetries` (default 3, see `dimension-remediation.ts`). No
   new ceiling invented.

All new tunables (if any are added in Phases 2-4) MUST resolve from the
Settings Registry (`setting_definitions`/`setting_values`, via
`SupabaseSettingsAdapter.getRegistrySettings`), classified under the
`analysis.*` or `remediation.*` prefix — never hardcoded (standing directive,
restated explicitly by the product owner this session). Phase 1 required no
new tunable at all (see Implementation Note below) — no new Settings
Registry key or migration was needed.

## Phase 1 Implementation Note (2026-08-07)

**Investigation finding — the ADR's original framing above ("all-or-nothing
at the bundle level... nothing is persisted") was more pessimistic than the
actual code.** Before writing any Phase 1 code, the real write path was
traced end-to-end and verified against live Supabase data:

- `worker/src/routes/analysis.ts`'s `buildStreamResponse` already calls
  `atomicPersist.flush()` unconditionally in the stream's `finally` block —
  a persist attempt fires on every interruption/abort, not only on a clean
  chunk completion. This was already true before Phase 1.
- Each chunk (bundle) already lands in its own durable row: the web-side
  `/api/analyses/persist` route upserts into `analysis_chunks` keyed on
  `(analysis_id, chunk_index)` (`SupabasePersistenceAdapter.persistAnalysisChunk`),
  so one chunk's write does NOT get clobbered by a sibling chunk's write —
  chunk-level persistence, independent per chunk, already existed.
- The real gap was **inside** a single chunk's persist attempt:
  `PersistService.persist()` re-parses the *entire* accumulated `finalText`
  from scratch via `extractJsonPayload` + `jsonrepair`
  (`worker/src/services/MarkdownReconstructor.ts`), and that whole-text pass
  is all-or-nothing — if the trailing (in-flight, uncompleted) dimension's
  text is malformed enough that `jsonrepair` can't produce valid JSON at
  all, `jsonPayload` stays `null` for the ENTIRE chunk, discarding every
  dimension in it even ones that were individually complete and valid.
  Confirmed live via Supabase (`adnmbikaqnxivalqoild`, `analyses` table,
  2026-08-07): multiple real rows with `billing_status='failed'` and
  `dim_count=0` (zero parsed dimensions in `analysis_payload->'dimensions'`)
  despite a non-empty `analysis_markdown` (tens of KB) — the raw text
  survived as an opaque markdown fallback, but the structured per-dimension
  payload did not. Other rows in the same query showed `dim_count=11`
  (full recovery worked fine when `jsonrepair` succeeded) — confirming the
  failure is specifically the extraction step's fragility, not a total
  absence of any persist attempt.
- Separately, the worker already runs an incremental, per-object streaming
  JSON parser, `BracketBuffer` (`worker/src/services/BracketBuffer.ts`).
  **Correction (2026-08-07, Cubic PR #216 review):** the claim originally
  written here — that `BracketBuffer` "confirms each dimension the instant
  its own closing brace streams in, independent of every other dimension's
  fate" — was asserted without reading `BracketBuffer`'s source and is
  **not accurate** for this pipeline's real payload shape. `feed()` only
  emits a fragment when bracket depth returns to `0`, i.e. when a
  **top-level** object closes. The LLM's actual output is one envelope
  object (`{schemaVersion:"2.0", dimensions:[...]}` — see
  `worker/src/services/PromptBuilder.ts`), so individual dimensions sit
  *inside* the `dimensions` array at depth 2, not depth 0 — `feed()` does
  not fire per-dimension while the envelope is still open. The verified
  mechanism (see
  `worker/src/__tests__/bracket-buffer-emission-boundary.test.ts`, added
  2026-08-07) is: `feed()` emits nothing during normal in-progress
  streaming, and any recovery from a truncated/aborted stream comes
  entirely from `BracketBuffer.finalize()`, called once at stream end,
  which best-effort **repairs** the trailing unclosed buffer (naive
  quote/bracket closing) and does a single `JSON.parse` pass over the
  *whole* repaired buffer. This recovers dimensions for many realistic
  truncation points (e.g. a cut mid-content-string, closed by quote+
  bracket repair) but is **not guaranteed** — a truncation mid-key (e.g.
  `{"num`) produces unrepairable JSON and yields zero recovered
  dimensions for that chunk, the same all-or-nothing failure class the
  whole-text `extractJsonPayload`/`jsonrepair` path already has. Phase 1's
  `capturedDimensions` therefore reduces, but does not eliminate, the
  chance of losing already-valid dimensions on abort — it is a best-effort
  improvement layered on an existing weakness, not an independent
  guarantee. This does not invalidate Phase 1 (mergeDimensions() still
  helps whenever `finalize()`'s repair succeeds, which is common), but the
  original "independent recovery always works" framing was wrong and is
  corrected here rather than left standing.

**Fix implemented**: `analysis.ts`'s `onFragment` handler now also appends
each confirmed dimension fragment to a `capturedDimensions` array (a plain
in-memory snapshot, no new DB writes, no new endpoint, no new debounce
interval — the data was already being produced during normal streaming).
`PersistService.persist()` gained a `capturedDimensions` option and a
`mergeDimensions()` helper: it merges `capturedDimensions` with whatever the
whole-text `extractJsonPayload` pass produced (extraction wins per-dimension
on overlap since it may carry a more complete/corrected parse of the same
text; captured fills every dimension extraction missed or dropped entirely),
before Zod schema validation. This makes a captured-only fallback payload go
through the exact same validation/reconstruction/signing path a normal
extraction would — not a parallel code path.

This is a smaller, more surgical change than the ADR originally anticipated
because chunk-level durability and a reliable per-dimension source
(`BracketBuffer`) already existed; the actual bug was that the finalize
path never reused them, and re-derived per-dimension data from scratch via
a fragile all-or-nothing whole-text repair pass instead. No schema
migration, no new Settings Registry key, and no new endpoint were required
for Phase 1 as a result — existing infrastructure covered the gap once
wired together correctly. Phases 2-4 (presence-check-on-resume using
`analysis_chunks.dimensions_covered`, reaper requeue-partial extension,
selective client bundle dispatch) remain out of scope for this pass and
still require their own design/implementation.

## Not in scope for this ADR

- The `ERR_NO_TRANSCRIPT`/`ERR_TRANSCRIPT_PIPELINE_UNAVAILABLE` distinction
  (already shipped, item 13 in `docs/TECH_DEBT_LEDGER.md`) is complementary
  but separate — that's about the *message*, this is about *what gets retried*.
- A universal `reportFailure()` telemetry helper (raised as a follow-up from
  the `MetadataScraper.ts` Sentry-parity fix, item 14) is unrelated scope,
  tracked separately.

## Next step

- **Phase 1 (✅ Implemented 2026-08-07)**: Dimension-level persistence —
  see "Phase 1 Implementation Note" above for what shipped and why the
  actual fix ended up narrower than originally scoped here.
- **Phases 2-4 (Planned, not started)**: Presence check on resume (using
  `analysis_chunks.dimensions_covered`, already populated), Reaper
  finalize/discard/requeue-partial extension, and selective client bundle
  dispatch.
