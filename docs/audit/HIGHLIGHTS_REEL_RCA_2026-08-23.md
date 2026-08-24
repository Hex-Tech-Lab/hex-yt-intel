# Highlights Reel Not Rendering — RCA + Fix (2026-08-23)

## Symptom
The highlights reel was not rendering in the UI even after reanalysis.

## Root cause (verified against the live DB)

Highlights extraction was coupled to the **lazy, cached executive-digest generation pass**, which silently skipped extraction in the common case.

| Check | Result |
|---|---|
| `analysis_highlights` rows | 44 total, across only **2 of 216** analyses |
| Completed analyses | 30 — only 2 have highlights, 28 have none |
| `transcripts` table | 1 row (`CkBCmlvs4X4`, unexpired) — all others purged by the 72h retention window (ADR 012) |

### The failure chain

1. `GenerateExecutiveDigestUseCase.execute()` is the **only** extraction path (`extractHighlights`, which rode the digest pass).
2. The digest is **idempotent**: `if (!force && isStoredDigest(row.executive_digest)) return { cached: true }` — once a digest exists, every subsequent trigger returns early and **never re-runs extraction**. So a first-run extraction failure (transcript not yet warm, LLM error, archived-suffix bug) became **permanent**.
3. Extraction is **coupled to digest success**: if the digest failed (`ERR_DIGEST_UNPARSEABLE`, `ERR_DIGEST_COMPLETION_FAILED`, `ERR_ANALYSIS_MARKDOWN_EMPTY`), extraction was skipped — even though extraction only needs transcript segments, not the digest.
4. Extraction requires `getTranscriptSegments(videoId)` to return non-empty segments, but transcripts are purged after **72h** (ADR 012). The digest is generated lazily on dashboard view — often **after** the 72h window closed → `getTranscriptSegments` returned null → silent no-op.

### Secondary bug
`SupabaseAnalysisAdapter.getTranscriptSegments` (line 838) did **not** call `stripArchivedVideoIdSuffix`, unlike `getAnalysisGrounding` (566) and `findAnalysisByShareToken` (685). Transcripts are stored under the **clean** video_id, but archived rows carry `video_id = '<id>_archived_<ts>'`. A digest/highlights re-trigger on an archived row queried transcripts with the suffixed id and silently found nothing.

## Diagnosis by area (per the original ask)

### 1. Extraction trigger & dataflow
- Highlights are **not** extracted during standard analysis. The only path was `GenerateExecutiveDigestUseCase.extractHighlights`, riding the digest pass.
- Digest triggered lazily: client-side `useExecutiveDigest` on dashboard mount, or via QStash webhook `/api/webhooks/digest` (already fired eagerly at persist finalize — but still subject to the cached-skip + digest-success coupling above).
- `GET /api/analyses/highlights` only **reads** stored rows (RLS owner-only). `findHighlightsForAnalysis` returns `[]` when no rows exist. Data was not dropping in transit — it was never written.

### 2. Reconciliation & parsing audit
- **`web/lib/prompts/highlights-reconciliation.ts` does not exist on `main`.** It exists only on the unmerged PR #267 branch (`fix/highlights-chat-digest-consistency`). The original prompt's premise referenced a file not present in the working tree.
- `parseHighlightsExtraction` filters strictly: both `start` and `end` must be in `validSegmentStarts`; `end <= start` dropped; dedup by start; cap at `maxCount`.
- `'invalid'` (unparseable) correctly does **not** persist (prevents data loss). `'ok'` with empty array does persist empty via `replace_analysis_highlights` — a secondary path, not the main issue.
- No "unhandled fallback returning `[]`"; the silent no-op was upstream (empty/expired transcript).

### 3. UI mount & render
- Dashboard (`DashboardContainer.tsx:730`): `HighlightsScrubber` mounts on `status === 'complete' && analysisId`; renders `null` (fail-quiet) on error or `data.highlights.length === 0`.
- Share (`page.tsx:70`): `PublicHighlightsReel` renders only if `analysis.videoId && highlights.length > 0`.
- No network-layer drop. The component correctly hides itself when there is nothing to show.

## Fix (Option A: decouple extraction from the digest)

### New files
- `web/lib/usecases/ExtractHighlightsUseCase.ts` — standalone extraction (segments → LLM → parse → save), with `skipIfPresent` idempotency short-circuit.
- `web/app/api/webhooks/highlights/route.ts` — dedicated QStash webhook, fired at persist finalize (transcript guaranteed warm), independent of digest success/caching. Mirrors `/api/webhooks/digest`.
- `web/lib/__tests__/extract-highlights-usecase.test.ts` — 9 tests (skipIfPresent, empty/expired transcript no-op, invalid-not-persisted, happy-path idx mapping, failing-read fallthrough, force re-extract, registry-resolved tunables).

### Modified files
- `web/lib/qstash-client.ts` — `publishHighlightsTask` + `HighlightsPayload` (mirrors `publishDigestTask`).
- `web/app/api/analyses/persist/route.ts` — `publishHighlightsTask` at both finalize call sites (chunked + non-chunked), best-effort `.catch` + Sentry.
- `web/lib/usecases/GenerateExecutiveDigestUseCase.ts` — replaced the duplicated `extractHighlights` private method with a delegating `ExtractHighlightsUseCase` call (fallback role, `skipIfPresent`); −88 lines net.
- `web/lib/ports/ExecutiveDigestPorts.ts` — added `findHighlightsForAnalysis` to `DigestPersistencePort` so the digest use case's persistence satisfies `HighlightsPersistencePort`.
- `web/lib/adapters/SupabaseAnalysisAdapter.ts` — `getTranscriptSegments` now strips the archived suffix (consistency + defense-in-depth).

### Why this fixes it
- **Primary**: extraction now runs at finalize (transcript just upserted, guaranteed within 72h), via a dedicated QStash task — independent of whether the digest succeeds, fails, or is already cached.
- **Idempotent**: `skipIfPresent` means a re-persist / remediation re-run / redundant client trigger re-spends nothing if a set already exists.
- **Retried**: QStash retries (3 attempts) on transient failure (503).
- **Defense-in-depth**: archived-suffix fix closes the no-op path for archived rows.

### Three trigger paths (all idempotent, belt-and-suspenders)
1. QStash highlights webhook (new, primary — fires at finalize).
2. Digest use case fallback (skipIfPresent — fills the gap only if the dedicated task failed and the digest later runs within 72h).
3. Client-side digest trigger (dashboard mount → digest → fallback extraction).

## Gates
- web `tsc --noEmit`: 0 errors.
- vitest: 104 files / 1268 passed / 16 skipped.
- ESLint: 0 errors (5 pre-existing warnings, none in changed files).

## ⚠️ Conflict flag
PR #267 (`fix/highlights-chat-digest-consistency`, unmerged, commit `e4c3b1e3`) adds `highlights-reconciliation.ts` and modifies `GenerateExecutiveDigestUseCase.ts`, `ExecutiveDigestPorts.ts`, `SupabaseAnalysisAdapter.ts`, and the persist route. This fix will **conflict** with it on merge. Decision needed: land on `main` and rebase PR #267, or land on the PR #267 branch.

## Backfill note (not in scope)
The 28 existing completed analyses without highlights will not get highlights without reanalysis (their transcripts are purged). A one-time backfill script (re-fetch transcript from YouTube → extract → save) was offered but declined. Reanalyzing those videos will produce highlights via the new finalize path.
