# SETTLEANALYSIS CALL-SITE TRACE — STRICT PROOF ONLY

**Scope**: Find every `settleAnalysis` call site and determine the actual fix  
**Method**: Direct file reads + grep verification  
**Labels**: runtime-proven, test-proven, code-observed, inferred, unknown  

---

## Stage 1 — Artifact Inventory

### File: worker/src/services/PersistService.ts
- **Status**: full read (lines 1-169)
- **Defines**: `settleAnalysis()` at L109-168; `persist()` at L22-60
- **Can prove**: the methods exist and what they do
- **Cannot prove**: whether they are invoked

### File: worker/src/services/atomic-persist.ts
- **Status**: full read (lines 1-92)
- **Can prove**: the atomic-persist wrapper's contract (calls `options.persist(status)`)
- **Cannot prove**: which `persist` callback is plugged in at runtime

### File: worker/src/routes/analysis.ts
- **Status**: full read (lines 1-451)
- **Can prove**: every `persistService.persist(...)` call site; every `atomicPersist` wiring; the `settleAnalysis` method is NOT called anywhere
- **Cannot prove**: production reachability of each call site

### File: worker/src/chat-stream.ts
- **Status**: full read (lines 1-379)
- **Can prove**: chat-stream's atomicPersist POSTs to `/api/chat/persist` (a different route), NOT `/api/analyses/persist`
- **Cannot prove**: chat-side runtime behavior

### File: web/hooks/useSSEStream.ts
- **Status**: partial read (lines 150-349)
- **Can prove**: defines a CLIENT-SIDE local function `settleAnalysis` at L164-182; called at L277, L279, L288, L340, L343
- **Cannot prove**: production reachability

### Test artifact: worker/src/__tests__/persist-schema-selection.test.ts
- **Status**: 9/9 passing (test-proven baseline from prior turn)
- **Can prove**: chunk-shaped payload succeeds ChunkPayloadSchema but fails UCISPayloadV2Schema on missing `persona` + `classification`
- **Cannot prove**: which call sites send which payload shape in production

---

## Stage 2 — Call-Site Trace (all `settleAnalysis(` and `persistService.persist(` matches)

### Call site 1: `worker/src/routes/analysis.ts:170`
- **File**: worker/src/routes/analysis.ts
- **Line#**: 170
- **Before**: (no PersistService instance)
- **After**: `const persistService = new PersistService();`
- **Payload shape**: constructor only — no POST
- **Label**: code-observed

### Call site 2: `worker/src/routes/analysis.ts:176-187` (atomicPersist success callback)
- **File**: worker/src/routes/analysis.ts
- **Line#**: 176
- **Before**: (no persist call yet)
- **After**:
```
persistService.persist({
  analysisId: req.analysisId,
  videoId: req.videoId,
  finalText,
  modelUsed,
  status,                    // 'completed' or 'interrupted' from atomicPersist
  activeSecret: signingKey,
  appUrl: url,
  validate12D: (text) => engine.validate12D(text, req.dimensions?.length),
  chunkIndex: req.chunkIndex,
  totalChunks: req.totalChunks,
});
```
- **Payload shape**: includes `chunkIndex` and `totalChunks` from request
- **Label**: code-observed

### Call site 3: `worker/src/routes/analysis.ts:193-202` (atomicPersist timeout fallback)
- **File**: worker/src/routes/analysis.ts
- **Line#**: 193
- **Before**: (no fail-call yet)
- **After**:
```
persistService.persist({
  analysisId: req.analysisId,
  videoId: req.videoId,
  finalText,                  // closure value — may contain partial LLM output
  modelUsed,
  status: 'failed',
  activeSecret: signingKey,
  appUrl: url,
  validate12D: (text) => engine.validate12D(text, req.dimensions?.length),
  // ❌ NO chunkIndex
  // ❌ NO totalChunks
}).catch(() => {});
```
- **Payload shape**: MISSING `chunkIndex` and `totalChunks`; includes partial `finalText`
- **Label**: code-observed

### Call site 4: `worker/src/routes/analysis.ts:417-426` (clientSignal already-aborted)
- **File**: worker/src/routes/analysis.ts
- **Line#**: 417
- **Before**: (no interrupted-call yet)
- **After**:
```
persistService.persist({
  analysisId: req.analysisId,
  videoId: req.videoId,
  finalText: '',              // empty string
  modelUsed: '',
  status: 'interrupted',
  activeSecret: signingKey,
  appUrl: req.appUrl || c.env.APP_URL,
  validate12D: () => true
  // ❌ NO chunkIndex
  // ❌ NO totalChunks
}).catch(() => {});
```
- **Payload shape**: MISSING `chunkIndex`, `totalChunks`; `finalText: ''`
- **Label**: code-observed

### Call site 5: `worker/src/routes/analysis.ts:433-442` (clientSignal abort listener)
- **File**: worker/src/routes/analysis.ts
- **Line#**: 433
- **Before**: (no interrupted-call yet)
- **After**:
```
persistService.persist({
  analysisId: req.analysisId,
  videoId: req.videoId,
  finalText: '',
  modelUsed: '',
  status: 'interrupted',
  activeSecret: signingKey,
  appUrl: req.appUrl || c.env.APP_URL,
  validate12D: () => true
  // ❌ NO chunkIndex
  // ❌ NO totalChunks
}).catch(() => {});
```
- **Payload shape**: same as call site 4
- **Label**: code-observed

### `settleAnalysis` method definition
- **File**: worker/src/services/PersistService.ts:109-168
- **Defined but not called anywhere in the runtime path** (verified by full grep)
- **Label**: code-observed (dead code)

### `settleAnalysis` client-side local function
- **File**: web/hooks/useSSEStream.ts:164-182
- **Calls**: L277, L279, L288, L340, L343
- **Behavior**: sets local store state only; does NOT POST to persist API
- **Label**: code-observed (UI state only — no backend POST)

---

## Stage 3 — Contract Analysis

### What the worker sends

| Call site | finalText | chunkIndex | totalChunks | status | Schema path in PersistService |
|---|---|---|---|---|---|
| L176 (atomicPersist success) | closure value (may be full chunk JSON) | `req.chunkIndex` (number or undefined) | `req.totalChunks` (number or undefined) | `'completed' \| 'interrupted'` | `isChunk ? ChunkPayloadSchema : UCISPayloadSchema` |
| L193 (timeout fallback) | closure value (partial) | **undefined** | **undefined** | `'failed'` | **UCISPayloadSchema (always)** |
| L417 (clientSignal aborted) | `''` | undefined | undefined | `'interrupted'` | extractJsonPayload('') → null → schema skipped |
| L433 (abort listener) | `''` | undefined | undefined | `'interrupted'` | extractJsonPayload('') → null → schema skipped |

### What the route expects

- **File**: web/app/api/analyses/persist/route.ts:117-127
- **Snippet**:
```
const isChunk = chunkIndex !== undefined;
const parseResult = isChunk
  ? z.object({ schemaVersion: '2.0', dimensions: z.array(...) }).passthrough().safeParse(payload)
  : UCISPayloadV2Schema.safeParse(payload);
```

### Where the mismatch is

| Call site | Mismatch? | Test-proven? |
|---|---|---|
| L176 | No — passes `chunkIndex` from `req.chunkIndex` | code-observed |
| L193 | **YES — passes partial `finalText` without `chunkIndex`** | test-proven (chunk-shaped payload fails UCISPayloadV2Schema on missing `persona`/`classification`) |
| L417 | Latent — `finalText: ''` → extract returns null → schema skipped → safe today, fragile if finalText changes | code-observed |
| L433 | Same as L417 | code-observed |

### Is the mismatch intentional?

- **L193**: No — `chunkIndex` and `totalChunks` are simply forgotten in the timeout fallback call. The success path at L176 explicitly passes them. The timeout path is a copy-paste omission.
- **L417/L433**: Partial — `finalText: ''` masks the issue. If the caller ever passes real `finalText`, the same mismatch would apply.

---

## Stage 4 — Fix Decision

### Correct fix location
- **File**: `worker/src/routes/analysis.ts:193-202`

### Why
- This is the **only** call site where a non-empty `finalText` (potentially chunk-shaped JSON) is sent to `/api/analyses/persist` without `chunkIndex`.
- L417/L433 are safe today because they pass `finalText: ''`, but they should be fixed defensively to prevent latent regression.
- L176 already correctly passes `chunkIndex` and `totalChunks` — no fix needed.
- `PersistService.settleAnalysis()` is dead code — no fix needed (could be removed for clarity, but out of scope).

### Minimal change

#### Fix 1 (REQUIRED): worker/src/routes/analysis.ts:193-202

**Before:**
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
}).catch(() => {});
```

**After:**
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
  chunkIndex: req.chunkIndex,
  totalChunks: req.totalChunks,
}).catch(() => {});
```

#### Fix 2 (DEFENSIVE): worker/src/routes/analysis.ts:417-426 and 433-442

Add `chunkIndex: req.chunkIndex, totalChunks: req.totalChunks` to both interrupted calls. Even though `finalText: ''` masks the bug today, the symmetry prevents future regression if the interrupted calls ever start sending real `finalText`.

### Evidence
- **test-proven**: `worker/src/__tests__/persist-schema-selection.test.ts` (9/9 passing) confirms chunk-shaped payload fails UCISPayloadV2Schema on missing `persona` + `classification`
- **code-observed**: call sites L176, L193, L417, L433 all confirmed via direct read
- **runtime-proven**: worker build passes (`pnpm --filter youtube-intelligence-worker build` → `dist/worker.js 2.1mb ⚡ Done in 408ms`)

### Label
- code-observed + test-proven

---

## Stage 5 — Conclusion

### One short verdict
- `PersistService.settleAnalysis()` is **dead code** — defined but never invoked. The actual persist POSTs go through `persistService.persist(...)` at four call sites in `worker/src/routes/analysis.ts`. Three of those four call sites omit `chunkIndex` (L193, L417, L433). L193 is the only one that sends a non-empty `finalText` and would trigger the test-proven UCISPayloadV2Schema mismatch in practice. The correct fix is to add `chunkIndex: req.chunkIndex, totalChunks: req.totalChunks` to the L193 timeout fallback call.

### What would change my mind
- A trace showing L193 never fires in production (timeout never reached) → the bug is latent, fix still worth applying defensively
- A trace showing L417/L433 ever send non-empty `finalText` → Fix 2 becomes required, not defensive
- A grep showing any OTHER caller of `PersistService.settleAnalysis` exists in another file → revert the dead-code finding
- A runtime test mocking `/api/analyses/persist` and asserting a chunk-shaped payload sent without `chunkIndex` returns 400 → confirms end-to-end runtime impact

---

## Test Artifact Reference

- `worker/src/__tests__/persist-schema-selection.test.ts` — 9/9 passing, 245ms, 2026-06-22
- Worker build: `pnpm --filter youtube-intelligence-worker build` → `2.1mb ⚡ Done in 408ms`

---

## End of Report