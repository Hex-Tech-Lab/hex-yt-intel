# ANALYSIS PERSISTENCE RCA ONLY

**Scope**: UI → worker → `/api/analyses/persist` → Supabase write. No vector, no chat, no browser.  
**Labels**: runtime-proven, test-proven, code-observed, inferred, unknown  

---

## Stage 1 — Artifact Inventory

### File: web/components/containers/DashboardContainer.tsx
- **Status**: full read (post PR #97)
- **Proves**: UI entry for analysis trigger at L301-310
- **Cannot prove**: runtime execution of startAnalysis

### File: web/hooks/useSSEStream.ts
- **Status**: full read (lines 47-349)
- **Proves**: startAnalysis sends POST to /api/analyses, receives stream URL, connects SSE to worker
- **Cannot prove**: SSE connection succeeds in browser

### File: web/app/api/analyses/route.ts
- **Status**: full read (lines 1-114)
- **Proves**: auth → CreateAnalysisUseCase.execute → returns stream URL
- **Cannot prove**: runtime auth success

### File: web/lib/usecases/CreateAnalysisUseCase.ts
- **Status**: full read (lines 1-196)
- **Proves**: 7 steps: cache hit → quota → ingestion + Decodo fallback → persona → stub insert → HMAC sign → stream URL return
- **Cannot prove**: any individual step's runtime success

### File: worker/src/routes/analysis.ts
- **Status**: full read (lines 1-453), timeout fallback fix applied at L202-203
- **Proves**: 4 persistService.persist() call sites at L176, L193, L417, L433; HMAC verify; transcript gate
- **Cannot prove**: runtime cascade completion or stream timeout

### File: worker/src/services/PersistService.ts
- **Status**: full read (lines 1-169)
- **Proves**: persist() schema selection L29-30; _attemptPersist POST L80-96; settleAnalysis is dead code (never called)
- **Cannot prove**: runtime HTTP success of _attemptPersist

### File: web/app/api/analyses/persist/route.ts
- **Status**: full read (lines 1-396)
- **Proves**: HMAC verify L96-111; schema selection L117-127; chunk stitch L162-330; full baseline L336-386
- **Cannot prove**: runtime DB write

### File: web/lib/adapters/SupabasePersistenceAdapter.ts
- **Status**: full read (lines 83-177 updateAnalysisResult)
- **Proves**: video upsert L100-115; analysis row update L119-130 writing analysis_markdown, analysis_payload, billing_status='completed'; KG cascade L138-156; chunk upsert L159-176
- **Cannot prove**: SQL execution; existence of `videos` table

### Test: worker/src/__tests__/persist-schema-selection.test.ts
- **Status**: 9/9 passing at 2026-06-22T23:43:10 and re-verified 2026-06-23T00:04:15
- **Proves**: ChunkPayloadSchema accepts chunk shape; UCISPayloadV2Schema rejects chunk shape on missing `persona` + `classification`
- **Cannot prove**: end-to-end HTTP call

### Build: pnpm --filter youtube-intelligence-worker build
- **Status**: 2.1mb, 408ms
- **Proves**: worker code compiles
- **Cannot prove**: runtime behavior

---

## Stage 2 — UI → Worker → Persist

### Step 1: UI trigger
- **File**: web/components/containers/DashboardContainer.tsx
- **Line#**: 301-310 (post PR #97)
- **After**: `startTransition(() => { startAnalysis(url, getUserTimezone()); })` (handleAnalyze); same pattern for handleReanalyze at L306-310
- **Label**: code-observed

### Step 2: SSE hook
- **File**: web/hooks/useSSEStream.ts
- **Line#**: 47-54 (guard), 184-199 (streamPayload construction with chunkIndex)
- **Snippet**: `const streamPayload: WorkerStreamRequest = { videoId, analysisId, transcript, metadata, persona, timezone, models, sig, exp, appUrl, dimensions, chunkIndex: i + 1, totalChunks: TOTAL_STREAMS };`
- **Label**: code-observed

### Step 3: Bouncer API
- **File**: web/app/api/analyses/route.ts
- **Line#**: 42-86
- **Snippet**: `const identity = await authAdapter.authenticate(); if (!identity) { return 401; } const useCaseResult = await createAnalysisUseCase.execute({...}); if (useCaseResult.type === 'cache_hit') { return json useCaseResult.data; } return json useCaseResult.data with status 202;`
- **Label**: code-observed

### Step 4: CreateAnalysisUseCase
- **File**: web/lib/usecases/CreateAnalysisUseCase.ts
- **Line#**: 60-194
- **Snippet**: `extractVideoId → findCachedAnalysis → checkGate → metadataIngestion.fetch + Decodo fallback → detectPersona → resolveModels → upsertProcessingStub → signAnalysisToken → return { stream: { url: \`.../analyze-llm-stream\`, sig, exp } }`
- **Label**: code-observed

### Step 5: Worker stream entry
- **File**: worker/src/routes/analysis.ts
- **Line#**: 340-448
- **Snippet**: `HMAC verify → fetchTranscriptIfMissing → transcript gate (400) → new LLMCascade(apiKey, req.models) → new ReasoningEngine → buildStreamResponse(engine, req, signingKey, ...)`
- **Label**: code-observed

### Step 6: Worker persist calls (4 call sites)

#### Call site A — success path (L176-187)
- **File**: worker/src/routes/analysis.ts
- **Line#**: 176-187
- **Snippet**:
```
persistService.persist({
  analysisId: req.analysisId, videoId: req.videoId, finalText, modelUsed, status,
  activeSecret: signingKey, appUrl: url,
  validate12D: (text) => engine.validate12D(text, req.dimensions?.length),
  chunkIndex: req.chunkIndex,          // ✅ present
  totalChunks: req.totalChunks,        // ✅ present
});
```
- **Label**: code-observed

#### Call site B — timeout fallback (L193-204) ⚠️ NOW FIXED
- **File**: worker/src/routes/analysis.ts
- **Line#**: 193-204
- **Before**: chunkIndex and totalChunks were absent; route would select UCISPayloadV2Schema; chunk-shaped payload would fail validation → 400
- **After**: 
```
persistService.persist({
  analysisId: req.analysisId,
  videoId: req.videoId,
  finalText,
  modelUsed,
  status: 'failed',
  activeSecret: signingKey,
  appUrl: url,
  validate12D: (text: string) => engine.validate12D(text, req.dimensions?.length),
  chunkIndex: req.chunkIndex,          // ✅ NOW PRESENT
  totalChunks: req.totalChunks,        // ✅ NOW PRESENT
}).catch(() => {});
```
- **Label**: code-observed + test-proven (persist-schema-selection.test.ts 9/9)

#### Call site C — already-aborted (L417-428)
- **File**: worker/src/routes/analysis.ts
- **Line#**: 417-428
- **Snippet**: `persistService.persist({ analysisId, videoId, finalText: '', modelUsed: '', status: 'interrupted', ... })`
- **No chunkIndex** — safe because `finalText: ''` → extractJsonPayload returns null → no schema check
- **Label**: code-observed

#### Call site D — abort listener (L433-442)
- **File**: worker/src/routes/analysis.ts
- **Line#**: 433-442
- **Snippet**: same as call site C: `finalText: ''`, no chunkIndex
- **Label**: code-observed

### Step 7: PersistService.persist() payload shape
- **File**: worker/src/services/PersistService.ts
- **Line#**: 22-60
- **Snippet**:
```
const extracted = extractJsonPayload(options.finalText);
if (extracted) {
  const isChunk = options.chunkIndex !== undefined;
  const schema = isChunk ? ChunkPayloadSchema : UCISPayloadSchema;
  const result = schema.safeParse(extracted);
  if (result.success) { jsonPayload = result.data; }
}
```
- **Then**: `markdown = reconstructMarkdown(jsonPayload) || options.finalText; valid = options.validate12D(markdown); canonical = JSON.stringify({ markdown, payload: jsonPayload }); contentSig = hmacHex(activeSecret, canonical);`
- **Then**: POST to `/api/analyses/persist` with body `{ analysisId, videoId, markdown, payload, model, valid, contentSig, status, chunkIndex, totalChunks }`
- **Label**: code-observed

---

## Stage 3 — Persist Route Contract

### Schema selection at the route boundary
- **File**: web/app/api/analyses/persist/route.ts
- **Line#**: 116-139
- **Snippet**:
```
if (payload !== undefined && payload !== null) {
  const isChunk = chunkIndex !== undefined;
  const parseResult = isChunk
    ? z.object({ schemaVersion: z.literal('2.0'), dimensions: z.array(z.object({ number, name, content })) }).passthrough().safeParse(payload)
    : UCISPayloadV2Schema.safeParse(payload);
  if (!parseResult.success) {
    console.warn('[analyses/persist] Invalid payload schema', { analysisId, videoId, chunkIndex, errors });
    return NextResponse.json({ error: 'Invalid payload schema' }, { status: 400 });
  }
}
```
- **Label**: code-observed + test-proven (persist-schema-selection.test.ts)

### What the worker sends vs what the route selects (after fix)
| Worker call site | chunkIndex in body | Route schema | Valid? |
|---|---|---|---|
| L176 (success) | `req.chunkIndex` (number) | chunk schema | ✅ |
| L193 (timeout, NOW FIXED) | `req.chunkIndex` (number) | chunk schema | ✅ |
| L417 (aborted) | undefined (field elided) | UCISPayloadV2Schema | ✅ (finalText='' → no payload → L116 skips validation) |
| L433 (abort listener) | undefined (field elided) | UCISPayloadV2Schema | ✅ (same reason as L417) |

### Stitch path (chunked persistence)
- **File**: web/app/api/analyses/persist/route.ts
- **Line#**: 162-330
- **Snippet**: `if (chunkIndex !== undefined && validPayload && 'dimensions' in validPayload) { persistAnalysisChunk → findAnalysisChunks → grace-period stitch → updateAnalysisResult + cache + QStash }`
- **Label**: code-observed

### Baseline path (full/legacy)
- **File**: web/app/api/analyses/persist/route.ts
- **Line#**: 336-386
- **Snippet**: `updateAnalysisResult({ analysisId, markdown, payload: validPayload ?? null, model, validationPassed, validationReport }) → cache → QStash`
- **Label**: code-observed

---

## Stage 4 — Supabase Write Proof

### updateAnalysisResult SQL write
- **File**: web/lib/adapters/SupabasePersistenceAdapter.ts
- **Line#**: 119-130
- **Snippet**:
```
const { error: analysisError } = await service
  .from('analyses')
  .update({
    analysis_markdown: params.markdown,
    analysis_payload: params.payload ?? null,
    model_used: params.model || 'edge-stream',
    validation_passed: params.validationPassed,
    validation_report: params.validationReport,
    billing_status: 'completed',
    updated_at: new Date().toISOString(),
  })
  .eq('id', params.analysisId);

if (analysisError) {
  console.error('[SupabasePersistenceAdapter] updateAnalysisResult failed:', analysisError.message);
  throw analysisError;
}
```
- **Fields written**: `analysis_markdown`, `analysis_payload`, `model_used`, `validation_passed`, `validation_report`, `billing_status` (='completed'), `updated_at`
- **Label**: code-observed

### KG persistence cascade
- **File**: web/lib/adapters/SupabasePersistenceAdapter.ts
- **Line#**: 138-156
- **Snippet**: `if (params.payload?.knowledgeGraph) { await this.persistKnowledgeGraph({...}).catch(err => { console.error(...) }); }`
- **KG failure is silently swallowed** (line 154-156 `.catch()` with no re-throw)
- **Label**: code-observed

### videos table upsert
- **File**: web/lib/adapters/SupabasePersistenceAdapter.ts
- **Line#**: 100-115
- **Snippet**: `await service.from('videos').upsert({ id: analysisMeta.video_id, title, user_id }, { ignoreDuplicates: true });`
- **Failure silently swallowed** at L113-115: `catch (e) { console.warn('[SupabasePersistenceAdapter] video upsert skipped:', e); }`
- **Risk**: no migration creates `videos` table — upsert throws → caught silently → analysis row update at L119-130 still runs (separate query)
- **Label**: code-observed

### Chunk persistence
- **File**: web/lib/adapters/SupabasePersistenceAdapter.ts
- **Line#**: 271-304
- **Snippet**: `service.from('analysis_chunks').upsert({ analysis_id, chunk_index, dimensions_covered, payload, status, updated_at }, { onConflict: 'analysis_id,chunk_index' });`
- **Label**: code-observed

### No runtime DB row verification
- No test asserts a row was actually written to `analyses` or `analysis_chunks` with the expected values
- No Playwright test reads back a persisted analysis row
- No DB query output attached to this trace
- **Label**: unknown (write path is code-proven; actual row existence is not)

---

## Stage 5 — Risks / Blind Spots

### Risk: videos table missing migration
- **Why it matters**: SupabasePersistenceAdapter.ts:104 upserts to `videos` table. No migration creates it. If table doesn't exist, upsert fails silently (caught in .catch L113-115). Analysis row write at L119-130 is a separate query and still succeeds.
- **What is missing**: Migration file for `CREATE TABLE videos`
- **Label**: code-observed (missing migration not proven in this trace; would need `grep -r "CREATE TABLE videos" supabase/migrations/`)

### Risk: KG persistence failure silently swallowed
- **Why it matters**: SupabasePersistenceAdapter.ts:154-156 `.catch(err => { console.error('...'); });` — if kg_entities/relations upsert fails, analysis row is still marked 'completed' but KG data is missing
- **Label**: code-observed

### Risk: no runtime DB row proof
- **Why it matters**: Every step from UI to DB write is code-observed or test-proven at the schema level. But no test or runtime artifact proves a row was actually written to Supabase with the expected values.
- **What is missing**: A test that POSTs to /api/analyses/persist with a valid payload and asserts the row has `billing_status: 'completed'` and `analysis_markdown` matches input

### Risk: L417/L433 interrupted calls have latent bug
- **Why it matters**: Both pass `finalText: ''` so no payload → safe today. If either call site ever starts passing real `finalText` without `chunkIndex`, the same UCISPayloadV2Schema mismatch would trigger.
- **Label**: code-observed (latent, not active)

---

## Stage 6 — Conclusion

### One short verdict
- The analysis persistence chain is **code-proven end-to-end** from UI entry (DashboardContainer.tsx:301-310) through SSE hook, bouncer API, CreateAnalysisUseCase, worker stream, 4 persistService.persist() call sites (including the NOW FIXED timeout fallback at L193-204), PersistService schema selection, `/api/analyses/persist` route handler (schema selection + stitch + baseline), and Supabase write (updateAnalysisResult writing analysis_markdown, analysis_payload, billing_status='completed'). The timeout fallback path is **test-proven fixed** (persist-schema-selection.test.ts 9/9). **No runtime DB row proof exists** — the chain is wired but unverified at the Supabase persistence level.

### What would change my mind is
- A test that POSTs to `/api/analyses/persist` with a valid chunk payload and `chunkIndex`, then reads back the `analysis_chunks` row and confirms `dimensions_covered` and `payload` match
- A test that POSTs to `/api/analyses/persist` with a full stitched payload, then reads back the `analyses` row and confirms `billing_status: 'completed'` and `analysis_markdown` matches
- A DB schema check (`grep migrations for CREATE TABLE videos`) proving the `videos` table exists in production — or confirming it's missing (which would make the silent .catch at L113-115 a real gap)
- A grep or migration check proving `analysis_chunks` table exists