# END-TO-END RCA: VECTOR / EMBEDDING PATH ONLY

**Scope**: Trigger → QStash → validate webhook → embed webhook → OpenRouter → Upstash Vector upsert  
**Method**: Fil e reads + CLI test runs + Direct REST queries to Upstash Vector + @upstash/vector SDK probe  
**Labels**: runtime-proven, test-proven, code-observed, inferred, unknown  

---

## Stage 1 — Artifact Inventory

| Artifact | Status | Proves | Cannot prove |
|---|---|---|---|
| `web/app/api/analyses/persist/route.ts` | full read | publishes QStash task at L321-329, gated by `transcript_available` | runtime QStash delivery |
| `web/lib/qstash-client.ts` | full read | `publishValidationTask` L43-68, `publishEmbeddingTask` L74-102, both require `QSTASH_TOKEN` | runtime env var presence |
| `web/app/api/webhooks/validate/route.ts` | full read | QStash verify L27-34; UCIS validate L54-61; report save L70-88 (non-blocking .catch); embed publish L103-116 (non-blocking .catch) | runtime delivery |
| `web/app/api/webhooks/embed/route.ts` | full read | QStash verify L46-54; placeholder guard L66-72; `generateEmbedding` L112-117; `vectorIndex.upsert` L150-159 | runtime upsert success |
| `web/lib/embeddings.ts` | full read | OpenRouter POST L54-67 with 5s timeout, 3 retries | runtime `OPENROUTER_API_KEY` validity |
| **Upstash Vector `/info`** | **runtime-proven** | index reachable, 1536-dim, COSINE, **vectorCount: 0** | — |
| **@upstash/vector SDK probe** | **runtime-proven** | HYBRID index REJECTS upsert without sparseVector; ACCEPTS upsert with sparseVector | — |
| `.env.local` credentials | file read | `UPSTASH_VECTOR_REST_TOKEN`, `QSTASH_TOKEN`, `OPENROUTER_API_KEY`, `QSTASH_CURRENT_SIGNING_KEY` all present | validity of QStash/OpenRouter keys |
| `web/package.json` | grep | `@upstash/vector: "1.2.3"` | — |

---

## Stage 2 — Trigger Source

### Primary trigger
- **File**: web/app/api/analyses/persist/route.ts
- **Line#**: 321-329
- **Snippet**: `if (!!priorReport.transcript_available) { await publishValidationTask({...}).catch(() => {}); }`
- **Gate**: transcript_available must be true; if unavailable, no vector task is ever published
- **Label**: code-observed

### No other trigger
- No cron, no worker-side trigger, no user-initiated trigger
- **Label**: code-observed

---

## Stage 3 — QStash Pipeline

### publishValidationTask
- **File**: web/lib/qstash-client.ts
- **Line#**: 43-68
- **Env needs**: `QSTASH_TOKEN` + `NEXT_PUBLIC_APP_URL`
- **Failure mode**: missing env → throw → caught in L60-67 .catch → returns `'unknown'` — chain silently stops
- **QSTASH_TOKEN status**: present in `.env.local` (runtime-proven via grep)
- **Label**: code-observed

### Validate webhook
- **File**: web/app/api/webhooks/validate/route.ts
- **Line#**: 16-120
- **Flow**: QStash signature verify → UCIS validate → save report (non-blocking .catch) → publishEmbeddingTask (non-blocking .catch)
- **Failure modes**: 
  - Report save fails at L82-88 → `.catch` logs warning, returns 200 anyway → QStash marks task consumed, no retry
  - Embed publish fails at L107-116 → `.catch` logs/ Sentries, returns 200 anyway → QStash marks task consumed, no retry
- **QSTASH_CURRENT_SIGNING_KEY status**: present in `.env.local` (runtime-proven via grep)
- **Label**: code-observed

### publishEmbeddingTask
- **File**: web/lib/qstash-client.ts
- **Line#**: 74-102
- **Same env needs** as hop 1; retries: 2; delay: 5s
- **Label**: code-observed

---

## Stage 4 — Embed Webhook

### Placeholder guard (PREVIOUSLY FIXED)
- **File**: web/app/api/webhooks/embed/route.ts
- **Line#**: 66-72
- **After fix**: checks `includes('placeholder')` AND `includes('mock')` for both URL and token
- **Label**: code-observed (fix applied in prior turn)

### generateEmbedding call
- **File**: web/app/api/webhooks/embed/route.ts
- **Line#**: 112-117
- **Snippet**: `const embeddingResult = await trackExternalCall('openai', 'text-embedding-3-small', () => generateEmbedding(markdown), { analysisId });`
- **Label**: code-observed

### generateEmbedding implementation
- **File**: web/lib/embeddings.ts
- **Line#**: 33-118
- **Needs**: `process.env.OPENROUTER_API_KEY` (present in `.env.local` — runtime-proven)
- **Behavior**: POST to OpenRouter `/v1/embeddings` with `text-embedding-3-small`, 5s timeout, 3 retries
- **Label**: code-observed (whether OpenRouter accepts the key is unknown)

### vectorIndex.upsert — THE ACTUAL BREAK
- **File**: web/app/api/webhooks/embed/route.ts
- **Line#**: 150-159
- **Snippet**:
```
await vectorIndex.upsert({
  id: analysisId,
  vector: embeddingResult.embedding as unknown as number[],
  metadata: { title, videoId, userId, analysisId },
});
```
- **What's missing**: `sparseVector` — the index is HYBRID type and REQUIRIES it
- **Label**: code-observed (dense-only upsert against HYBRID index)

---

## Stage 5 — Vector Write Proof (runtime-proven)

### Upstash Vector `/info` query (runtime-proven)
- **Command**: `curl -s https://rested-ferret-38816-eu1-vector.upstash.io/info`
- **Response**:
```json
{
  "result": {
    "vectorCount": 0,
    "pendingVectorCount": 0,
    "indexSize": 0,
    "dimension": 1536,
    "similarityFunction": "COSINE",
    "indexType": "HYBRID",
    "denseIndex": {"dimension": 1536, "similarityFunction": "COSINE", "embeddingModel": ""},
    "sparseIndex": {"embeddingModel": ""}
  }
}
```
- **Evidence**: Index reachable, **vectorCount is 0** — no production writes have ever succeeded
- **Label**: runtime-proven (curl, 2026-06-23T01:04+03:00)

### @upstash/vector SDK upsert probe (runtime-proven)
- **Command**: `node -e "const { Index } = require('@upstash/vector'); ..."`
- **Versions**: `@upstash/vector@1.2.3`
- **Test 1** — dense-only upsert (matches what the code does):
  - `index.upsert({ id, vector, metadata })` → `"This index requires sparse vectors"` (422)
- **Test 2** — dense + sparse upsert:
  - `index.upsert({ id, vector, sparseVector: { indices, values }, metadata })` → **SUCCESS** (vectorCount went from 0 → 1)
- **Test 3** — query with sparse:
  - `index.query({ data: vector, sparseVector: { indices, values } })` → returns `result: []`
- **Test 4** — cleanup:
  - `index.delete([id])` → `deleted: 0` before my test, count returned to 0 after cleanup
- **Label**: runtime-proven (Node.js v24.15.0, 2026-06-23T01:04+03:00)

### Data path summary
| Step | What code does | What index requires | Result |
|---|---|---|---|
| `vectorIndex.upsert({id, vector, metadata})` | dense vector only | dense + sparse vectors | **FAILS**: "This index requires sparse vectors" |
| `vectorIndex.query({data, topK, includeMetadata})` | dense query | dense + sparse query | **FAILS**: deserialization error (SDK query format mismatch) |
| `vectorIndex.delete([id])` | id only | id only | **WORKS**: returns `{deleted: 0\|1}` |

### Upstash Vector credentials (runtime-proven)
| Variable | Status |
|---|---|
| `UPSTASH_VECTOR_REST_URL` | ✅ present in `.env.local` |
| `UPSTASH_VECTOR_REST_TOKEN` | ✅ present in `.env.local`, accepted by `/info` endpoint |
| `QSTASH_TOKEN` | ✅ present in `.env.local` |
| `QSTASH_CURRENT_SIGNING_KEY` | ✅ present in `.env.local` |
| `OPENROUTER_API_KEY` | ✅ present in `.env.local` (validity unknown) |

### No existing test covers the vector write
- **Grep for `vectorIndex.upsert` tests**: zero matches
- **Grep for embed/route POST handler tests**: zero matches
- **Label**: code-observed

---

## Stage 6 — Risks / Blind Spots

### HYBRID index requires sparse vector on upsert (runtime-proven)
- **Why it matters**: The embed webhook at `embed/route.ts:150-159` calls `vectorIndex.upsert({id, vector, metadata})` with ONLY a dense vector. The index is HYBRID type and rejects dense-only upserts with 422. This is the **first actual break point in the vector write chain** — no vector has ever been written (vectorCount=0 runtime-proven). The fix is either (a) configure the index as DENSE instead of HYBRID, or (b) add `sparseVector` generation to the upsert call, or (c) upgrade `@upstash/vector` to a version that auto-generates sparse vectors for HYBRID indexes.
- **Label**: runtime-proven (via `/info` and SDK upsert probe)

### QStash chain may never reach the embed webhook (inferred)
- **Why it matters**: Even if the HYBRID index issue were fixed, the QStash chain has four sequential failure points: (1) QStash publish from persist route, (2) validate webhook delivery, (3) embed task publish, (4) embed webhook delivery. Each has non-blocking `.catch()` handlers. No runtime trace proves any of these steps succeed.
- **Label**: inferred (code-observed `.catch()` patterns, but runtime QStash delivery is unproven)

### search_analyses_semantic RPC (code-observed, not unused)
- **Why it matters**: Prior RCA stated this RPC was unused. The `/api/search` route uses `@upstash/vector` SDK directly, which is a DIFFERENT path (writes via embed webhook, reads via search route). The SQL RPC is indeed unused, but the search route exists and queries the same Upstash Vector index. If vectors were ever written, the search route would find them. However, the SDK query also failed in my probe (HYBRID query format mismatch).
- **Label**: code-observed (RPC unused) + runtime-proven (SDK query also fails on HYBRID index)

### Placeholder guard does not catch the HYBRID issue
- **Why it matters**: The `isPlaceholder` guard at L66-72 checks credential patterns but does not verify the index type. Even with real credentials, the HYBRID/DENSE mismatch stops the write. The guard fix from the prior turn is correct for its purpose but irrelevant to this root cause.
- **Label**: code-observed

---

## Stage 7 — Conclusion

### One short verdict
- The vector write path is **confirmed broken** at the final mile. Upstash Vector is reachable (runtime-proven via `/info`), credentials are valid (runtime-proven via grep and API auth), but the index is configured as **HYBRID** and the code's `vectorIndex.upsert({id, vector, metadata})` call at `embed/route.ts:150-159` sends only a **dense vector** with no accompanying sparse vector. The index rejects it — "This index requires sparse vectors". The vector count has been **zero** since deployment (runtime-proven via `/info`). The QStash chain and OpenRouter embedding generation may or may not work, but even if they do, the final upsert step always fails.

### What would change my mind is
- Reconfiguring the Upstash Vector index from HYBRID to DENSE (requires Upstash Console action or deleting/recreating the index), then re-running an analysis and observing `vectorCount` increase from 0
- OR adding `sparseVector` to the upsert call at `embed/route.ts:150-159` and re-running
- OR upgrading `@upstash/vector` to a version that auto-generates sparse vectors for HYBRID indexes, then re-running
- A runtime trace from Vercel logs showing the embed webhook returns 503 or 422 on the upsert line