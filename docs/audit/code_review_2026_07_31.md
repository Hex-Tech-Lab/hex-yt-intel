# Code Review — `cbae120f..HEAD` (2026-07-30/31)

**Reviewer:** Antigravity (Gemini CLI)  
**Branch:** `main`  
**Commits reviewed:** 9 (`af26ecb3` → `261374c1`)  
**Files changed:** 32 | **Lines:** +1,988 / −104  
**Date:** 2026-07-31

---

## Summary

This batch spans six distinct concerns: (1) the jsonrepair simplification of `MarkdownReconstructor`, (2) Phase 2 live SSE re-attach UX, (3) LLMCascade silent-failure telemetry, (4) auth-callback telemetry, (5) the ADR 019 dimension-remediation harness, and (6) chat grounding/citation/timestamp fixes. The work is generally high-quality — real production gaps get fixed, every change is traced back to a live incident or observable failure mode, and the commit messages are model-clear. Findings below are in priority order.

---

## 🔴 Critical

### C1 — `dimension-remediation.ts`: Module-level mutable cache breaks cold-start guarantees on Vercel/Edge

**File:** `web/lib/services/dimension-remediation.ts`

```ts
let cachedRemainingBudgetCents: { value: number; expiresAt: number } | null = null;
```

This is a **module-level singleton** in a **Vercel serverless function**. On Vercel, each function invocation runs in a fresh process; the cache is effectively a no-op and just adds conceptual complexity. More importantly: if Vercel ever does reuse a warm instance across invocations (which it does for hot functions), the cache could serve a **stale balance** from a prior sweep, potentially allowing the token bucket to be filled beyond what the real OpenRouter balance permits. The code comment says "cached briefly (5 min) so every candidate in a run doesn't re-fetch it" — but if a single webhook run processes N candidates sequentially, the first fetch in that run is all you need; `cachedRemainingBudgetCents` only helps across runs, and the cross-run reuse case is exactly when you want a fresh balance.

**Recommendation:** Remove the module-level cache. Fetch the balance once at the top of `runRemediationHarness`, pass it as a parameter down to `resolveBudgetParams`, and let every invocation do one fresh fetch. The extra HTTP round-trip (to OpenRouter's key-info URL) costs ~50–200ms and fires at most once per QStash tick — acceptable.

---

### C2 — `web/app/api/analyses/[id]/status/route.ts`: Returns `analysis_payload` in full — potential OOM on large analyses

**File:** `web/app/api/analyses/[id]/status/route.ts` (line ~70)

```ts
analysisPayload: analysis.analysis_payload || null,
```

`analysis_payload` is a JSONB column that can contain the full synthesis result including knowledge graph entities, classification data, and all 11 dimensions. On a complete analysis this easily exceeds 200 KB. This endpoint is called **every 2.5 seconds** by `useStreamReattach` while an analysis is in progress. The JSONB OOM-prevention skill exists in this codebase (`hex-yt-intel-oom-prevention-jsonb`) for exactly this reason — and this endpoint bypasses it.

The client (`useStreamReattach`) only uses `data.analysisMarkdown` and `data.completedDimensions` from the response; it currently ignores `analysisPayload` entirely (see `useStreamReattach.ts`). 

**Recommendation:** Drop `analysisPayload` from the status response, or at minimum use PostgREST JSONB projection to select only the subfields that are actually consumed. The `analysisMarkdown` field (reconstructed from `analysis_payload`) is already present — that's sufficient for the re-attach UI's dimension parsing.

---

## 🟡 Improvements

### I1 — `useStreamReattach.ts`: Hook fires on every `status === 'analyzing'` — including live client-initiated streams

**File:** `web/hooks/useStreamReattach.ts`

`useStreamReattach` activates whenever `status === 'analyzing'`, but `status` is also set to `'analyzing'` at the **start of every client-initiated SSE stream** (`startAnalysis` in `useSSEStream.ts`). During a normal live analysis, this hook will start polling `/api/analyses/[id]/status` every 2.5 seconds in parallel with the active SSE stream, for the entire duration of the run. That's ~24 concurrent polling fetches for a 60-second analysis — all of which fetch `analysis_payload` (see C2), call `initializeAnalysis`, and call `initSynthesis`, potentially stomping the live store state mid-stream.

The intent is "only re-attach if the client has navigated away and returned, and the stream is no longer live" — but the code has no guard for the live-stream case.

**Recommendation:** Add an `isLiveStreaming` guard. The simplest approach: expose a `isStreaming: boolean` ref from `useSSEStream` (backed by the existing `processingRef`) and pass it as a prop to `useStreamReattach`. The hook should skip polling whenever `isLiveStreaming === true`.

```ts
// In useSSEStream.ts — expose processingRef as a stable boolean ref
// In useStreamReattach.ts
if (!analysisId || status !== 'analyzing' || isLiveStreaming) return;
```

---

### I2 — `useStreamReattach.ts`: No cleanup on completed/errored status transition — interval keeps running one extra tick

**File:** `web/hooks/useStreamReattach.ts`

When `data.status === 'complete'` or `data.status === 'error'`, the hook calls `setStatus(...)` inside `startTransition`, but the `clearInterval(timer)` is only called by the effect cleanup (when the component unmounts or `status` dep changes). Since `setStatus` is async via React's batching and `status` is a zustand selector, there can be 1–2 extra polling ticks before the `status !== 'analyzing'` dep change re-runs the effect and the interval is cleared. Not catastrophic, but it fetches unnecessarily.

**Recommendation:** Use a `stoppedRef` inside the effect to break the polling loop immediately when a terminal state is detected, without waiting for the re-render cycle:

```ts
const stoppedRef = useRef(false);
// inside pollStatus, on terminal state:
stoppedRef.current = true;
setStatus('complete');
// and at the top of the interval callback:
if (stoppedRef.current) clearInterval(timer);
```

---

### I3 — `dimension-remediation.ts`: `OPENROUTER_BALANCE_CACHE_MS` constant is dead for the cross-run caching case but meaningful for the within-run case — the constant and its comment are misleading after C1 is fixed

If C1 is addressed by removing the module-level cache and fetching once per harness run, `OPENROUTER_BALANCE_CACHE_MS` becomes irrelevant. Remove it alongside the cache to avoid confusion.

---

### I4 — `status/route.ts`: `runtime = 'nodejs'` may be unnecessary — check if `verifyResourceOwnership` or `reconstructMarkdown` have Edge blockers

**File:** `web/app/api/analyses/[id]/status/route.ts`

The other `analyses/[id]` routes (`route.ts`, `graph/route.ts`) don't set `runtime` at all (defaulting to Node.js via Next.js App Router defaults). This file explicitly sets `runtime = 'nodejs'`. If `verifyResourceOwnership` and `reconstructMarkdown` are Edge-compatible (they don't use `fs`, `crypto`, etc.), setting `runtime = 'edge'` would reduce cold-start latency for a hot polling endpoint. If they're not Edge-compatible, the `nodejs` is correct but worth a comment explaining why (to avoid a future author "cleaning it up" to edge).

---

### I5 — `supabase/migrations/20260731000000_remediation_budget_settings.sql`: `COMMENT ON COLUMN` references non-existent schema

The migration does `INSERT ... ON CONFLICT (setting_key) DO NOTHING` into `app_settings`, which is clean. But the migration also has `COMMENT ON COLUMN app_settings.updated_at ...` — if `app_settings.updated_at` doesn't have a `DEFAULT now()` trigger, concurrent settings writes could leave `updated_at` stale. Verify that the `app_settings` table's `updated_at` is auto-maintained by a trigger (or swap to `DO UPDATE SET value = EXCLUDED.value, updated_at = now()` to be explicit).

---

### I6 — `MarkdownReconstructor.ts` simplification (`af26ecb3`): `repairUnclosedJson` removal leaves no fallback for the truncation case alone

**File:** `worker/src/services/MarkdownReconstructor.ts`

The simplification commit removes `repairUnclosedJson` on the grounds that `jsonrepair` handles both production failure classes. This is correct in principle, but `jsonrepair` is a heavier dependency (~30 KB minified) that does more than the targeted bracket-append. One edge case: if `jsonrepair` itself throws (e.g. the input is so corrupted it hits an internal error), the `extractJsonPayload` fallback chain has no tier-2 before returning `null`. The existing code had `repairUnclosedJson → jsonrepair → null`, providing a cheap fast-path that reduces jsonrepair invocations. The simplification is defensible, but the comment should acknowledge this tradeoff explicitly.

**Recommendation:** Add a try/catch around the `jsonrepair` call specifically (it may throw, as documented in its README), not just around `JSON.parse(repaired)`. If `jsonrepair` throws, log and return `null` without re-throwing.

---

## 🔵 Nitpicks

**N1** — `useStreamReattach.ts` line 34: `const store = useAnalysisStore.getState()` is called and used only for the `terminalLines.length === 0` check, but the function then reads `logInfo` from the hook's subscribed state (separate selector). Consistent — just slightly unusual to mix getState and hook selectors in the same effect.

**N2** — `web/app/api/analyses/[id]/status/route.ts`: `safeReconstructMarkdown` is a local helper that duplicates the guard already in `web/app/api/analyses/[id]/route.ts` (lines 127–128 there inline it differently). Consider exporting `safeReconstructMarkdown` from `markdown-reconstructor.ts` itself so both routes share one definition.

**N3** — `dimension-remediation.ts` line ~280: The comment `// "resolve once per run" convention the module already applies` refers to `cascade`/`models` resolution, but this convention isn't formally documented or enforced. If it's an important invariant (which it is — it prevents N×M DB lookups per sweep), it deserves a named constant or a JSDoc note on `runRemediationHarness`.

**N4** — `web/lib/redis.ts`: `acquireRedisLock` and `releaseRedisLock` now have Sentry on error paths (good). But both functions are marked `// exported for testing` yet they appear in production code paths. If they're truly test-only they should stay unexported; if they're production utilities, the comment is misleading.

**N5** — `scripts/quality-engine/rules/streaming.ts`: The new `functionBodyMatches` helper deliberately "does NOT chase imports or multi-level call chains." This is well-documented and intentionally limited — just ensure the existing tests (if any) for this rule cover the "helper-in-same-file" case so the one-level resolution isn't silently broken by future refactors.

---

## Testability Notes

- `dimension-remediation.test.ts` covers `computeMissingDimensions` well (5 cases, good edge coverage). The real gaps are the integration paths: `findAnalysesWithMissingDimensions` (the DB query), `remediateAnalysis` (the worker call + stitch), and `runRemediationHarness` (the budget loop). The design doc acknowledges this ("exercised via the live read-only targeting-query verification"). Acceptable for v1 — but `findAnalysesWithMissingDimensions`'s SQL query logic (the `validation_report ->> 'status' = 'partial'` filter + `NOT EXISTS` on `analysis_chunks`) is non-trivial and would benefit from a Supabase local emulator test or at least a fixture-based mock.

- `useStreamReattach` has no test coverage. Given I1 (potential mid-stream stomping), a unit test mocking `status` transitions and verifying that polling only starts when `isLiveStreaming === false` would catch the bug class before it hits production.

---

## Conclusion

**Recommendation: Request Changes** on C1 and C2 before the next production deploy that would exercise the remediation harness or the status polling endpoint under load.

| Finding | Severity | File | Action |
|---|---|---|---|
| C1 — Module-level balance cache | 🔴 Critical | `dimension-remediation.ts` | Fix before remediation harness goes live |
| C2 — Full `analysis_payload` in status endpoint | 🔴 Critical | `status/route.ts` | Drop `analysisPayload` from response |
| I1 — Re-attach hook fires during live streams | 🟡 Medium | `useStreamReattach.ts` | Add `isLiveStreaming` guard |
| I2 — Interval over-runs on terminal state | 🟡 Low | `useStreamReattach.ts` | Add `stoppedRef` pattern |
| I6 — `jsonrepair` may throw, not caught | 🟡 Low | `MarkdownReconstructor.ts` | Wrap in try/catch |
| N1–N5 | 🔵 Nitpick | Various | Optional |

The chat grounding fix (FF771863), auth-callback telemetry (e9772936), telemetry contract rule (8125a011), LLMCascade silent-error fix (6e72ad68), and jsonrepair simplification (af26ecb3) are **approved as-is** — clean, well-scoped, and correctly instrumented.
