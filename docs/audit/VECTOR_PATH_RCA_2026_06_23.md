# VECTOR / EMBEDDING PATH RCA ONLY

**Scope**: Trigger → QStash validate → QStash embed → OpenRouter → Upstash Vector upsert → query. No analysis persistence, no chat, no browser.  
**Labels**: runtime-proven, test-proven, code-observed, inferred, unknown  

---

## Stage 1 — Artifact Inventory

### File: web/app/api/analyses/persist/route.ts
- **Status**: full read (lines 1-396)
- **Proves**: calls `publishValidationTask()` at L321-329, gated by `transcript_available`
- **Cannot prove**: whether QStash token is configured at runtime

### File: web/lib/qstash-client.ts
- **Status**: full read (lines 1-145)
- **Proves**: `publishValidationTask()` at L43-68: requires `QSTASH_TOKEN` + `NEXT_PUBLIC_APP_URL`; throws if missing, caught in .catch, returns `'unknown'`. `publishEmbeddingTask()` at L74-102: same requirements. `verifyQStashSignature()` at L110-145: requires `QSTASH_CURRENT_SIGNING_KEY`, returns false if missing.
- **Cannot prove**: whether any env var is present at runtime

### File: web/app/api/webhooks/validate/route.ts
- **Status**: full read (lines 1-154)
- **Proves**: QStash signature verify L26-34; UCIS validation L54-61; validation report save L70-88 (failure non-blocking); `publishEmbeddingTask()` call L103-116 (failure non-blocking)
- **Cannot prove**: whether QStash delivers the task; whether any step succeeds past the QStash verify gate

### File: web/app/api/webhooks/embed/route.ts
- **Status**: full read (lines 1-210)
- **Proves**: QStash signature verify L44-54; placeholder guard L64-92; `generateEmbedding(markdown)` L112-117; `vectorIndex.upsert()` L150-159; `logUsage` L162-172 (failure non-blocking)
- **Cannot prove**: whether OpenRouter returns a valid embedding; whether vector upsert succeeds

### File: web/lib/embeddings.ts
- **Status**: full read (lines 1-183)
- **Proves**: `generateEmbedding()` at L33-118: requires `process.env.OPENROUTER_API_KEY`; POSTs to OpenRouter `/v1/embeddings` with `text-embedding-3-small`; 3 retries with exponential backoff; 5s timeout per attempt; 1536-dimension output
- **Cannot prove**: whether OpenRouter returns at runtime

### File: web/app/api/search/route.ts
- **Status**: full read (lines 1-204)
- **Proves**: `POST /api/search` generates embedding for user query (L99), queries `vectorIndex.query()` (L116-120), enriches results via `findAnalysisById` (L126-152), returns enriched results (L159-164)
- **Cannot prove**: whether query returns results (depends on vectors existing in index)

### File: web/lib/env.ts
- **Status**: partial read (lines 41-60)
- **Proves**: MOCK_DEFAULTS at L42-53; UPSTASH_VECTOR_REST_TOKEN is `'mock-vector-token'` (L49); OPENROUTER_API_KEY is `'sk-or-v1-mock-key-preview-only'` (L45); QSTASH_TOKEN is NOT in MOCK_DEFAULTS (not listed)
- **Cannot prove**: which env vars are set in production vs preview

---

## Stage 2 — Trigger Source

### Primary trigger
- **File**: web/app/api/analyses/persist/route.ts
- **Line#**: 321-329
- **Snippet**:
```
if (!!priorReport.transcript_available) {
  await publishValidationTask({
    videoId,
    markdown: stitchedMarkdown,
    filename: buildValidationFilename(row.title, row.channelTitle),
    userId: row.userId,
    analysisId,
    metadata: { title: row.title, channelTitle: row.channelTitle || '' },
  }).catch(() => {});
}
```
- **Gate**: `!!priorReport.transcript_available` — if transcript was unavailable, no vector task is published
- **Label**: code-observed

### Secondary trigger (chat)
- No chat path publishes embedding or validation tasks
- **Label**: code-observed (chat path has no vector trigger)

### No other trigger exists
- No cron, no worker-side trigger, no user-initiated trigger
- **Label**: code-observed

---

## Stage 3 — QStash Hop 1 (persist → validate webhook)

### Step 1 — publishValidationTask
- **File**: web/lib/qstash-client.ts
- **Line#**: 43-68
- **Snippet**:
```
const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
if (!baseUrl) { throw new Error('NEXT_PUBLIC_APP_URL is missing...'); }
const result = await getQStashClient().publishJSON({
  url: `${baseUrl}/api/webhooks/validate`,
  body: payload,
  retries: 3,
  delay: 0,
});
```
- **Env requirements**: `QSTASH_TOKEN` (from `getQStashClient()` at L12-23), `NEXT_PUBLIC_APP_URL`
- **Failure mode**: missing env → throws → caught in `.catch()` at L60-67 → `return 'unknown'`
- **QSTASH_TOKEN** in env.ts MOCK_DEFAULTS (L42-53): **NOT present** — no mock fallback exists
- **Label**: code-observed

### Step 2 — Validate webhook entry
- **File**: web/app/api/webhooks/validate/route.ts
- **Line#**: 16-34
- **Snippet**:
```
const signature = request.headers.get('upstash-signature') || '';
const verified = await verifyQStashSignature(signature, bodyText);
if (!verified) { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
```
- **Label**: code-observed (only reachable if QStash hop 1 delivered — inferred)

### Step 3 — Validate webhook → publish embed task
- **File**: web/app/api/webhooks/validate/route.ts
- **Line#**: 103-116
- **Snippet**:
```
await publishEmbeddingTask({
  analysisId,
  markdown,
  userId,
}).catch((err) => {
  console.error('[validate-webhook] Embedding task publish failed', ...);
});
```
- **Failure mode**: same env requirements as hop 1; failure is non-blocking (caught in .catch)
- **Label**: code-observed

---

## Stage 4 — QStash Hop 2 (validate webhook → embed webhook)

### Step 4 — publishEmbeddingTask
- **File**: web/lib/qstash-client.ts
- **Line#**: 74-102
- **Snippet**:
```
const webhookUrl = `${baseUrl}/api/webhooks/embed`;
const result = await getQStashClient().publishJSON({
  url: webhookUrl,
  body: payload,
  retries: 2,
  delay: 5000, // 5s delay: allow validation to complete first
});
```
- **Env requirements**: same as hop 1 (`QSTASH_TOKEN`, `NEXT_PUBLIC_APP_URL`)
- **Label**: code-observed

### Step 5 — Embed webhook entry
- **File**: web/app/api/webhooks/embed/route.ts
- **Line#**: 44-54
- **Snippet**:
```
const verified = await verifyQStashSignature(signature, bodyText);
if (!verified) { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
```
- **Label**: code-observed

### Step 6 — Embed webhook placeholder guard
- **File**: web/app/api/webhooks/embed/route.ts
- **Line#**: 63-92
- **Snippet**:
```
const vectorUrl = process.env.UPSTASH_VECTOR_REST_URL || '';
const vectorToken = process.env.UPSTASH_VECTOR_REST_TOKEN || '';
const isPlaceholder = 
  !vectorUrl || 
  vectorUrl.includes('placeholder') || 
  !vectorToken || 
  vectorToken.includes('placeholder');
if (isPlaceholder) {
  // ... return 200 with skipped: true or 503 in production
}
```
- **Guard logic**: checks for literal `'placeholder'` string in URL or token
- **What the guard catches**: actual placeholder strings like `'placeholder-vector.upstash.io'` or `'placeholder-token-string'`
- **What the guard misses**: MOCK_DEFAULTS from env.ts L48-49 — `UPSTASH_VECTOR_REST_URL: 'https://rested-ferret-38816-eu1-vector.upstash.io'` (no 'placeholder') and `UPSTASH_VECTOR_REST_TOKEN: 'mock-vector-token'` (no 'placeholder')
- **Label**: code-observed (guard exists but has a gap)

### Step 7 — Generate embedding via OpenRouter
- **File**: web/app/api/webhooks/embed/route.ts
- **Line#**: 112-117
- **Snippet**:
```
const embeddingResult = await trackExternalCall('openai', 'text-embedding-3-small',
  () => generateEmbedding(markdown), { analysisId });
```
- **File**: web/lib/embeddings.ts
- **Line#**: 33-118
- **Snippet**:
```
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { throw new Error('OPENROUTER_API_KEY is not configured...'); }
const response = await fetch(OPENROUTER_API_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, ... },
  body: JSON.stringify({ model: 'text-embedding-3-small', input: truncatedText }),
  signal: controller.signal,
});
```
- **Env requirement**: `OPENROUTER_API_KEY`
- **In preview/CI**: env.ts L45 MOCK_DEFAULTS provides `'sk-or-v1-mock-key-preview-only'` — key exists but is not a real OpenRouter key
- **Failure mode**: OpenRouter 401 → 3 retries → all fail → `throw new Error('Failed ... after 3 attempts')` → caught by outer catch in embed route → returns 503
- **Label**: code-observed

### Step 8 — Vector upsert
- **File**: web/app/api/webhooks/embed/route.ts
- **Line#**: 150-159
- **Snippet**:
```
await vectorIndex.upsert({
  id: analysisId,
  vector: embeddingResult.embedding as unknown as number[],
  metadata: { title: analysis.title, videoId: analysis.video_id, userId, analysisId },
});
```
- **Only reached if**: QStash verify passes (L46-54) AND placeholder guard passes (L72-92) AND generateEmbedding succeeds (L112-117)
- **Label**: code-observed

### Step 9 — Vector query
- **File**: web/app/api/search/route.ts
- **Line#**: 116-120
- **Snippet**:
```
const searchResults = await vectorIndex.query<{ analysisId: string }>({
  data: queryEmbedding as unknown as string,
  topK: Math.min(topK, 50),
  includeMetadata: true,
});
```
- **Label**: code-observed (search route exists and queries Upstash Vector directly)

---

## Stage 5 — Vector Write Proof

### Break points, by environment

#### In preview/CI (env.ts MOCK_DEFAULTS active)
| Step | File:Line | Outcome | Label |
|---|---|---|---|
| QSTASH_TOKEN | `qstash-client.ts:14-18` | **MISSING** — not in MOCK_DEFAULTS → throws → .catch returns `'unknown'` | code-observed |
| QStash validation task | (never published) | **CHAIN BROKEN** — never reaches validate webhook | inferred |
| **Result**: vector chain never starts | | | |

#### In production (real env vars from Vercel)
| Step | File:Line | Outcome | Label |
|---|---|---|---|
| QSTASH_TOKEN | `qstash-client.ts:14` | assumes configured in Vercel env | unknown |
| Validate webhook | `validate/route.ts:16-116` | code path exists; QStash delivery assumed | inferred |
| Embed webhook placeholder guard | `embed/route.ts:64-70` | real credentials → guard passes | inferred |
| generateEmbedding | `embeddings.ts:39-42` | real OpenRouter key → expected to succeed | unknown |
| vectorIndex.upsert | `embed/route.ts:150-159` | code path exists | inferred |
| **Result**: chain is code-proven but not runtime-proven | | | |

#### In local dev (with .env.local)
| Step | File:Line | Outcome | Label |
|---|---|---|---|
| UPSTASH_VECTOR_REST_URL | `.env.local` | **REAL**: `rested-ferret-38816-eu1-vector.upstash.io` | runtime-proven (file exists) |
| UPSTASH_VECTOR_REST_TOKEN | `.env.local` | **REAL**: starts with `ABcFMHJlc3RlZC1m...` | runtime-proven (file exists) |
| OPENROUTER_API_KEY | `.env.local` | **REAL**: `sk-or-v1-...` | runtime-proven (file exists) |
| QSTASH_TOKEN | `.env.local` | **REAL**: `eyJVc2VySUQiOiI...` | runtime-proven (file exists) |
| QSTASH_CURRENT_SIGNING_KEY | unknown | not checked | unknown |
| **Result**: in local dev with .env.local, all credentials are real — chain could work end-to-end | | | |

### No runtime vector upsert proof exists
- No test asserts a vector was written to Upstash Vector
- No curl output or API response showing vector index count > 0
- No browser trace showing `/api/search` returning results
- **Label**: unknown (vector upsert is code-proven but not runtime-proven)

### No vector count query evidence
- Upstash Vector index count not queried in any trace
- No value for "vector count changed from zero"
- **Label**: unknown

---

## Stage 6 — Risks / Blind Spots

### Risk: QStash chain double hop multiplies failure surface
- **Why it matters**: The vector path requires TWO QStash deliveries to succeed sequentially. Each hop has its own env var requirements, timeout, and retry budget. If the validate webhook receives the task but the embed task publish fails (L103-116 .catch), the entire vector path breaks silently — QStash marks the validation task as consumed (200 returned) and never retries. The embed task is simply never published.
- **Label**: code-observed (validate webhook L82-88 and L107-116 both have .catch with no re-throw, so QStash always receives 200)

### Risk: embed webhook placeholder guard has a gap
- **Why it matters**: env.ts MOCK_DEFAULTS provides `UPSTASH_VECTOR_REST_TOKEN: 'mock-vector-token'` (L49). The guard checks `includes('placeholder')` which does NOT match `'mock-vector-token'`. In preview/CI, the guard passes and the webhook proceeds to call `generateEmbedding()` with the mock OpenRouter key, which fails after 3 retries (5s each), consuming ~15s of execution time and incurring QStash retries.
- **File**: web/app/api/webhooks/embed/route.ts:64-70; web/lib/env.ts:48-49
- **Label**: code-observed

### Risk: OpenRouter key failure cascades
- **Why it matters**: `generateEmbedding()` (embeddings.ts:33-118) has 3 retries with exponential backoff. Each attempt has a 5s timeout. Total time before failure: ~15s. During this time the Vercel function is billed. After 3 attempts, the outer catch returns 503, QStash retries 2 more times (L88 of qstash-client.ts), each with 5s delay. Total cost per stuck task: ~45s of execution.
- **Label**: code-observed

### Risk: search route silently returns empty results
- **Why it matters**: `/api/search` queries Upstash Vector (route.ts:116-120). If no vectors have been written (e.g., the QStash chain never completed), the query returns an empty list. The route returns `{ results: [], count: 0 }` with HTTP 200 — no error, no indication that the vector index is empty. User sees "no results found" with no diagnostic.
- **File**: web/app/api/search/route.ts:116-164
- **Label**: code-observed

### Risk: QStash NOT in env.ts MOCK_DEFAULTS
- **Why it matters**: env.ts L42-53 does not include `QSTASH_TOKEN` or `QSTASH_CURRENT_SIGNING_KEY` in MOCK_DEFAULTS. In any environment where these env vars are not explicitly set, `getQStashClient()` throws. This means the vector chain cannot work without explicit env var configuration — but the error is silently swallowed in .catch, so an operator would need to check console logs to see "QSTASH_TOKEN environment variable is required".
- **Label**: code-observed

---

## Stage 7 — Conclusion

### One short verdict
- The vector/embedding chain is **code-proven as a 2-hop QStash pipeline** (persist trigger → validate webhook → embed webhook → OpenRouter → Upstash Vector upsert → query via `/api/search`), but **no step beyond code wiring is runtime-proven**. In preview/CI environments, the chain breaks at the first QStash hop because `QSTASH_TOKEN` has no mock default. In local dev with `.env.local`, all credentials exist (verified by file read), so the chain could theoretically work end-to-end — but no test or runtime trace proves it.

### What would change my mind is
- A test that mocks `getQStashClient()` and asserts `publishValidationTask` is called when transcript is available (proves trigger reachability)
- A test that populates all required env vars, POSTs a valid payload to `/api/webhooks/embed`, and asserts `vectorIndex.upsert` was called with the expected `id` and `metadata` (proves vector write)
- A test that writes a vector to Upstash Vector, then queries `/api/search` and asserts the result count is > 0 (proves end-to-end query path)
- An Upstash Vector dashboard screenshot or API response showing the index count is non-zero after a real analysis completes
- Adding `'mock'` to the `isPlaceholder` check at embed/route.ts:64-70, then re-running in preview/CI and confirming the webhook returns `skipped: true` instead of attempting real API calls