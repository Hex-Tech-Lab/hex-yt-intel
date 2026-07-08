# Wave 2 Agent 2: 409 Digest Issue Root Cause Analysis

**Date**: 2026-07-08  
**Status**: COMPLETE  
**Agent ID**: adbcb6588329ee023  
**Branch**: `claude/system-re-audit-continue-l3fnel`

---

## Root Cause: Three-Layer Cascade

### Layer 1: atomicPersist Skips Empty Content
**File**: `worker/src/services/atomic-persist.ts:29`

```typescript
if (!options.hasContent()) return;  // SKIPS PERSIST if finalText.length === 0
```

**Problem**: When LLM stream produces no output, `finalText` remains empty. The `atomicPersist.flush()` call returns early **without calling `/api/analyses/persist`**. Analysis stays frozen in `billing_status='processing'` indefinitely.

**Impact**: Analysis row never receives markdown column. Reaches digest endpoint with `analysis_markdown = NULL`.

### Layer 2: Persist Schema Accepts Empty Markdown
**File**: `web/app/api/analyses/persist/route.ts:121`

```typescript
markdown: z.string(),  // No min length validation!
```

**Problem**: Schema accepts empty string `""` as valid markdown.

**Fix**: Add validation:
```typescript
markdown: z.string().min(1, 'Analysis content cannot be empty'),
```

### Layer 3: Digest Correctly Refuses Empty Content
**File**: `web/lib/usecases/GenerateExecutiveDigestUseCase.ts:57-64`

```typescript
if (markdown.length === 0) {
  return {
    type: 'error',
    code: 'ERR_NO_ANALYSIS_CONTENT',
    status: 409,
    message: 'This analysis has no content to summarize yet.',
  };
}
```

**This is intentional** (ADR 008: Chat Grounding Security Gate). The 409 is the correct response to empty markdown. The issue is upstream: analyses shouldn't reach this state.

---

## Why Stream Produces Empty Content

**Common Scenarios**:
1. LLM timeout or API error → returns empty
2. Missing transcript → can't analyze
3. Worker interrupted → state lost
4. Fallback model also fails → gives up

**Current Behavior**: `atomicPersist` silently swallows this failure and returns early. **No downstream notification**.

---

## Three Recommended Fixes

### Priority 1: Validate at Persist Endpoint (Immediate)
**Prevents** bad data from reaching database in first place.

```typescript
// web/app/api/analyses/persist/route.ts:118-134
const bodySchema = z.object({
  markdown: z.string()
    .min(1, 'Analysis content cannot be empty')  // ← ADD THIS
    .max(100000, 'Analysis exceeds maximum length'),
  // ... rest of schema
});
```

**Why**: Acts as security gate. Empty markdown rejected before UPDATE.

---

### Priority 2: Persist Failed Analysis State (Correct Design)
**File**: `worker/src/services/atomic-persist.ts:26-30`

**Current**:
```typescript
const persistFn = async (status: 'completed' | 'interrupted') => {
  if (!options.hasContent()) return;  // ← SKIPS IF EMPTY
```

**Changed to**:
```typescript
const persistFn = async (status: 'completed' | 'interrupted') => {
  // Remove the hasContent() guard
  // Let persist endpoint decide what to do
  // It will now receive empty markdown and reject it (Priority 1)
  // OR mark analysis_status = 'failed' for audit
```

**Why**: Ensures downstream visibility. Persist endpoint sees the failure and can respond appropriately.

---

### Priority 3: Fix Cache Key to Use Transcript (Architectural Correctness)
**Files**: `web/app/api/analyses/persist/route.ts:452, 568`

**Current**:
```typescript
const cacheKey = generateCacheKey('edge-stream', markdown, '5.1');  // Uses OUTPUT
```

**Should be**:
```typescript
const cacheKey = generateCacheKey('edge-stream', transcript, '5.1');  // Uses INPUT
```

**Why**: Cache key must be based on immutable input (transcript), not mutable output (markdown). Otherwise, same video analyzed twice produces different cache keys if markdown formatting differs.

**Implementation Note**: Requires worker to hash transcript and send with persist payload.

---

## Test Cases to Add

**File**: `web/lib/__tests__/executive-digest-usecase.test.ts` (after line 68)

```typescript
describe('GenerateExecutiveDigestUseCase - Edge Cases', () => {
  it('errors with 409 when analysis_markdown is null', async () => {
    const row = { ...baseRow, analysis_markdown: null };
    const { useCase } = makeDeps({ row });
    const res = await useCase.execute(baseParams);
    expect(res.type).toBe('error');
    expect(res.status).toBe(409);
    expect(res.code).toBe('ERR_NO_ANALYSIS_CONTENT');
  });

  it('errors with 409 when analysis_markdown is empty string', async () => {
    const row = { ...baseRow, analysis_markdown: '' };
    const { useCase } = makeDeps({ row });
    const res = await useCase.execute(baseParams);
    expect(res.type).toBe('error');
    expect(res.status).toBe(409);
    expect(res.code).toBe('ERR_NO_ANALYSIS_CONTENT');
  });

  it('persist endpoint rejects empty markdown with 400', async () => {
    const res = await fetch('/api/analyses/persist', {
      method: 'POST',
      body: JSON.stringify({
        analysisId: 'test-id',
        markdown: '',  // Empty!
        contentSig: 'signature',
      }),
    });
    expect(res.status).toBe(400);  // Bad request
    expect(await res.json()).toEqual({
      error: 'Analysis content cannot be empty',
    });
  });
});
```

---

## Verification Checklist

- [ ] Add min-length validation to persist schema
- [ ] Remove hasContent() guard from atomicPersist
- [ ] Test that empty markdown is rejected at API
- [ ] Test that failed analyses are marked status='failed'
- [ ] Add unit tests for edge cases above
- [ ] Update worker to include transcript hash in persist payload
- [ ] Fix cache key generation to use transcript hash
- [ ] Run E2E: create analysis → auto-restore → digest → should succeed (not 409)
- [ ] Run E2E: interrupt stream early → should mark failed, not 409 later

---

## Why This Matters (DDD+Hexagonal Context)

This cascade violates **Law #1: Pre-Query Cache Hit Circuit** and **Port Contract Integrity**:

1. **atomicPersist** (Service) doesn't fulfill its contract → should persist or clearly fail
2. **persist route** (Port) accepts invalid data → should validate at boundary
3. **digest UseCase** (Business Logic) receives inconsistent state → has to defend

**Result**: Three layers each defend, but Layer 1 silently breaks the contract. When fixed:
- Service persists or fails visibly
- Port rejects invalid input
- UseCase receives guaranteed valid state

This is the **essence of hexagonal + DDD**: contracts at every boundary.

---

## Estimated Implementation Time

- Priority 1 (schema): 5 minutes
- Priority 2 (guard removal): 10 minutes
- Priority 3 (cache key): 20 minutes
- Tests: 15 minutes
- **Total**: ~50 minutes

---

## Impact on Other Flows

- ✅ **Chat grounding**: Will now receive valid markdown
- ✅ **Search indexing**: No empty embeddings
- ✅ **PDF export**: No empty summaries
- ✅ **Global-graph**: No stale analysis nodes

---

**Next**: Commit this as Wave 2 Agent 2 findings. Schedule Priority 1 fix immediately for production safety.
