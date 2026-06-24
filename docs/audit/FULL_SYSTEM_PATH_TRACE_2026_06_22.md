# FULL-SYSTEM PATH TRACE — STRICT EVIDENCE ONLY

**Scope**: End-to-end path traces for every major user-facing flow in `hex-yt-intel`  
**Method**: Direct file reads; no prior-report citations; no synthesis beyond visible code  
**Labels**: code-observed, test-proven, runtime-proven, inferred, unknown  

---

## PATH 1 — ANALYSIS CREATION (URL → processing token)

### Entry: ChatDock submit
- **File**: `web/components/templates/console/ChatDock.tsx:114-120`
- **Snippet**: `await sendMessage(t, { analysisId: analysisId ?? null });` (chat path, not analysis)
- **Label**: code-observed

### Entry: DashboardContainer startAnalysis
- **File**: `web/components/containers/DashboardContainer.tsx:301-310` (after PR #97 change)
- **Snippet**: `startTransition(() => { startAnalysis(url, getUserTimezone()); });`
- **Label**: code-observed

### Hook: useSSEStream.startAnalysis
- **File**: `web/hooks/useSSEStream.ts:25-31, 47-54`
- **Snippet**: `if (processingRef.current) return; processingRef.current = true; if (abortControllerRef.current) abortControllerRef.current.abort();`
- **Label**: code-observed

### API: POST /api/analyses
- **File**: `web/app/api/analyses/route.ts:42-95`
- **Snippet**:
```
const validation = AnalysisCreateSchema.safeParse(body);
if (!validation.success) { return 400; }
const identity = await authAdapter.authenticate();
if (!identity) { return 401; }
const useCaseResult = await createAnalysisUseCase.execute({...});
if (useCaseResult.type === 'cache_hit') { return json useCaseResult.data; }
return json useCaseResult.data with status 202;
```
- **Label**: code-observed

### UseCase: CreateAnalysisUseCase.execute
- **File**: `web/lib/usecases/CreateAnalysisUseCase.ts:60-195`
- **Steps** (each with file:line evidence):
  1. L60: `const videoId = extractVideoId(params.url);` — invalid URL → `ERR_INVALID_URL` (400)
  2. L66-80: cache hit lookup via `findCachedAnalysis({ userId, videoId })`; if cached → return `cache_hit` early
  3. L83-97: quota gate via `billingQuota.checkGate(...)`; blocked → `ERR_QUOTA_EXCEEDED` (402)
  4. L102-120: ingest metadata + transcript; if native empty, Decodo fallback; on total failure → `ERR_INGESTION_FAILED` (500)
  5. L127-133: detect persona + build job metadata
  6. L136: resolve models via `modelResolution.resolveModels(tier, 'analysis')`
  7. L139-152: insert processing stub via `persistence.upsertProcessingStub(...)`
  8. L157-171: sign HMAC token via `tokenCrypto.signAnalysisToken({...})`; signing fail → 500
  9. L173-194: return `processing` with stream URL `${env.cloudflareWorkerUrl}/analyze-llm-stream` + sig + exp
- **Label**: code-observed

### Return to client
- **File**: `web/app/api/analyses/route.ts:86`
- **Snippet**: `return NextResponse.json(useCaseResult.data, { status: 202, headers: responseHeaders });`
- **Label**: code-observed

### Boundary/decision points in PATH 1
| Boundary | Code location | Behavior |
|---|---|---|
| Invalid URL | CreateAnalysisUseCase.ts:60-63 | 400 ERR_INVALID_URL |
| Cache hit | CreateAnalysisUseCase.ts:66-80 | return cache_hit (200) |
| Quota exceeded | CreateAnalysisUseCase.ts:83-97 | 402 ERR_QUOTA_EXCEEDED |
| Transcript total fail | CreateAnalysisUseCase.ts:121-124 | 500 ERR_INGESTION_FAILED |
| Token signing fail | CreateAnalysisUseCase.ts:162-171 | 500 ERR_TOKEN_SIGNING_FAILED |

### Failure modes
- **code-observed**: All 5 boundary branches in CreateAnalysisUseCase.ts
- **unknown**: Whether cache_hit is exercised in production traffic

---

## PATH 2 — ANALYSIS STREAMING (worker LLM cascade → SSE → persist)

### Entry: Worker route /analyze-llm-stream
- **File**: `worker/src/routes/analysis.ts`
- **Snippet** (route registration): in `worker.ts` `app.post('/analyze-llm-stream', ...)`
- **Label**: code-observed

### HMAC verification
- **File**: `worker/src/routes/analysis.ts:83-118` (`verifyStreamToken`)
- **Snippet**: HMAC over `${videoId}:${analysisId}:${exp}:${modelStr}` with `STREAM_HMAC_SECRET`; supports `DEV_HMAC_SECRET` fallback
- **Label**: code-observed

### Transcript fetch-if-missing
- **File**: `worker/src/routes/analysis.ts:120-154`
- **Snippet**:
```
const isPlaceholder = transcript?.includes("Transcript unavailable for this video");
if (!transcript || transcript.trim().length === 0 || isPlaceholder) {
  const extractor = new TranscriptExtractor(env.RESIDENTIAL_PROXY_URL, env.DECODO_API_KEY);
  const [result, channelMeta] = await Promise.all([
    extractor.fetch(videoId),
    channelId ? extractor.fetchChannelMetadata(channelId).catch(() => null) : Promise.resolve(null),
  ]);
}
```
- **Label**: code-observed

### Transcript gate (closed universe enforced)
- **File**: `worker/src/routes/analysis.ts:359-374`
- **Snippet**: `if (!transcript || ... || transcript.includes("content ingestion failed")) { return c.json({ error: "No transcript available", details: "...LLM analysis skipped to avoid unnecessary costs." }, 400); }`
- **Label**: code-observed

### LLM cascade
- **File**: `worker/src/services/LLMCascade.ts:26-100`
- **Snippet**:
```
constructor(apiKey: string, models?: string[]) {
  this.chain = models && models.length > 0
    ? models.map((model, idx) => { if (MODEL_CHAIN[idx] && MODEL_CHAIN[idx].model === model) return MODEL_CHAIN[idx]; ... })
    : MODEL_CHAIN;
}
async streamCascade(systemPrompt, onDelta, onStatus?, signal?) {
  for (const { model, name, providerOrder } of this.chain) {
    if (signal?.aborted) { break; }
    onStatus?.({ stage: 'model', model: name });
    const result = await this.callLLMStream(model, systemPrompt, ..., 120000, signal, providerOrder);
    if (result.started && finalText && !result.error) { produced = true; break; }
    finalText = '';
    ...
  }
}
```
- **Label**: code-observed (cascade iterates models, commits to first that produces tokens)

### ReasoningEngine / PromptBuilder
- **File**: not fully read; path observed in `worker/src/routes/analysis.ts:2-4` imports `ReasoningEngine`, `PromptBuilder`
- **Label**: inferred (not opened in this trace)

### Stream response
- **File**: `worker/src/routes/analysis.ts:156-200` (`buildStreamResponse`)
- **Snippet**: SSE encoder; `finalText` accumulated; `atomicPersist` created via `createAtomicPersist(...)` with persist+abortScope guards
- **Label**: code-observed

### S2S persist: atomicPersist → /api/analyses/persist
- **File**: `worker/src/routes/analysis.ts:172-187`
- **Snippet**: `await persistService.persist({ analysisId, videoId, finalText, modelUsed, status, activeSecret, appUrl, validate12D, chunkIndex, totalChunks })`
- **Label**: code-observed

### Failure modes in PATH 2
- HMAC mismatch → 401
- Transcript total fail → 400 (LLM not invoked)
- All cascade models fail → 500/empty stream
- Persist network fail → retry via atomic-persist

---

## PATH 3 — ANALYSIS PERSIST (S2S POST /api/analyses/persist)

### Entry: Worker → /api/analyses/persist
- **File**: `web/app/api/analyses/persist/route.ts:51-95` (schema validation)
- **Snippet**:
```
const bodySchema = z.object({
  analysisId: z.string().uuid(),
  videoId: z.string().min(1),
  markdown: z.string(),
  payload: z.unknown().optional(),
  model: z.string().optional(),
  valid: z.boolean().optional(),
  contentSig: z.string(),
  status: z.string().optional().default('completed'),
  chunkIndex: z.number().int().min(1).max(TOTAL_STREAMS).optional(),
  totalChunks: z.number().int().refine((val) => val === TOTAL_STREAMS, ...).optional(),
});
```
- **Label**: code-observed

### HMAC verification
- **File**: `web/app/api/analyses/persist/route.ts:96-111`
- **Snippet**:
```
const canonical = JSON.stringify({ markdown, payload: payload ?? null });
let isSigValid = false;
try { isSigValid = await verifyContentSig(canonical, contentSig); }
catch (error) { Sentry.captureException + 500 }
if (!isSigValid) { return 401 }
```
- **Label**: code-observed

### Payload schema (chunk vs full)
- **File**: `web/app/api/analyses/persist/route.ts:113-139`
- **Snippet**:
```
if (payload !== undefined && payload !== null) {
  const isChunk = chunkIndex !== undefined;
  const parseResult = isChunk
    ? z.object({ schemaVersion: z.literal('2.0'), dimensions: z.array(z.object({ number: z.number().int().min(1).max(TOTAL_DIMENSIONS), name: z.string(), content: z.string() })) }).passthrough().safeParse(payload)
    : UCISPayloadV2Schema.safeParse(payload);
}
```
- **Label**: code-observed (mirrors PR #97 ChunkPayloadSchema in ZodSchemas.ts)

### Chunked persistence + grace-period stitch
- **File**: `web/app/api/analyses/persist/route.ts:162-334`
- **Steps**:
  1. L168: `persistenceAdapter.persistAnalysisChunk({ analysisId, chunkIndex, dimensionsCovered, payload, status })`
  2. L177-187: fetch all chunks; check if `1..TOTAL_STREAMS` all completed
  3. L193-205: grace-period fallback — if `completedChunks.length >= ceil(TOTAL_STREAMS * 0.6)` AND `now - newestTime >= 30000`, set `allChunksCompleted = true`
  4. L207-330: stitch — concat dimensions, take first persona/classification/monetization, concat KG nodes/edges, reconstruct markdown, write to main tables, update cache, publish QStash
- **Label**: code-observed

### Boundary: `chunks` may be undefined
- **File**: `web/app/api/analyses/persist/route.ts:177-178`
- **Snippet**: `const chunks = await persistenceAdapter.findAnalysisChunks({ analysisId }); const completedChunks = chunks ? chunks.filter(...) : [];`
- **Label**: code-observed

### Cache update + QStash publish
- **File**: `web/app/api/analyses/persist/route.ts:302-330`
- **Snippet**:
```
const cacheKey = generateCacheKey('edge-stream', stitchedMarkdown, '5.1');
await setAnalysisCache(cacheKey, cachedPayload).catch(() => {});
if (!!priorReport.transcript_available) {
  await publishValidationTask({ videoId, markdown: stitchedMarkdown, filename: buildValidationFilename(...), userId, analysisId, metadata }).catch(() => {});
}
```
- **Label**: code-observed (cache + QStash writes are wrapped in `.catch(() => {})` — failures are silent)

---

## PATH 4 — CHAT SUBMIT (user message → bouncer → stream URL)

### Entry: ChatDock submit
- **File**: `web/components/templates/console/ChatDock.tsx:114-120`
- **Snippet**: `await sendMessage(t, { analysisId: analysisId ?? null });`
- **Label**: code-observed

### useChatStore.sendMessage
- **File**: `web/store/useChatStore.ts:350-380`
- **Snippet**:
```
let convId = get().activeId;
if (!convId) convId = await get().newConversation({ analysisId: opts?.analysisId ?? null });
if (!convId) return;
const clientMsgId = newClientMsgId();
outbox.add({ clientMsgId, conversationId: convId, content: trimmed, createdAt: new Date().toISOString() });
await deliver(convId, clientMsgId, trimmed);
```
- **Label**: code-observed

### Bouncer: POST /api/chat/conversations/[id]/messages
- **File**: `web/app/api/chat/conversations/[id]/messages/route.ts:48-103`
- **Steps**:
  1. L53-57: auth via `authAdapter.authenticate()`; fail → 401
  2. L62-70: payload schema `{ content, clientMsgId }`; fail → 400
  3. L78-82: instantiate `ProcessChatMessageUseCase(persistence, model, token)`
  4. L84-90: `useCase.execute({ conversationId, userId, tier, content, clientMsgId })`
  5. L92-97: error result → `{ error, code, status }`
  6. L99: success → `return NextResponse.json(result.data)`
- **Label**: code-observed

### UseCase: ProcessChatMessageUseCase.execute (partial read)
- **File**: `web/lib/usecases/ProcessChatMessageUseCase.ts:192-263`
- **Steps**:
  1. L192-216: grounding — fetch conversation → analysis → `descriptionSection + --- ANALYSIS --- + md.slice(0, 12000)`; empty md → empty grounding
  2. L245-263: return `{ type: 'success', data: { user, stream: { url: ${env.cloudflareWorkerUrl}/chat-stream, sig, exp }, payload: { conversationId, userId, grounding, history, models } } }`
- **Label**: code-observed

---

## PATH 5 — CHAT STREAMING (worker /chat-stream → cascade → SSE → atomic-persist)

### Entry: Worker route /chat-stream
- **File**: `worker/src/routes/chat.ts:1-8`
- **Snippet**: `chat.post("/chat-stream", handleChatStream);`
- **Label**: code-observed

### Handler: handleChatStream (worker/src/chat-stream.ts:115-137)
- **File**: `worker/src/chat-stream.ts:115-137` (`streamChatCascade`)
- **Snippet**:
```
const messages: Array<...> = [{ role: "system", content: CHAT_PROTOCOL }];
if (grounding) messages.push({ role: "system", content: grounding });
for (const m of history) messages.push({ role: m.role, content: m.content });
const chain = models && models.length > 0
  ? models.map((m, idx) => { if (CHAT_CASCADE[idx] && CHAT_CASCADE[idx].model === m) return CHAT_CASCADE[idx]; ... })
  : CHAT_CASCADE;
for (const { model, providerOrder } of chain) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 50000);
  let full = "";
  try {
    const res = await fetch(OPENROUTER_URL, { ... body: JSON.stringify({ model: translateModelId(model), temperature: 0.6, max_tokens: 1200, stream: true, reasoning: { effort: "low" }, messages, provider: { sort: "latency", allow_fallbacks: false, ...(providerOrder ? { order: providerOrder } : {}) } }) });
```
- **Label**: code-observed (CHAT_PROTOCOL prepended; max_tokens: 1200 cap; per-attempt 50s abort)

### Atomic-persist guard
- **File**: `worker/src/chat-stream.ts:8` import + `createAtomicPersist(...)` call (not fully read)
- **Label**: inferred (imported but body not opened)

### Failure modes in PATH 5
- HMAC mismatch → 401
- All chat cascade models fail → 500/empty stream
- Persist network fail → S2S POST /api/chat/persist fails → DB row missing

---

## PATH 6 — CHAT PERSIST (S2S POST /api/chat/persist)

### Entry: Worker → /api/chat/persist
- **File**: `web/app/api/chat/persist/route.ts:19-79`
- **Steps**:
  1. L22-31: schema validation `{ conversationId, userId, content, contentSig }`; fail → 400
  2. L37-50: HMAC verification via `verifyContentSig(content, contentSig)`; fail → 401
  3. L55-59: ownership — `persistence.getConversation({ conversationId })`; not found OR `conv.userId !== userId` → 404
  4. L62-68: fetch messages; find latest user message (parentMessageId)
  5. L70-76: `persistence.createMessage({ conversationId, userId, role: 'assistant', content, parentMessageId })`
  6. L78: return `{ ok: true, message: aRow }`
- **Label**: code-observed

---

## PATH 7 — AUTH (Supabase session → identity)

### Auth adapter
- **File**: `web/lib/adapters/SupabaseAuthAdapter.ts:5-19`
- **Snippet**:
```
async authenticate(): Promise<AuthIdentity | null> {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('users').select('tier').eq('id', user.id).maybeSingle();
  const tier = error || !data ? 'free' : (data.tier as any) || 'free';
  return { userId: user.id, email: user.email, tier };
}
```
- **Label**: code-observed

### Identity derivation
- **File**: `web/lib/adapters/SupabaseAuthAdapter.ts:16`
- **Snippet**: `const tier = error || !data ? 'free' : (data.tier as any) || 'free';`
- **Label**: code-observed (DB error or null → falls back to 'free' tier)

### Auth callback
- **File**: `web/app/auth/callback/` exists (not opened in this trace)
- **Label**: inferred (directory exists but content not verified)

### Auth bypass
- **File**: `web/app/api/analyses/route.ts:52-56`
- **Snippet**: `// STRICT tenant isolation. Identity is derived ONLY from the verified Supabase session; there is no static/bearer test bypass on this route. const identity = await authAdapter.authenticate(); if (!identity) { return 401; }`
- **Label**: code-observed (comment explicitly states no test bypass on this route)

---

## PATH 8 — CACHE HIT (early-return cached analysis)

### Entry: CreateAnalysisUseCase
- **File**: `web/lib/usecases/CreateAnalysisUseCase.ts:66-80`
- **Snippet**:
```
if (!params.forceRefresh) {
  const cached = await this.persistence.findCachedAnalysis({ userId: params.userId, videoId });
  if (cached) {
    return { 
      type: 'cache_hit', 
      data: { ...cached, status: 'done', markdown: cached.analysisMarkdown, metadata: cached.cachedReport?.metadata },
      persona: (cached.cachedReport?.persona as PersonaId) || 'p1'
    };
  }
}
```
- **Label**: code-observed

### Cache hit response
- **File**: `web/app/api/analyses/route.ts:81-83`
- **Snippet**: `if (useCaseResult.type === 'cache_hit') { return NextResponse.json(useCaseResult.data, { headers: responseHeaders }); }`
- **Label**: code-observed (returns 200, not 202)

---

## PATH 9 — ATLAS / CROSS-VIDEO AGGREGATION

### Atlas page
- **File**: `web/app/atlas/page.tsx:7-18`
- **Snippet**: `export default async function AtlasPage() { if (!session) { redirect('/auth/signin'); } return <AtlasClient />; }`
- **Label**: code-observed

### Global graph API
- **File**: `web/app/api/atlas/global-graph/route.ts:1-26`
- **Snippet**: `const analyses = await persistence.getAnalysesByTenant(user.id); const useCase = new AggregateGlobalGraphUseCase(); const globalGraph = await useCase.execute(analyses); return NextResponse.json(globalGraph);`
- **Label**: code-observed

### Cross-video aggregation (string-label merge)
- **File**: `web/lib/usecases/AggregateGlobalGraphUseCase.ts:1-44`
- **Snippet**:
```
const nodeMap = new Map<string, GraphNode>();
const edgeMap = new Map<string, GraphEdge>();
for (const analysis of analyses) {
  for (const node of analysis.nodes) {
    const existingNode = nodeMap.get(node.label);
    if (existingNode) { existingNode.weight += node.weight; ... }
    else { nodeMap.set(node.label, { ...node }); }
  }
  for (const edge of analysis.edges) {
    const edgeKey = `${edge.source}-${edge.target}-${edge.kind}`;
    const existingEdge = edgeMap.get(edgeKey);
    if (existingEdge) { existingEdge.strength = Math.max(...); }
    else { edgeMap.set(edgeKey, { ...edge }); }
  }
}
```
- **Label**: code-observed (string-label merge; no entityType-based domain grouping)

---

## PATH 10 — QUOTA GATE

### Quota check in CreateAnalysisUseCase
- **File**: `web/lib/usecases/CreateAnalysisUseCase.ts:83-97`
- **Snippet**: `const quota = await this.billingQuota.checkGate({ userId, tier, email, endpoint: 'analyses' }); if (!quota.allowed) { return { type: 'error', code: 'ERR_QUOTA_EXCEEDED', status: 402, message: 'Monthly analysis quota exceeded. Please upgrade your plan.' }; }`
- **Label**: code-observed

### Quota port implementation
- **File**: not fully read; `PostgresBillingAdapter` is the concrete impl (mentioned in route.ts:17-19)
- **Label**: inferred (adapter instantiated; body not opened in this trace)

---

## PATH 11 — EXPORT (markdown or PDF)

### Export trigger
- **File**: `web/components/containers/DashboardContainer.tsx:312` (handleExport) (not fully read)
- **Label**: inferred

### Export API
- **File**: `web/app/api/pdf/` exists
- **Label**: inferred (directory exists but content not verified)

---

## PATH SUMMARY TABLE

| # | Path | Entry | UseCase / Handler | S2S Sink | Verified |
|---|------|-------|-------------------|----------|----------|
| 1 | Analysis Creation | ChatDock/DashboardContainer | `createAnalysisUseCase.execute` | (returns stream URL) | code-observed |
| 2 | Analysis Streaming | worker `/analyze-llm-stream` | `LLMCascade.streamCascade` | `PersistService.persist` | code-observed |
| 3 | Analysis Persist | `POST /api/analyses/persist` | zod + HMAC + chunk-stitch | Supabase updateAnalysisResult | code-observed |
| 4 | Chat Submit | ChatDock.submit | `ProcessChatMessageUseCase.execute` | (returns stream URL) | code-observed |
| 5 | Chat Streaming | worker `/chat-stream` | `streamChatCascade` | atomic-persist → S2S | code-observed (partial) |
| 6 | Chat Persist | `POST /api/chat/persist` | HMAC + ownership + createMessage | Supabase createMessage | code-observed |
| 7 | Auth | `SupabaseAuthAdapter.authenticate` | (direct) | Supabase getUser + tier | code-observed |
| 8 | Cache Hit | `findCachedAnalysis` | early return | Supabase cache table | code-observed |
| 9 | Atlas | `/atlas` → `useGlobalGraph` | `AggregateGlobalGraphUseCase.execute` | Supabase read analyses | code-observed |
| 10 | Quota Gate | `billingQuota.checkGate` | early return 402 | PostgresBillingAdapter | code-observed (partial) |
| 11 | Export | handleExport (inferred) | `/api/pdf/*` (inferred) | not traced | inferred |

---

## UNKNOWNS (paths not fully verified)

### Item: ReasoningEngine / PromptBuilder bodies
- **Why unknown**: Not opened in this trace; imports visible in `worker/src/routes/analysis.ts:2-4`
- **What would prove it**: Direct read of `worker/src/services/ReasoningEngine.ts` and `worker/src/services/PromptBuilder.ts`

### Item: Atomic-persist guard implementation
- **Why unknown**: `createAtomicPersist` imported in both `analysis.ts` and `chat-stream.ts`; body not opened
- **What would prove it**: Read `worker/src/services/atomic-persist.ts`

### Item: Auth callback handler
- **Why unknown**: `web/app/auth/callback/` directory exists but body not opened
- **What would prove it**: Read `web/app/auth/callback/route.ts` or `page.tsx`

### Item: PostgresBillingAdapter body
- **Why unknown**: instantiated in route.ts:17; body not opened
- **What would prove it**: Read `web/lib/adapters/PostgresBillingAdapter.ts`

### Item: SettingsModelAdapter body
- **Why unknown**: instantiated in routes; resolves per-tier cascade
- **What would prove it**: Read `web/lib/adapters/SettingsModelAdapter.ts`

### Item: Export pipeline
- **Why unknown**: handleExport not fully read; PDF route not opened
- **What would prove it**: Read `web/app/api/pdf/route.ts` and DashboardContainer.tsx:312

### Item: Whether worker streaming actually completes within browser→worker 120s budget
- **Why unknown**: No runtime trace or Playwright streaming test in repo (only basic auth/render tests in `web/tests/`)
- **What would prove it**: A long-form streaming Playwright test with transcript input

### Item: Whether chunk-stitch grace period activates correctly
- **Why unknown**: Logic visible in code; no unit test for the `30s` window
- **What would prove it**: A unit test simulating slow-arriving chunks

### Item: Whether the cache hit path is exercised in production
- **Why unknown**: `findCachedAnalysis` is wired; no cache-hit telemetry visible
- **What would prove it**: A log query for `type === 'cache_hit'` responses

### Item: Whether chat cascade actually commits to first-producing model
- **Why unknown**: LLMCascade.ts:89-92 visible; no integration test
- **What would prove it**: A test with one model producing 401 + another producing tokens

---

## END OF REPORT

**Note**: This report traces only what is visible in the current branch. Paths marked `inferred` or `unknown` are gaps in this trace, not claims about behavior. No claims of "healthy", "all good", or "verified" are made.