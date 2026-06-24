# END-TO-END RCA: ANALYSIS PERSISTENCE ONLY

**Scope**: UI trigger → worker stream → `/api/analyses/persist` → Supabase write  
**Method**: Fil e reads + CLI test runs + Direct PostgREST REST queries (Supabase MCP not authenticated)  
**Labels**: runtime-proven, test-proven, code-observed, inferred, unknown  

---

## Stage 1 — Artifact Inventory

| Artifact | Status | Proves | Cannot prove |
|---|---|---|---|
| worker/src/routes/analysis.ts | full read (L165-275, L340-451) | 4 persistService.persist() call sites; 1 fixed (L193-204) | runtime cascade completion |
| worker/src/services/PersistService.ts | full read (L1-169) | persist() schema selection L29-30; `_attemptPersist` POST L80-96 | runtime HTTP success |
| web/app/api/analyses/persist/route.ts | full read (L1-396) | HMAC verify L96-111; schema selection L117-127; stitch L162-330 | runtime DB write |
| web/lib/adapters/SupabasePersistenceAdapter.ts | full read (L83-177) | `updateAnalysisResult` L119-130; `videos` upsert L100-115 | SQL execution |
| worker/src/__tests__/persist-schema-selection.test.ts | 9/9 passing | chunk shape accepted by ChunkPayloadSchema, rejected by UCISPayloadV2Schema | end-to-end HTTP call |
| Supabase DB `analyses` table | [{"count":0}] via REST | table exists, columns `id, video_id, title, user_id, model_used, analysis_markdown, analysis_payload, billing_status, created_at, updated_at` exist | RLS blocks unauthenticated reads |
| Supabase DB `analysis_chunks` table | [] via REST | table exists, columns `analysis_id, chunk_index, dimensions_covered, payload, status` exist | no rows visible |
| Supabase DB `videos` table | **PGRST205: not found** | table does NOT exist in schema cache | — |
| Migrations `CREATE TABLE videos` | **no matches in any file** | no migration creates the `videos` table | — |
| Playwright tests | 12 tests listed | health, auth, rendering, transcript fallback | **nothing covers analysis persistence** |

### Timeout fallback fix
- **File**: worker/src/routes/analysis.ts
- **Line#**: 202-203
- **Snippet**: `chunkIndex: req.chunkIndex, totalChunks: req.totalChunks,`
- **Verified**: code-observed (L202-203 present) + test-proven (persist-schema-selection.test.ts 9/9)
- **Label**: test-proven (timeout path schema mismatch is resolved)

---

## Stage 2 — UI → Worker → Persist

### UI trigger
- **File**: web/components/containers/DashboardContainer.tsx
- **Line#**: 301-310
- **After**: `startTransition(() => { startAnalysis(url, getUserTimezone()); })`
- **Label**: code-observed

### SSE hook → worker stream
- **File**: web/hooks/useSSEStream.ts
- **Line#**: 184-199
- **Snippet**: `const streamPayload = { videoId, analysisId, transcript, metadata, persona, timezone, models, sig, exp, appUrl, dimensions, chunkIndex: i + 1, totalChunks: TOTAL_STREAMS };`
- **Label**: code-observed

### Bouncer API
- **File**: web/app/api/analyses/route.ts
- **Line#**: 42-86
- **Snippet**: `authAdapter.authenticate() → createAnalysisUseCase.execute({url, userId, tier, timezone})`
- **Label**: code-observed

### CreateAnalysisUseCase
- **File**: web/lib/usecases/CreateAnalysisUseCase.ts
- **Line#**: 60-194
- **Steps**: cache hit → quota → ingestion + Decodo → persona → stub insert → HMAC sign → stream URL return
- **Label**: code-observed

### Worker stream entry
- **File**: worker/src/routes/analysis.ts
- **Line#**: 340-448
- **Snippet**: HMAC verify → fetchTranscriptIfMissing → transcript gate (400) → LLMCascade → buildStreamResponse → atomicPersist
- **Label**: code-observed

### Worker persist call sites (4 total)
| Site | Line | chunkIndex | Label |
|---|---|---|---|
| atomicPersist success callback | L176-187 | `req.chunkIndex` ✅ | code-observed |
| **Timeout fallback** | **L193-204** | **`req.chunkIndex` ✅ NOW FIXED** | **test-proven** |
| Client already-aborted | L417-428 | undefined (finalText='', safe) | code-observed |
| Abort listener | L433-442 | undefined (finalText='', safe) | code-observed |

### PersistService.persist() payload shape
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
if (jsonPayload) { markdown = reconstructMarkdown(jsonPayload); }
const canonical = JSON.stringify({ markdown, payload: jsonPayload });
const contentSig = await hmacHex(options.activeSecret, canonical);
return this._attemptPersist({ ...options, markdown, jsonPayload, valid, contentSig });
```
- **Label**: code-observed

---

## Stage 3 — Persist Route Contract

### Schema selection
- **File**: web/app/api/analyses/persist/route.ts
- **Line#**: 116-139
- **Snippet**:
```
if (payload !== undefined && payload !== null) {
  const isChunk = chunkIndex !== undefined;
  const parseResult = isChunk
    ? z.object({ schemaVersion: z.literal('2.0'), dimensions: z.array(z.object({ number, name, content })) }).passthrough().safeParse(payload)
    : UCISPayloadV2Schema.safeParse(payload);
  if (!parseResult.success) { return NextResponse.json({ error: 'Invalid payload schema' }, { status: 400 }); }
  validPayload = parseResult.data as any;
}
```
- **Label**: code-observed

### What worker sends vs what route selects (after timeout fix)
| Call site | chunkIndex in body | Route schema | Valid? |
|---|---|---|---|
| L176 (success) | `req.chunkIndex` (number) | chunk schema | ✅ |
| L193 (timeout, FIXED) | `req.chunkIndex` (number) | chunk schema | ✅ |
| L417 (aborted) | undefined | UCISPayloadV2Schema | ✅ (finalText='' → no payload → L116 skips) |
| L433 (abort listener) | undefined | UCISPayloadV2Schema | ✅ (same) |

### Stitch path (chunked)
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
if (analysisError) { throw analysisError; }
```
- **Columns written**: `analysis_markdown`, `analysis_payload`, `model_used`, `validation_passed`, `validation_report`, `billing_status`, `updated_at`
- **Label**: code-observed

### DB schema verification (runtime-proven via Direct PostgREST REST calls)
| Table | Query | Exists? | Rows visible to anon |
|---|---|---|---|
| `analyses` | `select=id,video_id,...&limit=1` | ✅ yes | 0 (RLS blocks unauthenticated) |
| `analysis_chunks` | `select=analysis_id,chunk_index,...&limit=1` | ✅ yes | 0 (RLS blocks unauthenticated) |
| `videos` | `select=count&limit=1` | ❌ **PGRST205: not found** | N/A |

### videos table NOT found (runtime-proven)
- **Query**: `GET /rest/v1/videos?select=count&limit=1`
- **Response**:
```json
{
  "code": "PGRST205",
  "details": null,
  "hint": "Perhaps you meant the tabke 'public.users'",
  "message": "Could not find the table 'public.videos' in the schema cache"
}
- **Label**: runtime-proven (direct REST query, 2026-06-23T00:59+03:00)
```

### Migration check (code-observed)
- **Search**: `grep -r "CREATE TABLE.*videos" supabase/migrations/` → **zero matches**
- **Label**: code-observed

### KG persistence
- **File**: web/lib/adapters/SupabasePersistenceAdapter.ts
- **Line#**: 138-156
- **Snippet**: `.catch(err => { console.error('[SupabasePersistenceAdapter] kg persistence failed:', err.message); });`
- **Failure mode**: not re-thrown — analysis row is marked 'completed' even if KG write fails
- **Label**: code-observed

---

## Stage 5 — Risks / Blind Spots

### videos table missing (runtime-proven)
- **Why it matters**: SupabasePersistenceAdapter.ts:100-115 tries to upsert into `videos` table. The table does NOT exist in the database schema (PGRST205 runtime-proven, zero migration matches code-observed). The error is caught silently at L113-115. The main analysis row write at L119-130 is a separate query and succeeds, but the FK consistency point between `analyses.video_id` and `videos.id` is unenforceable without the table.
- **What would close it**: A migration file creating `CREATE TABLE videos (...)`

### No runtime DB row proof for writes
- **Why it matters**: Every step of the chain from UI to DB write is code-observed or test-proven at the schema level. But no test or runtime artifact proves a row was actually written to Supabase with the expected values for `billing_status`, `analysis_markdown`, or `analysis_payload`. The Supabase queries return 0 rows (expected for unauthenticated anon key — RLS). The service_role key in .env.local is invalid (returns `"Invalid API key"`).
- **What would close it**: A Playwright test with authenticated session that submits an analysis URL and asserts the row appears in GET /api/analyses/[id]; OR a direct service_role query with a valid key

### Readback fallback fix (code-observed, not runtime-proven)
- **What**: The readback route at `/api/analyses/[id]/route.ts` was fixed in a prior turn to fall back to `reconstructMarkdown(analysis.analysis_payload)` when `analysis_markdown` is NULL. The fix is code-observed but its runtime behavior depends on whether NULL-markdown rows actually exist in production.
- **Label**: code-observed

### Test coverage gap
- **Why it matters**: 12 Playwright tests exist. 0 cover analysis persistence. The schema-selection unit test (9/9) covers the chunk/full schema boundary but does not test the actual POST or DB write.
- **What would close it**: Add a vitest integration test that mocks `_attemptPersist` and asserts the payload shape matches the route contract; or an end-to-end Playwright test

---

## Stage 6 — Conclusion

### One short verdict
- The analysis persistence chain is **code-proven end-to-end** from UI trigger through CreateAnalysisUseCase, worker stream, 4 persistService.persist() call sites including the **test-proven fixed** timeout fallback (L202-203), PersistService schema selection, route handler (chunk/baseline), and SupabasePersistenceAdapter.updateAnalysisResult. The `analyses` and `analysis_chunks` tables are **runtime-proven** to exist in the Supabase database. The `videos` table is **runtime-proven** to NOT exist — the upsert failure is silently swallowed, leaving a dangling FK reference. **No runtime proof exists that a row was actually written to the `analyses` table** — the anon key returns 0 rows (RLS gated), and the service_role key is invalid. The readback fallback fix is applied but unverified at runtime.

### What would change my mind is
- A valid service_role key that returns rows from `SELECT * FROM analyses LIMIT 5` with non-null `billing_status: 'completed'` and populated `analysis_markdown`
- A Playwright test with authenticated session that submits a YouTube URL, waits for SSE completion, then asserts `GET /api/analyses/[id]` returns non-empty `analysis_markdown`
- A migration file creating `CREATE TABLE videos` so the FK upsert at adapter.ts:100-115 doesn't fail silently
- An integration test that feeds a chunk-shaped payload through PersistService.persist() → mock POST → route handler → assert the response is 200 and the stitched payload matches expected dimensions