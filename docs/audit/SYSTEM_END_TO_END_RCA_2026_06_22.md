# SYSTEM END-TO-END RCA — STRICT EVIDENCE ONLY

**Branch**: `fix/system-corrections-main-app` (PR #97)  
**Scope**: 5 chains traced through adapter → use case → port → DB  
**Method**: Direct file reads; first-break-point per chain  
**Labels**: runtime-proven, test-proven, code-observed, inferred, unknown  

---

## TRUST / IGNORE TRIAGE OF PRIOR REPORTS

### TRUST
- `web/lib/usecases/CreateAnalysisUseCase.ts` (line-anchored chain wiring) — direct file read
- `web/app/api/analyses/persist/route.ts` (line-anchored chunk stitch) — direct file read
- `web/lib/usecases/ProcessChatMessageUseCase.ts` (line-anchored grounding + turn limit) — direct file read
- `web/lib/adapters/SupabasePersistenceAdapter.ts` (line-anchored updateAnalysisResult + KG persistence) — direct file read
- `worker/src/routes/analysis.ts` (line-anchored HMAC + transcript gate) — direct file read
- `worker/src/chat-stream.ts` (line-anchored CHAT_PROTOCOL + max_tokens + cascade) — direct file read

### USEFUL LEADS
- `worker/src/services/atomic-persist.ts` — imported but not opened; needed for streaming-persist proof
- `worker/src/services/ReasoningEngine.ts` — imported but not opened; needed for streaming prompt assembly proof
- `worker/src/services/PromptBuilder.ts` — imported but not opened; needed for chunk-stitch prompt proof
- `web/app/auth/callback/*` — directory exists, body not opened; needed for PKCE proof
- `web/lib/adapters/PostgresBillingAdapter.ts` — instantiated; body not opened; needed for quota proof
- `web/lib/adapters/SupabaseGraphAdapter.ts` (full body) — partially read; needed for KG persist proof

### IGNORE
- Any "verified", "healthy", "all good", "coverage guarantee", "100% verified" claim from prior reports — unsupported by direct runtime evidence
- Statements about prompt-level policy being "enforced at runtime" — only prompt text is visible; runtime obedience is unknown
- "Atlas cross-video insight via semantic search" — `search_analyses_semantic` RPC exists but not in any traced path; not proven invoked
- "Outside augmentation forbidden end-to-end" — prompt forbids; code paths in traced flows confirm no invocation; not proven for paths not traced

### FOLLOW-UP
- File: `worker/src/services/atomic-persist.ts` — Question: does it actually fire `persist` and `settleAnalysis` correctly when stream completes/aborts?
- File: `worker/src/services/ReasoningEngine.ts` — Question: does prompt assembly use ChunkPayloadSchema shape when `chunkIndex !== undefined`?
- File: `web/app/auth/callback/route.ts` (or page.tsx) — Question: does PKCE code-for-token exchange actually complete?

---

## Stage 1 — Artifact Inventory

### File: web/lib/usecases/CreateAnalysisUseCase.ts
- **Status**: full read
- **What it can prove**: exact line-anchored chain for cache hit, quota gate, ingestion, persona detection, stub insert, HMAC token mint, stream URL return
- **What it cannot prove**: runtime behavior of `metadataIngestion.fetch(videoId)`; runtime DB write success of `upsertProcessingStub`; whether quota gate rejects valid users

### File: web/lib/adapters/SupabaseAnalysisAdapter.ts
- **Status**: partial read (lines 1-100 of 468)
- **What it can prove**: `findCachedAnalysis` SQL filter, `.neq('billing_status', 'processing')` filter logic
- **What it cannot prove**: runtime DB query results; whether RLS allows the service-role query

### File: web/lib/adapters/SupabasePersistenceAdapter.ts
- **Status**: full read
- **What it can prove**: `updateAnalysisResult` exact SQL update + KG cascade + chunk upsert; `persistAnalysisChunk` upsert with onConflict
- **What it cannot prove**: runtime DB write success; whether `videos` table exists at runtime (no migration for it found)

### File: web/lib/usecases/ProcessChatMessageUseCase.ts
- **Status**: full read
- **What it can prove**: turn limit (5/30/100), reasoning-detection regex, grounding assembly, history slicing, HMAC token mint
- **What it cannot prove**: runtime chat persistence; whether `findMessageByClientMsgId` race-handler actually recovers

### File: web/app/api/analyses/persist/route.ts
- **Status**: full read
- **What it can prove**: HMAC verify, chunk vs full payload schema selection, grace-period stitch logic, cache + QStash side effects
- **What it cannot prove**: whether chunks arrive in order; whether `findAnalysisChunks` returns rows sorted; whether `setAnalysisCache` / `publishValidationTask` actually succeed

### File: web/app/api/chat/persist/route.ts
- **Status**: partial read (lines 1-80 of 85)
- **What it can prove**: HMAC verify, ownership check, parent-message lookup, createMessage call
- **What it cannot prove**: runtime DB write success; whether `getMessages` filter on `role === 'user'` returns the latest one (depends on order)

### File: worker/src/routes/analysis.ts
- **Status**: partial read (lines 1-200 of 451)
- **What it can prove**: HMAC verify, transcript fetch-if-missing, transcript-unavailable 400 gate, buildStreamResponse wrapper, atomic-persist call
- **What it cannot prove**: stream end-to-end behavior; whether `createAtomicPersist` aborts on disconnect

### File: worker/src/chat-stream.ts
- **Status**: partial read (lines 1-120 of 379)
- **What it can prove**: CHAT_PROTOCOL prepend, max_tokens 1200, per-attempt 50s AbortController, `translateModelId` invocation
- **What it cannot prove**: chat cascade commit behavior; whether atomic-persist fires

### File: web/app/api/analyses/[id]/route.ts
- **Status**: full read
- **What it can prove**: verifyResourceOwnership check, column selection, response shape
- **What it cannot prove**: runtime ownership verification result

### Runtime artifact: /api/health response
- **Status**: not captured in current trace
- **What it can prove**: nothing for this RCA
- **What it cannot prove**: anything

### Test artifact: web/tests/*.spec.ts
- **Status**: not opened in this trace
- **What it can prove**: nothing for this RCA
- **What it cannot prove**: anything

---

## Stage 2 — Chain 1: Analysis Creation

### Entry
- **File**: web/components/containers/DashboardContainer.tsx:301-310
- **Snippet**: `startTransition(() => { startAnalysis(url, getUserTimezone()); });`

### Use case
- **File**: web/lib/usecases/CreateAnalysisUseCase.ts:60-194
- **Steps**:
  1. L60-63: `extractVideoId(params.url)` — invalid → 400
  2. L66-80: `persistence.findCachedAnalysis({ userId, videoId })` — cache hit → return `cache_hit` early
  3. L83-97: `billingQuota.checkGate(...)` — blocked → 402
  4. L102-120: `metadataIngestion.fetch(videoId)` + Decodo fallback if native empty
  5. L127-133: persona detect + job metadata build
  6. L136: `modelResolution.resolveModels(tier, 'analysis')`
  7. L139-152: `persistence.upsertProcessingStub(...)` — DB insert processing row
  8. L157-171: `tokenCrypto.signAnalysisToken(...)` — HMAC sign
  9. L173-194: return `{ type: 'processing', stream: { url, sig, exp } }`

### Port
- **File**: web/lib/ports/AnalysisPersistencePort.ts (not opened in this trace)
- **Snippet**: unknown

### Sink
- **File**: web/app/api/analyses/route.ts:86
- **Snippet**: `return NextResponse.json(useCaseResult.data, { status: 202, headers: responseHeaders });`

### Evidence (code-observed)
- Chain wiring exists end-to-end at code level
- Each step has file:line anchor

### Label
- code-observed

### First break point
- **Where**: web/lib/adapters/SupabaseAnalysisAdapter.ts:24 — `.neq('billing_status', 'processing')`
- **What fails**: In PostgreSQL, `NULL != 'processing'` evaluates to NULL (not TRUE), so rows where `billing_status IS NULL` bypass the filter
- **Where it fails**: CreateAnalysisUseCase.ts:67 calls `findCachedAnalysis(...)`; if the row has `billing_status = NULL`, the `.neq()` filter does NOT exclude it, and the cache hit returns it
- **Why it fails**: SQL three-valued logic: `column != value` returns NULL when column IS NULL, and `WHERE NULL` excludes the row. But Supabase client `.neq('col', val)` translates to `WHERE col != val` which in PostgreSQL semantics excludes NULL rows. Wait — this means NULL rows ARE excluded (correct). So this may not be the break.
- **Alternative break**: web/lib/adapters/SupabaseAnalysisAdapter.ts:31-60 — when `analysis_payload` exists but `dimensions` is empty/missing, the cached report is still returned. The `dimensionCount < 8` check only runs when there's NO `analysis_payload` but HAS `analysis_markdown`. So a row with empty `analysis_payload` but no `analysis_markdown` is silently treated as cache miss, but a row with partial `analysis_payload` (e.g., only `{ schemaVersion: '2.0', dimensions: [] }`) returns success.
- **Actual first break point**: web/lib/usecases/CreateAnalysisUseCase.ts:104 — `const isTranscriptEmpty = !ingestionResult.transcript || ingestionResult.transcript.trim().length === 0;` only checks empty/trim-empty. If `metadataIngestion.fetch(videoId)` returns a transcript containing the placeholder string `"Transcript unavailable for this video"` (e.g., YouTube API returns this when no captions exist), the code treats it as a valid transcript. Decodo fallback is NEVER triggered. The LLM then receives a 5-word placeholder and produces empty dimensions.

### Downstream impact
- LLM is invoked on placeholder transcript → analysis_markdown contains only circuit-breaker strings (`"[Insufficient data...]"`) from UCIS prompt
- Cache hit on subsequent runs: if the first run writes `billing_status: 'completed'` (line 127 in persist path), the second run returns cache_hit with low-quality content
- User sees a "completed" analysis that says only "insufficient data"

---

## Stage 3 — Chain 2: Analysis Streaming

### Entry
- **File**: worker/src/routes/analysis.ts (route registration in worker.ts not opened)
- **Snippet**: not fully traced

### Use case
- **File**: worker/src/services/ReasoningEngine.ts (not opened)
- **Snippet**: inferred — imports show it's the prompt assembly layer

### Port
- **File**: worker/src/ports/LLMCascadePort.ts (not opened)
- **Snippet**: inferred — interface for LLMCascade

### Sink
- **File**: worker/src/routes/analysis.ts:172-187 — atomic-persist call

### Evidence (code-observed)
- HMAC verify: worker/src/routes/analysis.ts:83-118
- Transcript gate: worker/src/routes/analysis.ts:359-374
- Cascade structure: worker/src/services/LLMCascade.ts:26-100
- Stream wrapper: worker/src/routes/analysis.ts:156-200

### Label
- code-observed

### First break point
- **Where**: worker/src/services/LLMCascade.ts:19 — `import { ANALYSIS_CASCADE } from '../../../web/lib/config/cascade';`
- **What fails**: Worker bundles web/lib at build time via esbuild. If `web/lib/config/cascade.ts` uses browser-only APIs (e.g., `window`, `localStorage`) or imports React, the worker build will succeed but the runtime will throw when the cascade is loaded.
- **Where it fails**: cascade.ts is loaded by esbuild at worker build time, not runtime. If cascade.ts exports a constant, it's static — no runtime fail. But if it lazily resolves models from `app_settings`, the worker needs an env binding.
- **Alternative break**: worker/src/services/LLMCascade.ts:84 — `120000` ms timeout per model. If multiple models in cascade fail to start (each consuming 120s), total time = N × 120s = unbounded. Browser tab close before completion = abort signal fires, but `waitUntil` persist may or may not complete.
- **Actual first break point**: worker/src/services/LLMCascade.ts:89-93 — `if (result.started && finalText && !result.error) { produced = true; break; }`. The condition requires `finalText` to be truthy. If the cascade model produced only whitespace or empty tokens (e.g., model emits only `"\n"`), `finalText` is empty, and the cascade falls through to next model. No telemetry to know how often this happens.

### Downstream impact
- Cascade iterates through models consuming time per attempt; if all models emit empty first token, the stream never completes
- User sees indefinite loading; `waitUntil` persist may never fire
- Quota was charged at stub creation (CreateAnalysisUseCase.ts:139-152) but analysis never produces useful output

---

## Stage 4 — Chain 3: Analysis Persistence

### Entry
- **File**: web/app/api/analyses/persist/route.ts:51
- **Snippet**: `export async function POST(request: NextRequest) {`

### Validation / repair
- **File**: web/app/api/analyses/persist/route.ts:57-139
- **Steps**:
  1. L57-78: zod schema validation
  2. L96-111: HMAC verify via `verifyContentSig(canonical, contentSig)`
  3. L113-139: chunk vs full payload schema selection

### Port
- **File**: web/lib/ports/AnalysisPersistencePort.ts (not opened)

### DB write
- **File**: web/lib/adapters/SupabasePersistenceAdapter.ts:83-177 (`updateAnalysisResult`)
- **File**: web/lib/adapters/SupabasePersistenceAdapter.ts:271-304 (`persistAnalysisChunk`)

### Readback
- **File**: web/app/api/analyses/[id]/route.ts:13 (GET /api/analyses/[id])

### Evidence (code-observed)
- HMAC verify: /api/analyses/persist/route.ts:96-111
- Chunk vs full schema: /api/analyses/persist/route.ts:117-127
- Grace period: /api/analyses/persist/route.ts:193-205
- Stitch: /api/analyses/persist/route.ts:207-330
- DB update: SupabasePersistenceAdapter.ts:119-130

### Label
- code-observed

### First break point
- **Where**: web/app/api/analyses/persist/route.ts:177 — `const chunks = await persistenceAdapter.findAnalysisChunks({ analysisId });`
- **What fails**: `findAnalysisChunks` returns rows in `analysis_chunks` table. If chunks arrive out-of-order (e.g., chunk 5 arrives before chunk 1), the function returns them in DB insertion order, which is NOT guaranteed to be sorted by `chunk_index`.
- **Where it fails**: L182-187 checks `for (let i = 1; i <= resolvedTotal; i++) { if (!completedIndexes.has(i)) { allChunksCompleted = false; break; } }`. This logic is correct REGARDLESS of order, because it iterates expected indices and checks the Set.
- **Actual break**: L193-205 grace period check. `const timestamps = completedChunks.map((c: any) => new Date(c.updated_at).getTime()); const newestTime = Math.max(...timestamps); if (now - newestTime >= 30000) { allChunksCompleted = true; }`. If out-of-order arrival: chunk 1 arrives at T=0, chunk 5 arrives at T=10s, no more chunks arrive. At T=40s, `newestTime = 10s`, `now - newestTime = 30s` → triggers stitch. But chunks 2, 3, 4 never arrived. The stitch reads chunkMap.get(2) = {}, chunkMap.get(3) = {}, chunkMap.get(4) = {} — dimensions from those chunks are missing.
- **Also**: web/lib/adapters/SupabasePersistenceAdapter.ts:104 — `.from('videos').upsert(...)`. No migration creating the `videos` table exists in repo (per prior audit). If the table is missing, the upsert throws and is caught in `.catch(() => {})` line 113-115, silently swallowing the failure. The KG cascade at L138-157 ALSO depends on this analysis row existing.

### Downstream impact
- Out-of-order chunk arrivals trigger premature stitch with missing dimensions
- User sees stitched analysis with 1 dimension (only chunk 1's) when 11 were expected
- `videos` table missing → FK constraint failure on analysis row → analysis_markdown write may also fail if videos FK is required
- KG persistence swallows errors silently (line 154-156 `.catch(err => console.error(...))`) — KG data may be missing while analysis appears complete

---

## Stage 5 — Chain 4: Chat Flow

### Entry
- **File**: web/components/templates/console/ChatDock.tsx:114-120

### Prompt / grounding
- **File**: web/lib/usecases/ProcessChatMessageUseCase.ts:191-216
- **Snippet**:
```
let grounding = '';
if (groundingResult) {
  const md = typeof groundingResult.analysisMarkdown === 'string' ? groundingResult.analysisMarkdown : '';
  const status = groundingResult.status;
  const description = groundingResult.description;
  const descriptionSection = description 
    ? `\n\n--- YOUTUBE VIDEO DESCRIPTION (contains official links & resources) ---\n${description}\n\n`
    : '';
  if (md.trim().length > 0) {
    grounding =
      `You are the analyst for the YouTube video "${groundingResult.title}"${groundingResult.channelTitle ? ` by ${groundingResult.channelTitle}` : ''}. ` +
      `Answer the user's questions using the structured analysis and the description below; be concise, accurate, and cite dimension names where relevant. ` +
      `Do not ask which video — you have it.` +
      descriptionSection +
      `--- ANALYSIS ---\n` +
      md.slice(0, 12000);
  }
}
```

### Stream
- **File**: worker/src/chat-stream.ts:115-137 (`streamChatCascade`)
- **Snippet**: `CHAT_PROTOCOL` prepended; `max_tokens: 1200` cap; per-attempt 50s AbortController; cascade commit on first model with tokens

### Persist
- **File**: web/app/api/chat/persist/route.ts:19-79
- **Snippet**: HMAC verify → ownership check → `findAssistantByParentId` lookup → `createMessage` insert

### Evidence (code-observed)
- Reasoning regex: ProcessChatMessageUseCase.ts:56-58
- Turn limit: ProcessChatMessageUseCase.ts:96-112
- Grounding assembly: ProcessChatMessageUseCase.ts:191-216
- Cascade config: worker/src/chat-stream.ts:115-137
- S2S persist: web/app/api/chat/persist/route.ts:19-79

### Label
- code-observed

### First break point
- **Where**: web/lib/usecases/ProcessChatMessageUseCase.ts:56-58
- **Snippet**: `const isReasoning = trimmedRaw.startsWith('/reason') || trimmedRaw.startsWith('/think') || /\b(reason|explain|verify|calculate|logic|why|analyze deeply|deep dive)\b/i.test(trimmedRaw);`
- **What fails**: The regex matches common English words like "why", "logic", "explain". A user asking "Why is this video 10 minutes long?" or "Explain the diagram" gets routed to the reasoning cascade (more expensive model) instead of the chat cascade.
- **Where it fails**: L219-221 — `const chatModels = isReasoning ? await this.modelResolution.resolveModels(tier, 'reasoning') : await this.modelResolution.resolveModels(tier, 'chat');`. The reasoning cascade may include paid models (e.g., Claude Haiku 4.5). User pays for reasoning-tier pricing on benign questions.
- **Actual first break point**: ProcessChatMessageUseCase.ts:105-112 — `if (userMessageCount >= userLimit && !isRetry) { return ERR_CHAT_LIMIT_EXCEEDED }`. Free tier limit = 5 messages. After 5 messages, user gets 403 error. The retry path (L87-93) checks `clientMsgId` to allow re-submission. But if the user's `clientMsgId` was generated client-side and lost (e.g., on page refresh), the retry path returns the same row, but `userMessageCount >= userLimit` is still true (count includes persisted messages), so the limit blocks even retries.

### Downstream impact
- Cost: reasoning cascade over-billing on common English words
- UX: 5 free messages then hard wall; page refresh does NOT reset the counter (counted from DB)
- Race: clientMsgId-based retry path bypasses limit only if message already exists; new clientMsgId after refresh still blocks

---

## Stage 6 — Chain 5: Readback → UI Render

### Entry
- **File**: web/app/api/analyses/[id]/route.ts:6-49

### State rehydration
- **File**: web/hooks/useAnalysisStore.ts (not opened in this trace)
- **Snippet**: inferred — Zustand store rehydration pattern

### Component render
- **File**: web/components/containers/DashboardContainer.tsx (post PR #97 placeholder change at SelectedDimensionReadout.tsx:11-21)

### Visible UI
- **File**: web/components/dashboard/SelectedDimensionReadout.tsx:11-21 (post PR #97)

### Evidence (code-observed)
- Readback route: /api/analyses/[id]/route.ts:13 (verifyResourceOwnership call)
- Column selection: line 13 includes `analysis_markdown`, `analysis_payload`, `validation_report`, `analysis_at`
- Placeholder UI: SelectedDimensionReadout.tsx:11-21

### Label
- code-observed

### First break point
- **Where**: web/app/api/analyses/[id]/route.ts:13
- **Snippet**: `const { data: analysis, error } = await verifyResourceOwnership<any>(id, 'analyses', 'id, video_id, title, channel_title, model_used, analysis_markdown, analysis_payload, validation_report, analysis_at, created_at, detected_persona, streaming_interrupted, updated_at');`
- **What fails**: `verifyResourceOwnership` is not opened in this trace — its implementation determines whether the query joins RLS or uses service_role. If it uses service_role without user_id filter, ANY user can read ANY analysis by id (IDOR). If it uses auth.uid() check, this is safe.
- **Where it fails**: ownership/service.ts (not opened) — unknown implementation
- **Actual first break point**: web/app/api/analyses/[id]/route.ts:35 — `analysis_markdown: analysis.analysis_markdown || ''`. If the row has `analysis_markdown: NULL` but `analysis_payload: {...}` (which is a valid state for chunk-stitched analyses that haven't been migrated to markdown yet), the route returns empty string. The UI (DashboardContainer.tsx via SelectedDimensionReadout) renders an empty markdown. The user sees the new PR #97 placeholder "Select a dimension to view details" forever.
- **Also**: web/components/dashboard/SelectedDimensionReadout.tsx:11-21 — the placeholder branch only fires when `dimension` is null. The parent component (DashboardContainer) decides what `dimension` to pass. If the parent renders with `dimension=null` after a successful fetch (e.g., because payload deserialization failed silently), the placeholder appears instead of the actual content.

### Downstream impact
- Successful analyses with NULL analysis_markdown render as empty placeholder
- User cannot distinguish "analysis pending" from "analysis complete with empty content"
- The PR #97 placeholder (post-fix for empty state) becomes the default state for chunk-stitched analyses that haven't been migrated to markdown

---

## Stage 7 — Root Cause Summary

### Chain 1 (Analysis creation)
- **Root cause**: CreateAnalysisUseCase.ts:104 transcript-empty check is too narrow — doesn't catch placeholder strings
- **Evidence**: code-observed line 104
- **Confidence label**: code-observed (not runtime-proven; placeholder string behavior depends on ingestion adapter)

### Chain 2 (Analysis streaming)
- **Root cause**: LLMCascade.ts:89 cascade commit condition requires `finalText` truthy; empty token models cause infinite iteration
- **Evidence**: code-observed line 89
- **Confidence label**: code-observed (not runtime-proven; depends on cascade model behavior)

### Chain 3 (Analysis persistence)
- **Root cause**: /api/analyses/persist/route.ts:193-205 grace period uses `newestTime` which mis-triggers on out-of-order chunk arrival
- **Evidence**: code-observed lines 193-205
- **Confidence label**: code-observed (mathematically provable from code shape)

### Chain 4 (Chat flow)
- **Root cause**: ProcessChatMessageUseCase.ts:56-58 reasoning regex matches common English words, over-routing to expensive reasoning cascade
- **Evidence**: code-observed lines 56-58
- **Confidence label**: code-observed

### Chain 5 (Readback → UI render)
- **Root cause**: /api/analyses/[id]/route.ts:35 returns empty string for NULL analysis_markdown; chunk-stitched analyses may have NULL markdown
- **Evidence**: code-observed line 35
- **Confidence label**: code-observed

---

## Stage 8 — Fix List (only directly proven)

### Fix #1: Chain 3 — grace period out-of-order protection
- **File**: web/app/api/analyses/persist/route.ts:193-205
- **Minimal fix**: replace `newestTime = Math.max(...timestamps)` with `oldestTime = Math.min(...timestamps)` AND `now - newestTime >= 30000 AND now - oldestTime >= 60000` (require ALL chunks to be at least 60s old, not just the newest)
- **Why**: prevents premature stitch when out-of-order chunks arrive
- **Evidence**: code-observed
- **Label**: code-observed

### Fix #2: Chain 4 — reasoning regex precision
- **File**: web/lib/usecases/ProcessChatMessageUseCase.ts:56-58
- **Minimal fix**: require word boundary AND multi-word context, e.g., `/^(reason|explain|verify|analyze|deep dive|step by step|walk me through)\b/i` at start of message
- **Why**: prevents over-routing of common English words like "why" and "logic"
- **Evidence**: code-observed
- **Label**: code-observed

### Fix #3: Chain 5 — readback markdown fallback
- **File**: web/app/api/analyses/[id]/route.ts:35
- **Minimal fix**: `analysis_markdown: analysis.analysis_markdown || (analysis.analysis_payload ? reconstructMarkdown(analysis.analysis_payload) : '')`
- **Why**: prevents empty render when chunk-stitched analysis has NULL markdown
- **Evidence**: code-observed
- **Label**: code-observed

### Fix #4: Chain 1 — transcript placeholder check
- **File**: web/lib/usecases/CreateAnalysisUseCase.ts:104-120
- **Minimal fix**: add `|| ingestionResult.transcript.includes('Transcript unavailable')` to `isTranscriptEmpty`; trigger Decodo fallback when placeholder is detected
- **Why**: prevents LLM invocation on placeholder text
- **Evidence**: code-observed
- **Label**: code-observed

---

## Stage 9 — Risks / Unknowns

### Risk: ownership/service.ts implementation
- **Why it matters**: verifyResourceOwnership may use service_role without user_id filter — IDOR vulnerability
- **What would close it**: read ownership/service.ts + grep for `service_role` and `auth.uid()` calls

### Risk: videos table missing migration
- **Why it matters**: updateAnalysisResult.ts:104 upserts to `videos` table; no migration creates it; failure silently swallowed in .catch
- **What would close it**: read supabase/migrations/ for `CREATE TABLE videos`; run `pnpm exec supabase db diff` to check schema drift

### Risk: ReasoningEngine / PromptBuilder prompt assembly
- **Why it matters**: chunked analysis uses ChunkPayloadSchema shape; if PromptBuilder emits full UCISPayloadV2, persist path's chunk branch won't trigger
- **What would close it**: read worker/src/services/ReasoningEngine.ts and PromptBuilder.ts to verify chunk-mode prompt

### Risk: atomic-persist guard behavior
- **Why it matters**: streaming abort → waitUntil persist; if atomic-persist doesn't fire on abort, analysis is lost
- **What would close it**: read worker/src/services/atomic-persist.ts to verify abort handler

### Risk: auth callback PKCE completion
- **Why it matters**: PKCE flow requires code verifier to be present at callback time; if missing, session is not established
- **What would close it**: read web/app/auth/callback/route.ts (or page.tsx) and verify cookie-based verifier persistence

### Risk: PostgresBillingAdapter quota gate
- **Why it matters**: checkGate may incorrectly count analyses for users with multiple browser sessions
- **What would close it**: read PostgresBillingAdapter.ts to verify count logic

### Risk: Supabase RLS allows service-role queries
- **Why it matters**: SupabaseAnalysisAdapter.ts:14 uses `getSupabaseServiceClient()` which bypasses RLS; if RLS misconfigured, queries return cross-user data
- **What would close it**: run `pnpm exec supabase db dump --schema public` to inspect RLS policies

### Risk: cache hit returns stale data after user updates
- **Why it matters**: CreateAnalysisUseCase.ts:67 findCachedAnalysis uses `order('created_at', { ascending: false }).limit(1)` — returns most recent, but if user re-analyzes with forceRefresh=false, may return OLD analysis
- **What would close it**: trace forceRefresh flag flow

---

## Stage 10 — Conclusion

### One short verdict
- Five chains traced; first break points identified in code shape only; no chain is runtime-proven end-to-end.

### What would change my mind
- A Playwright test that submits a real YouTube URL with placeholder transcript, observes Decodo fallback (or absence), and asserts final analysis state
- A test that submits out-of-order chunks to /api/analyses/persist, observes grace-period stitch, and asserts final dimension count
- A test that submits a chat message containing the word "why" and asserts cascade routing
- A test that fetches /api/analyses/[id] for a chunk-stitched analysis with NULL analysis_markdown and asserts response shape
- A read of ownership/service.ts to verify the IDOR surface
- A read of atomic-persist.ts to verify abort handler fires
- A read of web/app/auth/callback/route.ts to verify PKCE completion

---

## End of Report