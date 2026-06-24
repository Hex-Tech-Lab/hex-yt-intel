### Stage 1 — Artifact inventory

- **File**: `worker/src/routes/analysis.ts`
- **Status**: opened at lines 189-204
- **What it can prove**: the timeout fallback POST body at L202-203
- **What it cannot prove**: whether the timeout path is reached in production

- **File**: `web/app/api/analyses/persist/route.ts`
- **Status**: opened at lines 116-127
- **What it can prove**: the route schema selector is unchanged
- **What it cannot prove**: runtime execution of the selector

- **File**: `worker/src/__tests__/persist-schema-selection.test.ts`
- **Status**: 9/9 passing
- **What it can prove**: chunk-shaped payload succeeds under ChunkPayloadSchema, fails under UCISPayloadV2Schema
- **What it cannot prove**: end-to-end network call

### Stage 2 — Timeout fallback payload

- **Before**: `chunkIndex` and `totalChunks` were absent from the timeout fallback POST body (L202-203 did not exist)
- **After**: `chunkIndex: req.chunkIndex` at L202, `totalChunks: req.totalChunks` at L203
- **Line#**: 202-203
- **Snippet**:
```
            chunkIndex: req.chunkIndex,
            totalChunks: req.totalChunks,
```
- **Label**: code-observed

### Stage 3 — Route contract check

- **What the worker sends**: when `chunkIndex` is passed (now present at L202), `PersistService.persist()` serializes it into `JSON.stringify({..., chunkIndex: params.chunkIndex, ...})`. If `chunkIndex` is a number, JSON includes the key; if `undefined`, JSON omits it.
- **What the route expects**: route.ts:117 checks `const isChunk = chunkIndex !== undefined;` — when `chunkIndex` is a number in the POST body, `isChunk` is `true` → selects ChunkPayloadSchema (L119-126). When absent, selects UCISPayloadV2Schema (L127)
- **Where the selection happens**: `web/app/api/analyses/persist/route.ts:117` — unchanged
- **Label**: code-observed + test-proven

### Stage 4 — Verification

- **what was checked**: timeout fallback POST body (L202-203), route schema selector (L117-127), test run
- **what passed**: timeout fallback now includes `chunkIndex: req.chunkIndex, totalChunks: req.totalChunks` (code-observed); route selector unchanged at L117-127 (code-observed); `persist-schema-selection.test.ts` 9/9 passed (test-proven); no other fallback path changed (code-observed)
- **what remains unknown**: whether the 15s timeout in the atomicPersist race ever fires in production (runtime-proven would require a production trace)

### Stage 5 — Conclusion

- **One short verdict**: The timeout fallback POST at `worker/src/routes/analysis.ts:193-204` now carries `chunkIndex: req.chunkIndex` and `totalChunks: req.totalChunks`, matching the success path. The route schema selector is unchanged. The test-proven UCISPayloadV2Schema mismatch is resolved for this call site.
- **What would change my mind**: A production trace showing the timeout fallback path never fires, making the fix unnecessary but harmless.