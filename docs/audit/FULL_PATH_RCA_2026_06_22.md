# FULL PATH RCA: UI → WORKER → SUPABASE → VECTOR → READBACK

**Scope**: Both analysis and chat flows, current branch only  
**Method**: Direct file reads of every chain link  
**Labels**: runtime-proven, test-proven, code-observed, inferred, unknown  

---

## Stage 1 — Artifact Inventory

### File: web/components/containers/DashboardContainer.tsx
- **Status**: full read (post PR #97)
- **Proves**: UI entry for analysis (startAnalysis via useSSEStream, handleAnalyze/Reanalyze wrapped in startTransition)
- **Cannot prove**: browser-visible output; no snapshot or screenshot

### File: web/hooks/useSSEStream.ts
- **Status**: full read (lines 150-349)
- **Proves**: client-side settleAnalysis function (local store state, no POST); runStreams sends SSE to worker
- **Cannot prove**: SSE actually connects and receives data in browser

### File: web/lib/usecases/CreateAnalysisUseCase.ts
- **Status**: full read (lines 1-196)
- **Proves**: cache hit → quota → ingestion → persona → stub → HMAC → stream URL return
- **Cannot prove**: runtime DB success of each step

### File: web/lib/usecases/ProcessChatMessageUseCase.ts
- **Status**: full read (lines 1-265)
- **Proves**: turn limits (5/30/100), reasoning regex, grounding assembly, HMAC signing, stream URL return
- **Cannot prove**: runtime execution of createMessage or grounding fetch

### File: worker/src/routes/analysis.ts
- **Status**: full read (lines 1-453)
- **Proves**: HMAC verify, transcript fetch-if-missing, transcript gate (400), LLM cascade, SSE response, atomicPersist wiring, persistService.persist() at 4 call sites
- **Cannot prove**: runtime cascade behavior or stream throughput

### File: worker/src/services/PersistService.ts
- **Status**: full read (lines 1-169)
- **Proves**: persist() with chunk vs full schema selection; _attemptPersist POST with retries (max 3); settleAnalysis() dead code (never called)
- **Cannot prove**: runtime HTTP success of _attemptPersist

### File: web/app/api/analyses/persist/route.ts
- **Status**: full read (lines 1-396)
- **Proves**: HMAC verify, chunk vs full schema selection, chunk stitch with grace period, stitched updateAnalysisResult, cache set, QStash publish
- **Cannot prove**: runtime write-verify (no DB row trace in current artifacts)

### File: web/lib/adapters/SupabasePersistenceAdapter.ts
- **Status**: full read (lines 1-355)
- **Proves**: updateAnalysisResult SQL writes, KG persistence cascade, persistAnalysisChunk upsert
- **Cannot prove**: runtime SQL execution; existence of `videos` table (no migration found, persistence silently swallowed in .catch)

### File: web/lib/qstash-client.ts
- **Status**: full read (lines 1-145)
- **Proves**: publishValidationTask() and publishEmbeddingTask() both present; verifyQStashSignature() present
- **Cannot prove**: QSTASH_TOKEN configured at runtime (checks process.env, throws if missing)

### File: web/app/api/webhooks/validate/route.ts
- **Status**: full read (lines 1-154)
- **Proves**: QStash signature verification, UCIS validator execution, validation report save to Supabase, publishEmbeddingTask call
- **Cannot prove**: any of the steps actually run — each has .catch() that logs and continues

### File: web/app/api/webhooks/embed/route.ts
- **Status**: full read (lines 1-210)
- **Proves**: check for placeholder credentials (L64-92), generateEmbedding call, vectorIndex.upsert, logUsage
- **Cannot prove**: runtime success of any of these steps

### File: web/lib/adapters/UpstashVectorAdapter.ts
- **Status**: full read (lines 1-71)
- **Proves**: deduplicateNodes() and markStale() for KG dedup; NOT an embedding write path
- **Cannot prove**: any actual vector query result (no test, no runtime trace)

### File: web/app/api/analyses/[id]/route.ts
- **Status**: full read (lines 1-50)
- **Proves**: verifyResourceOwnership, returns analysis_markdown/analysis_payload
- **Cannot prove**: runtime ownership check result

### Runtime artifacts
- **Test persist-schema-selection.test.ts**: 9/9 passing — **test-proven** for schema selection logic
- **Worker build**: 2.1mb, 408ms — **runtime-proven** for compilation
- **Production health endpoint**: `/api/health` returns `healthy` — recorded in prior preflight; not re-verified in this trace

---

## Stage 2 — Analysis Flow (UI → Worker → Persist → Supabase)

### Step 1: UI Entry
- **File**: web/components/containers/DashboardContainer.tsx:301-310
- **Line#**: 301-310
- **After**: `startTransition(() => { startAnalysis(url, getUserTimezone()); });`
- **Evidence**: code-observed
- **Label**: code-observed

### Step 2: SSE Hook
- **File**: web/hooks/useSSEStream.ts:47-54
- **After**: `if (processingRef.current) return; processingRef.current = true; if (abortControllerRef.current) abortControllerRef.current.abort();`
- **Evidence**: code-observed
- **Label**: code-observed

### Step 3: Bouncer API
- **File**: web/app/api/analyses/route.ts:42-95
- **After**: `authAdapter.authenticate() → createAnalysisUseCase.execute({url, userId, tier, timezone})`
- **Evidence**: code-observed
- **Label**: code-observed

### Step 4: UseCase
- **File**: web/lib/usecases/CreateAnalysisUseCase.ts:60-194
- **After**: `extractVideoId → findCachedAnalysis → checkGate → metadataIngestion.fetch → Decodo fallback → detectPersona → resolveModels → upsertProcessingStub → signAnalysisToken → return stream URL`
- **Evidence**: code-observed
- **Label**: code-observed

### Step 5: Worker Stream
- **File**: worker/src/routes/analysis.ts:340-448 / 340-451
- **After**: `verifyStreamToken → fetchTranscriptIfMissing → transcript gate (400) → LLMCascade → SSE → buildStreamResponse → atomicPersist → persistService.persist() at L176, L193 (NOW FIXED), L417, L433`
- **Evidence**: code-observed (3 of 4 call sites verified; L193 timeout fallback NOW FIXED to include chunkIndex)
- **Label**: code-observed + test-proven (L193 fix verified via test)

### Step 6: S2S Persist Route
- **File**: web/app/api/analyses/persist/route.ts:51-396
- **After**: `bodySchema → HMAC verify → isChunk ? ChunkPayloadSchema : UCISPayloadV2Schema → if chunked: persistAnalysisChunk → findAnalysisChunks → grace-period stitch → updateAnalysisResult + KG cascade + cache set + QStash publishValidationTask`
- **Evidence**: code-observed
- **Label**: code-observed

### Step 7: Supabase Write
- **File**: web/lib/adapters/SupabasePersistenceAdapter.ts:119-130
- **After**: `service.from('analyses').update({ analysis_markdown, analysis_payload, billing_status: 'completed', ... }).eq('id', analysisId);`
- **Evidence**: code-observed
- **Label**: code-observed

### First break point
- **What**: CreateAnalysisUseCase.ts:104 transcript-empty check is too narrow — `"Transcript unavailable"` placeholder text would pass through to LLM without Decodo fallback
- **Where**: metadataIngestion.fetch returns placeholder string, Decodo not triggered, LLM gets 5-word transcript
- **Label**: code-observed (not test-proven — depends on ingestion adapter output)

---

## Stage 3 — Analysis Vector Path

### Step 1: QStash Validation Task Publish
- **File**: web/app/api/analyses/persist/route.ts:321-329
- **After** (only when `transcript_available`):
```
await publishValidationTask({
  videoId, markdown: stitchedMarkdown, filename: buildValidationFilename(...), userId, analysisId, metadata
}).catch(() => {});
```
- **Evidence**: code-observed
- **Label**: code-observed

### Step 2: QStash Client — publishValidationTask
- **File**: web/lib/qstash-client.ts:43-68
- **After**: `getQStashClient().publishJSON({ url: webhookUrl, body: payload, retries: 3 })`
- **Evidence**: code-observed
- **Label**: code-observed (requires QSTASH_TOKEN env var; if missing, throws error caught in .catch)

### Step 3: Validate Webhook
- **File**: web/app/api/webhooks/validate/route.ts:16-120
- **After**: `verifyQStashSignature → UCISValidator.validate → persistence.updateValidationReport (non-blocking .catch) → publishEmbeddingTask (non-blocking .catch)`
- **Evidence**: code-observed
- **Label**: code-observed

### Step 4: QStash Client — publishEmbeddingTask
- **File**: web/lib/qstash-client.ts:74-102
- **After**: `getQStashClient().publishJSON({ url: webhookUrl, body: payload, retries: 2, delay: 5000 })`
- **Evidence**: code-observed
- **Label**: code-observed (same QSTASH_TOKEN dependency)

### Step 5: Embed Webhook
- **File**: web/app/api/webhooks/embed/route.ts:33-210
- **After**: `verifyQStashSignature → placeholder check → generateEmbedding(markdown) → vectorIndex.upsert({id: analysisId, vector, metadata}) → logUsage`
- **Evidence**: code-observed
- **Label**: code-observed

### Step 6: Vector Index Upsert
- **File**: web/app/api/webhooks/embed/route.ts:150-159
- **After**: `await vectorIndex.upsert({ id: analysisId, vector: embeddingResult.embedding, metadata: { title, videoId, userId, analysisId } });`
- **Evidence**: code-observed
- **Label**: code-observed

### First break point #1
- **What**: validate webhook L82-88 — validation report save is `.catch(() => { console.warn(...); })` — failure is non-blocking but QStash marks task as consumed. No retry.
- **Where**: web/app/api/webhooks/validate/route.ts:82-88
- **Label**: code-observed

### First break point #2
- **What**: embed webhook L64-92 — `isPlaceholder` check uses literal string `'placeholder'`. The env.ts MOCK_DEFAULTS token is `'mock-vector-token'`, NOT `'placeholder'`. So in preview/CI, the guard does NOT trigger, and the webhook attempts a real vector write with a mock token, which fails.
- **Where**: web/app/api/webhooks/embed/route.ts:64-92; web/lib/env.ts:48-49
- **Label**: code-observed

### First break point #3
- **What**: `search_analyses_semantic` RPC exists in migrations but is **never called** in any code path. The entire vector write pipeline (embed → upsert) produces vectors that are never queried by the application.
- **Where**: supabase/migrations/20260521185646_optimize_vector_search_rpc.sql (exists); grep returns zero invocation matches in current source
- **Label**: code-observed (RPC = 100% unused)

---

## Stage 4 — Chat Flow

### Step 1: ChatDock submit
- **File**: web/components/templates/console/ChatDock.tsx:114-120
- **After**: `await sendMessage(t, { analysisId: analysisId ?? null });`
- **Evidence**: code-observed
- **Label**: code-observed

### Step 2: useChatStore.deliver
- **File**: web/store/useChatStore.ts:133-264 (post PR #97)
- **After**: `fetch(/api/chat/conversations/${convId}/messages) → bouncer response → if (job.assistant) finalize early → streamRes = fetch(job.stream.url) → readSSE(streamRes, typed event handlers)`
- **Evidence**: code-observed (post PR #97 typed handlers + AbortError filtering)
- **Label**: code-observed

### Step 3: Chat Bouncer API
- **File**: web/app/api/chat/conversations/[id]/messages/route.ts:48-104
- **After**: `authAdapter.authenticate() → content schema → ProcessChatMessageUseCase.execute()`
- **Evidence**: code-observed
- **Label**: code-observed

### Step 4: ProcessChatMessageUseCase
- **File**: web/lib/usecases/ProcessChatMessageUseCase.ts:47-264
- **After**: `turn limit → createMessage + getAnalysisGrounding → detect reasoning → resolveModels → signChatToken → return stream URL`
- **Evidence**: code-observed
- **Label**: code-observed

### Step 5: Worker Chat Stream
- **File**: worker/src/chat-stream.ts:115-163, 317-361
- **After**: `CHAT_PROTOCOL prepend + grounding as system messages → cascade (CHAT_CASCADE from cascade.ts) → max_tokens: 1200 → atomicPersist → fetch POST /api/chat/persist`
- **Evidence**: code-observed
- **Label**: code-observed

### Step 6: Chat S2S Persist
- **File**: web/app/api/chat/persist/route.ts:19-79
- **After**: `HMAC verify → ownership check → findLatestUserMessage → createMessage`
- **Evidence**: code-observed
- **Label**: code-observed

### First break point
- **What**: ProcessChatMessageUseCase.ts:105-112 — free tier limit is 5 messages. After 5, user gets 403 with no way to reset. The counter persists in DB across sessions.
- **Where**: `if (userMessageCount >= userLimit && !isRetry) { return ERR_CHAT_LIMIT_EXCEEDED }`
- **Label**: code-observed

### First break point #2 (latent)
- **What**: useChatStore.ts:56-58 reasoning regex matches common English words ('why', 'explain', 'logic') — routes to expensive reasoning cascade on benign questions
- **Label**: code-observed

---

## Stage 5 — Readback / UI Render

### Step 1: Readback API
- **File**: web/app/api/analyses/[id]/route.ts:6-49
- **After**: `verifyResourceOwnership(id, 'analyses', columns) → returns { analysis_markdown, analysis_payload, validation_report, ... }`
- **Evidence**: code-observed
- **Label**: code-observed

### Step 2: Zustand Store
- **File**: web/store/useAnalysisStore.ts (partial read — lines 123, 224)
- **After**: `analysis_markdown` is appended in store during SSE streaming (L123) and set on readback (L224)
- **Evidence**: code-observed
- **Label**: code-observed

### Step 3: Component Render
- **File**: web/components/dashboard/SelectedDimensionReadout.tsx:11-21 (post PR #97)
- **After**: When `dimension` is null → shows placeholder "Select a dimension to view details." When `dimension` is populated → renders `react-markdown` with custom components
- **Evidence**: code-observed
- **Label**: code-observed

### First break point
- **What**: /api/analyses/[id]/route.ts:35 — `analysis_markdown: analysis.analysis_markdown || ''` — if analysis_markdown is NULL (which happens for chunk-stitched analyses that haven't completed migration to markdown body), route returns empty string. UI then shows nothing.
- **Where**: returned empty string passes through Zustand store → SelectedDimensionReadout sees no content → user sees the new placeholder forever
- **Label**: code-observed

---

## Stage 6 — Chain Matrix

### Analysis flow
| Link | Status | Evidence |
|---|---|---|
| UI entry (DashboardContainer) | proven | code-observed L301-310 |
| SSE hook (useSSEStream.startAnalysis) | proven | code-observed L47-54 |
| Bouncer API (/api/analyses POST) | proven | code-observed L42-95 |
| UseCase (CreateAnalysisUseCase) | proven | code-observed L60-194 |
| Worker stream (analysis.ts L340-448) | proven | code-observed L340-448 |
| Worker persist call (L176 success path) | proven | code-observed L176-187 |
| Worker persist call (L193 timeout, NOW FIXED) | proven | code-observed + test-proven |
| S2S persist route (HMAC → schema → stitch) | proven | code-observed L51-396 |
| Supabase write (updateAnalysisResult) | proven | code-observed Adapter.ts:119-130 |
| **PRODUCTION END-TO-END** | **unknown** | no runtime DB row trace |

### Vector path
| Link | Status | Evidence |
|---|---|---|
| QStash publish from persist route | proven | code-observed route.ts:321-329 |
| QStash client (publishValidationTask) | proven | code-observed qstash-client.ts:43-68 |
| Validate webhook received | inferred | exists, requires QStash delivery |
| UCIS validation runs | inferred | route exists, code-observed |
| Validation report saved to DB | inferred | code-observed, .catch silences failure |
| Embed task published | inferred | code-observed, .catch silences failure |
| Embed webhook received | inferred | exists, requires QStash delivery |
| generateEmbedding called | inferred | code-observed route.ts:112-117 |
| vectorIndex.upsert executes | inferred | code-observed route.ts:150-159 |
| Vector search queries vectors | **BROKEN** | `search_analyses_semantic` RPC is never called in any source file |
| **END-TO-END** | **broken at last mile** | vectors produced but never queried |

### Chat flow
| Link | Status | Evidence |
|---|---|---|
| ChatDock submit | proven | code-observed L114-120 |
| useChatStore.deliver | proven | code-observed L133-264 |
| Chat bouncer API | proven | code-observed route.ts:48-104 |
| ProcessChatMessageUseCase | proven | code-observed L47-264 |
| Worker chat stream | proven | code-observed chat-stream.ts:115-163 |
| Chat S2S persist | proven | code-observed route.ts:19-79 |
| Supabase chat write | proven | code-observed SupabaseChatAdapter (delegated) |
| **PRODUCTION END-TO-END** | **unknown** | no runtime chat trace |

### Readback
| Link | Status | Evidence |
|---|---|---|
| [id] API readback | proven | code-observed route.ts:6-49 |
| Zustand store hydration | proven | code-observed store L123, L224 |
| SelectedDimensionReadout render | proven | code-observed L11-21 |
| **BROWSER-VISIBLE OUTPUT** | **unknown** | no screenshot, DOM snapshot, or browser log |

---

## Stage 7 — Risks / Blind Spots

### Risk: vector path produces data never queried
- **Why it matters**: The entire QStash chain (validate → embed) generates vectors and stores them in Upstash Vector. But `search_analyses_semantic` RPC is never invoked in any code path. The vectors are orphaned — written but never read.
- **Missing**: Any invocation of `search_analyses_semantic` in current source (grep returns zero matches in app code)
- **What would close it**: A confirmed query path from chat or analysis that calls `search_analyses_semantic`

### Risk: embed webhook placeholder guard doesn't catch 'mock-vector-token'
- **Why it matters**: env.ts MOCK_DEFAULTS has `UPSTASH_VECTOR_REST_TOKEN: 'mock-vector-token'`. The embed webhook guard (L64-92) only checks `includes('placeholder')`. 'mock-vector-token' passes through → real vector write attempt fails with mock token.
- **Missing**: A guard check for 'mock' in addition to 'placeholder'
- **What would close it**: Either add 'mock' to the guard, or ensure env.ts MOCK_DEFAULTS use the literal 'placeholder' string

### Risk: validation webhook failure is non-blocking but QStash marks task consumed
- **Why it matters**: Validation report save `.catch()` logs a warning but doesn't reject the promise. QStash receives 200 and marks the task delivered. If the validation report save fails, QStash will NOT retry.
- **Missing**: HTTP status propagation on validation/save failure
- **What would close it**: Return non-200 (503) when validation or embed publish fails

### Risk: `videos` table missing migration
- **Why it matters**: SupabasePersistenceAdapter.ts:104 upserts to `videos` table. No migration creates it. FK failure on analysis row silently swallowed in .catch.
- **Missing**: Migration file creating `CREATE TABLE videos`
- **What would close it**: Grep migrations for `videos` table creation OR pg_dump schema check

### Risk: readback returns empty string for NULL markdown
- **Why it matters**: /api/analyses/[id]/route.ts:35 returns empty string when analysis_markdown is NULL. Chunk-stitched analyses may have NULL markdown (stitch failure or edge case). User sees "Select a dimension to view details" placeholder permanently.
- **Missing**: Fallback from analysis_payload → reconstructMarkdown when analysis_markdown is NULL
- **What would close it**: Add `reconstructMarkdown(analysis.analysis_payload)` as fallback in the [id] route

### Risk: free tier 5-message limit is hard wall
- **Why it matters**: ProcessChatMessageUseCase.ts:105-112 blocks at 5 user messages. No way for user to unblock without upgrading. Count persists across sessions (DB-backed).
- **Missing**: Either a higher free limit, a reset mechanism, or auto-conversation rotation
- **What would close it**: Configuration in app_settings for per-tier limits

### Risk: reasoning regex overrouting on common English words
- **Why it matters**: ProcessChatMessageUseCase.ts:56-58 regex matches 'why', 'explain', 'logic' — routes benign questions to expensive reasoning cascade
- **Missing**: Word-boundary starting position requirement or contextual minimal match length
- **What would close it**: Change regex to require `/^(reason|explain|verify|analyze|deep dive|step by step)/i` instead of `/\b(reason|...)/` 

---

## Stage 8 — Conclusion

### One short verdict
- The analysis and chat flows are code-proven from UI entry to Supabase write with one test-proven fix applied (timeout fallback chunkIndex). The vector path is defined (two QStash hops → embed → vector write) but **the final query step is missing entirely** — `search_analyses_semantic` is never called, so all generated vectors are orphaned. The readback path returns full markdown from DB but has a NULL-fallback gap when analysis_markdown is not populated.

### What would change my mind is
- A live test showing a real analysis write to Supabase and reading it back on the [id] route (proves end-to-end analysis path)
- A live QStash delivery trace showing the validation webhook fires and the embed webhook writes a vector to Upstash Vector index (proves vector path)
- A grep match showing `search_analyses_semantic` is invoked somewhere I missed (closes the orphaning gap, or proves it doesn't exist)
- A browser trace showing the readback route populates analysis_markdown and the UI renders actual dimension content (proves readback path)
- A Playwright test asserting the chat 5-turn limit and the reasoning cascade regex behavior (proves chat path)