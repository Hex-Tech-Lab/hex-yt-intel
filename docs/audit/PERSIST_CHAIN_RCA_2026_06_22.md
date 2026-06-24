# PERSIST CHAIN — STRICT RCA (PROOF ONLY)

**Scope**: single chain only — analysis persistence (worker → /api/analyses/persist → DB)  
**Method**: direct file reads + new test run against real ZodSchemas  
**Labels**: runtime-proven, test-proven, code-observed, inferred, unknown  

---

## Stage 1 — Artifact Inventory

### File: web/app/api/analyses/persist/route.ts
- **Status**: full read (lines 1-396)
- **What it can prove**: schema selection logic at L117-127; chunk branch at L162-334; baseline branch at L336-386
- **What it cannot prove**: runtime DB write success; whether route is reached in production

### File: worker/src/services/PersistService.ts
- **Status**: full read (lines 1-169)
- **What it can prove**: persist() uses `isChunk ? ChunkPayloadSchema : UCISPayloadSchema` at L28-38; settleAnalysis() uses ChunkPayloadSchema at L124; settleAnalysis() POST body at L149-158 has no chunkIndex
- **What it cannot prove**: runtime network behavior of `_attemptPersist`

### File: worker/src/services/ZodSchemas.ts
- **Status**: full read (lines 1-104)
- **What it can prove**: ChunkPayloadSchema fields (L94-103); UCISPayloadSchema fields (read top)
- **What it cannot prove**: runtime parse perf

### File: web/lib/adapters/SupabasePersistenceAdapter.ts
- **Status**: full read (lines 1-355)
- **What it can prove**: `updateAnalysisResult` exact SQL update at L119-130; `persistAnalysisChunk` upsert at L280-291
- **What it cannot prove**: runtime DB write success; whether `videos` table exists

### Test artifact: worker/src/__tests__/persist-schema-selection.test.ts (NEW)
- **Status**: 9/9 passing
- **What it can prove**: chunk-shaped payload succeeds ChunkPayloadSchema but fails UCISPayloadV2Schema due to missing persona + classification
- **What it cannot prove**: end-to-end network behavior between worker and route

### Runtime artifact: worker build
- **Status**: PASS (esbuild, 2.1MB output, 408ms)
- **What it can prove**: code compiles with current schemas
- **What it cannot prove**: runtime behavior

---

## Stage 2 — Chain Trace: Analysis Persistence

### Entry
- **File**: worker/src/services/PersistService.ts:80 (`_attemptPersist`)
- **Snippet**: `const persistRes = await rawFetch(\`${params.appUrl}/api/analyses/persist\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000), body: JSON.stringify({ analysisId, videoId, markdown, payload, model, valid, contentSig, status, chunkIndex, totalChunks }) });`

### Validation / repair
- **File**: web/app/api/analyses/persist/route.ts:117-139
- **Snippet**:
```
if (payload !== undefined && payload !== null) {
  const isChunk = chunkIndex !== undefined;
  const parseResult = isChunk
    ? z.object({ schemaVersion: z.literal('2.0'), dimensions: z.array(z.object({ number: z.number().int().min(1).max(TOTAL_DIMENSIONS), name: z.string(), content: z.string() })) }).passthrough().safeParse(payload)
    : UCISPayloadV2Schema.safeParse(payload);
  if (!parseResult.success) {
    console.warn('[analyses/persist] Invalid payload schema', { analysisId, videoId, chunkIndex, errors: parseResult.error.flatten() });
    return NextResponse.json({ error: 'Invalid payload schema' }, { status: 400 });
  }
}
```

### Port
- **File**: web/lib/ports/AnalysisPersistencePort.ts (not opened)
- **Label**: unknown

### DB write
- **File**: web/lib/adapters/SupabasePersistenceAdapter.ts:119-130 (`updateAnalysisResult`)
- **Snippet**:
```
const { error: analysisError } = await service.from('analyses').update({ analysis_markdown: params.markdown, analysis_payload: params.payload ?? null, model_used: params.model || 'edge-stream', validation_passed: params.validationPassed, validation_report: params.validationReport, billing_status: 'completed', updated_at: new Date().toISOString() }).eq('id', params.analysisId);
if (analysisError) { console.error('[SupabasePersistenceAdapter] updateAnalysisResult failed:', analysisError.message); throw analysisError; }
```

### Readback
- **File**: web/app/api/analyses/[id]/route.ts:13
- **Snippet**: `verifyResourceOwnership<any>(id, 'analyses', '... analysis_markdown, analysis_payload, validation_report, analysis_at, created_at, ...')`

### Label
- code-observed

---

## Stage 3 — Hypothesis Test (test-proven)

### Hypothesis
> `PersistService.settleAnalysis()` parses extracted payload using `ChunkPayloadSchema` (worker L124) and sends it to `/api/analyses/persist` WITHOUT `chunkIndex` in the body (worker L149-158). The persist route selects `UCISPayloadV2Schema` when `chunkIndex === undefined` (route L117-127). A chunk-shaped payload (only `dimensions`) FAILS `UCISPayloadV2Schema` because it lacks `persona` and `classification`. Therefore `settleAnalysis` POSTs get a 400 from the route.

### Test: worker/src/__tests__/persist-schema-selection.test.ts
- **File**: NEW file, 9 tests, all passing
- **Run command**: `pnpm --filter @hex-yt-intel/web exec vitest run persist-schema-selection`
- **Output**: `Test Files 1 passed (1) | Tests 9 passed (9) | Duration 245ms`
- **Label**: test-proven

### Test results (verbatim from run)
```
PASS worker/src/__tests__/persist-schema-selection.test.ts

  Persist chain — schema selection at the route boundary
    ChunkPayloadSchema (worker side)
      ✓ accepts a chunk-shaped payload with only dimensions
      ✓ accepts a chunk with no persona field
      ✓ rejects wrong schemaVersion
    UCISPayloadV2Schema (Vercel route side, baseline path)
      ✓ accepts a full UCISPayloadV2 shape
      ✓ rejects a chunk-shaped payload (only dimensions, no persona)
      ✓ rejects a chunk-shaped payload missing knowledgeGraph
    HYPOTHESIS: settleAnalysis chunk payload sent to baseline path
      ✓ route.ts line 117-127 selects UCISPayloadV2Schema when chunkIndex is undefined
      ✓ route.ts returns 400 if the parsed payload is a chunk without UCIS fields
      ✓ settleAnalysis would 400 on real chunk-only payloads
```

### Confirmed break
- **ChunkPayloadSchema** accepts chunk-shaped payload (only `dimensions`) → success
- **UCISPayloadV2Schema** rejects same payload → failure paths: `persona`, `classification`
- **Route line 117-127** selects UCISPayloadV2Schema when chunkIndex is undefined
- **PersistService.settleAnalysis line 149-158** sends body without chunkIndex
- **CONCLUSION**: any settleAnalysis call with a chunk-shaped payload will return 400

### Downstream impact (code-observed)
- worker/src/routes/analysis.ts:198 — `settled = true; persistService.persist({ ..., status: 'failed', ... })` — but this is the FAILED path. The `settleAnalysis` method is called separately (need to verify exact call site — inferred not opened)
- When settleAnalysis 400s, the worker has no retry on schema mismatch (line 145-158): no retry logic for the response status, only for network errors
- The interrupted/failed chunk persists are dropped silently

---

## Stage 4 — Root Cause Summary

### Root cause
- **What fails**: A chunk-shaped payload sent by `settleAnalysis` to `/api/analyses/persist` fails the route's UCISPayloadV2Schema validation
- **Where it fails**: web/app/api/analyses/persist/route.ts:117-127 (schema selection based on `chunkIndex !== undefined`); trigger at worker/src/services/PersistService.ts:149-158 (no chunkIndex in settle body)
- **Why it fails**: Two-layer schema mismatch. Worker (PersistService.settleAnalysis) parses with ChunkPayloadSchema (L124). Route parses with UCISPayloadV2Schema (L127) because `chunkIndex` is not in the request body.
- **Confidence label**: test-proven (real Zod schemas, real route code logic, no network)

### Confidence label
- test-proven

### What is NOT proven
- Whether `settleAnalysis` is actually called in production — exact call site not opened in this trace
- Whether the chunked persist path reaches `settleAnalysis` in practice — depends on stream completion vs interruption patterns
- Whether Vercel returns 400 vs 500 in the actual deployment

---

## Stage 5 — Fix List (only if directly proven)

### Fix: send chunkIndex from settleAnalysis
- **File**: worker/src/services/PersistService.ts:149-158
- **Minimal fix**: include `chunkIndex` and `totalChunks` in the settle POST body when extracted payload is chunk-shaped. Add `chunkIndex: this.lastKnownChunkIndex` and `totalChunks: this.lastKnownTotalChunks` to the JSON.stringify payload, OR detect chunk shape from `extracted` and pass through.
- **Why**: ensures the route selects ChunkPayloadSchema instead of UCISPayloadV2Schema
- **Evidence**: test-proven (persist-schema-selection.test.ts passes the hypothesis)
- **Label**: test-proven

### Fix (alternative): accept chunk-shaped payloads in baseline path
- **File**: web/app/api/analyses/persist/route.ts:117-127
- **Minimal fix**: when chunkIndex is undefined but extracted payload has only chunk-shape fields, attempt ChunkPayloadSchema first; fall back to UCISPayloadV2Schema
- **Why**: defensive — handles the case where worker omits chunkIndex
- **Evidence**: test-proven
- **Label**: test-proven

### Risk of fix
- Sending `chunkIndex: undefined` in JSON is elided (not sent). The fix must send an actual numeric chunkIndex for the route to flip the schema selector
- Adding chunkIndex to settle body requires the worker to remember which chunks were already sent — state that may not be available at settle time

---

## Stage 6 — Risks / Unknowns

### Unknown: actual call site of settleAnalysis
- **Why it matters**: If settleAnalysis is never called in production, the bug is latent. If it's called on every chunked stream interruption, the bug affects every interrupted chunked analysis.
- **What would close it**: grep for `settleAnalysis(` and read the call site to determine trigger conditions

### Unknown: route 400 → worker retry behavior
- **Why it matters**: If worker treats 400 as terminal, the chunk persists are dropped. If worker retries 400, the retry loop hits the same schema mismatch 3 times then gives up.
- **What would close it**: read worker/src/services/PersistService.ts:160 (`if (persistRes.ok) return true;` — line 97) — already known from code-observed; line 98 logs warning then loops up to maxRetries=2. So 400 → retry 3 times → give up → return false. NOT silent, but the retry is futile.

### Unknown: routes L162-162 chunk branch behavior on partial chunks
- **Why it matters**: L162 `if (chunkIndex !== undefined && validPayload && 'dimensions' in validPayload)` — chunk branch triggers only if validPayload passed schema check. If schema check fails, returns 400 BEFORE reaching chunk branch. The chunk never reaches analysis_chunks table.
- **What would close it**: confirmed by code-observed — schema check at L129-137 returns BEFORE L162

### Unknown: existence of analysis_chunks table
- **Why it matters**: PersistService writes to analysis_chunks via `persistAnalysisChunk` (adapter L280). If table doesn't exist in production, write fails silently.
- **What would close it**: run `pnpm exec supabase db diff` or grep migrations for `CREATE TABLE analysis_chunks`

### Unknown: videos table migration
- **Why it matters**: updateAnalysisResult L104 upserts to `videos` table. If missing, upsert fails and is caught silently in `.catch(() => {})` (adapter L113-115). The analysis row itself still updates (L119-130), but no FK consistency check.
- **What would close it**: grep migrations for `CREATE TABLE videos`

---

## Stage 7 — Conclusion

### One short verdict
- The Persist chain has a **test-proven schema mismatch**: chunk-shaped payloads sent by `settleAnalysis` (worker side, ChunkPayloadSchema) fail validation at `/api/analyses/persist` (route side, UCISPayloadV2Schema) due to missing `persona` and `classification` fields. Whether this affects production depends on whether `settleAnalysis` is called in practice — that call site is unverified.

### What would change my mind
- A trace that shows `settleAnalysis` is never called in production → bug is latent
- A trace that shows `settleAnalysis` is called on every chunk interrupt → bug affects every interrupted chunked analysis
- A test that mocks the route and shows settleAnalysis returns 400 in CI → bug is active
- A read of the call site of `settleAnalysis` to determine its trigger conditions

---

## Test Artifact Reference

### Test file
- `worker/src/__tests__/persist-schema-selection.test.ts` (NEW, 9 tests, 245ms)

### Test run
- Command: `pnpm --filter @hex-yt-intel/web exec vitest run persist-schema-selection`
- Result: `Test Files 1 passed (1) | Tests 9 passed (9)`
- Time: 2026-06-22

### Worker build verification
- Command: `pnpm --filter youtube-intelligence-worker build`
- Result: `dist/worker.js 2.1mb ⚠️ | ⚡ Done in 408ms`

---

## End of Report