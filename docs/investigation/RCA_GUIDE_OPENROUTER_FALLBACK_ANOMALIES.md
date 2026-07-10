# RCA Investigation Guide: OpenRouter Cascade Fallback Anomalies

**Purpose**: Root-cause analysis for "why 2-level fallback occurred" incidents  
**Last Updated**: 2026-07-10  
**Status**: Investigation plan / tooling guide

---

## 1. The Problem

User observations:
- Some analyses triggered cascade fallback to a tertiary model (Sonnet 4.6) when Haiku 4.5 should have succeeded
- Expected: 5 streams use Haiku 4.5 (primary), maybe 1 fallback to gpt-oss / Gemini (digest)
- Observed: 2-level fallback suggests Haiku 4.5 failed + Sonnet 4.6 fallback was used
- **Root cause unknown**: Could be transient provider issue, code bug, or workflow issue

## 2. Cascade Structure (Current)

**ANALYSIS_CASCADE**:
1. Claude Haiku 4.5 (primary, $0.0015/call)
2. Claude Haiku 4.5 Alternate Route (provider failover)
3. Claude Sonnet 4.6:nitro (expensive fallback, $0.003/call)

**CHAT_CASCADE** (Dimension 0 only):
1. gpt-oss-120b Groq ($0.00015)
2. gpt-oss-120b Google Vertex ($0.00015)
3. gpt-oss-120b Cerebras ($0.00035)
4. Gemini 3.1 Flash Lite ($0.00025)
5. Gemini 2.0 Flash ($0.00015)

**Per-stream fallback**: Each of the 5 parallel dimension streams independently attempts models.  
**Idempotent**: If a stream fails after any fallback, the persisted analysis captures which model was used.

## 3. Data Sources for RCA

### 3.1 OpenRouter Activity Logs
**Location**: OpenRouter dashboard → Activity / Usage logs  
**What to look for**:
- Timestamp of failed Haiku 4.5 attempts
- Error code (402 = quota/rate limit, 429 = overload, timeout, refusal)
- Which provider returned the error (Anthropic, Amazon, Google)
- Cost spike indicating Sonnet 4.6 was invoked

**Query**: Filter by date range of anomaly, sort by cost descending to find Sonnet 4.6 calls.

### 3.2 Application Logs (Supabase / Cloud Logging)
**Location**: `web/app/api/analyses/persist/route.ts` + worker logs  
**Search for**:
```
[LLMCascade] Model claude-haiku-4.5 failed
[LLMCascade] Attempting model: claude-sonnet-4.6:nitro
[cache] generateCacheKey called with empty transcriptHash
[analyses/persist] Missing transcriptHash for cache key
```

**If log message NOT found**: Cascade decisions are not being logged. This is the **observability gap**.

### 3.3 Analysis Record in Supabase
**Table**: `analyses`  
**Relevant columns**:
- `id` (analysisId)
- `model_used` — which model completed the synthesis
- `analysis_payload` — the raw JSON (contains dimension data)
- `created_at` — timestamp of analysis
- `status` — completion status

**If `model_used` field is missing**: DB schema doesn't track model selection. Need migration.

### 3.4 Stream Duration Telemetry (Not Yet Implemented)
**Proposed but missing**:
- Per-stream start/end times
- Per-stream model used
- Per-stream fallback reason

## 4. Diagnostic Workflow

### Step 1: Identify Anomalous Analyses
Find analyses with Sonnet 4.6 cost in OpenRouter logs.

```sql
-- Pseudo-query for Supabase:
SELECT id, model_used, created_at, analysis_payload
FROM analyses
WHERE created_at BETWEEN '2026-07-01' AND '2026-07-10'
  AND model_used LIKE '%sonnet-4.6%'
ORDER BY created_at DESC;
```

### Step 2: Correlate with Application Logs
For each analysis with Sonnet 4.6:
1. Note the `created_at` timestamp
2. Search application logs for that timestamp ± 2 minutes
3. Look for `[LLMCascade]` entries with `fallback` or `failed`
4. Extract: which stream failed, which model, which error reason

**Expected pattern**:
```
[LLMCascade] Attempting model: claude-haiku-4.5
[LLMCascade] Model claude-haiku-4.5 failed. Classified: ERR_TIMEOUT
[LLMCascade] Attempting model: claude-haiku-4.5 (Alternate Route)
[LLMCascade] Model claude-haiku-4.5 (Alternate Route) failed. Classified: ERR_MODEL_OVERLOAD
[LLMCascade] Attempting model: claude-sonnet-4.6:nitro
[LLMCascade] Model claude-sonnet-4.6:nitro started successfully. Committed.
```

### Step 3: Check OpenRouter Provider Error Details
Go to OpenRouter Activity log for the exact timestamp (±10 sec) of the Haiku failure.

**Check**:
- HTTP status: 402, 429, 500, 503, or timeout?
- Provider involved: Anthropic, Amazon Bedrock, or Google Vertex?
- Message: Rate limit? Quota? Overload? Regional unavailability?
- Was provider route specified? (e.g., `allow_fallbacks: false`)

### Step 4: Evaluate Hypotheses

#### Hypothesis A: Provider Quota Exhaustion (402)
**Signal**: Haiku 4.5 returns 402 Payment Required from Anthropic, cascade tries fallback.  
**RCA**: OpenRouter's Anthropic tier hit quota; alternate route + Sonnet 4.6 succeeded.  
**Fix**: Monitor OpenRouter quota; may need to add credit or adjust burst allowance.  
**Code issue**: No, this is expected fallback behavior.

#### Hypothesis B: Provider Overload (429 / 503)
**Signal**: Haiku 4.5 returns 429 Too Many Requests or 503 Service Unavailable.  
**RCA**: Haiku tier temporarily overloaded; fallback to Sonnet 4.6 was necessary.  
**Fix**: Implement circuit breaker or backoff; retry later. Accept rare fallback.  
**Code issue**: Possibly. If cascading immediately instead of backing off, consider adding retry delay.

#### Hypothesis C: Connection Timeout
**Signal**: LLMCascade times out at 3s (handshake) or 25s (streaming) before Haiku produces tokens.  
**RCA**: Transient network issue, provider slow, or OpenRouter routing delay.  
**Fix**: Nothing. Timeout fallback is correct behavior.  
**Code issue**: No.

#### Hypothesis D: Model Refusal / Safety Block
**Signal**: Haiku 4.5 starts streaming but returns early refusal (e.g., "I can't analyze this").  
**RCA**: Prompt or content triggered safety filter; fallback to Sonnet 4.6 which accepted it.  
**Fix**: Check if prompt needs hardening; may indicate adversarial or edge-case input.  
**Code issue**: Maybe. Check `isRefusalOrChatter()` detection in `LLMCascade.ts`.

#### Hypothesis E: Our Code / Workflow Issue (Cache, Validation, etc.)
**Signal**: Haiku 4.5 call succeeds but result is rejected by validation; fallback used anyway.  
**RCA**: Cache miss causing double-call; invalid JSON forcing retry; schema mismatch.  
**Fix**: Debug validation logic; check if cache keys are being computed correctly.  
**Code issue**: Likely. Check cache.ts + validation logic.

## 5. Recommended Logs to Add (For Future Incidents)

### 5.1 In `worker/src/services/LLMCascade.ts`
```typescript
// Before each model attempt:
console.log('[LLMCascade] Stream', streamId, 'attempting model', model, 'tier', tierIndex);

// On fallback:
console.log('[LLMCascade] Stream', streamId, 'fallback:', {
  from: previousModel,
  to: nextModel,
  reason: classifiedError,
  rawError: truncatedErrorMsg,
  timestamp: new Date().toISOString()
});

// On success:
console.log('[LLMCascade] Stream', streamId, 'succeeded with model', model, {
  durationMs,
  tokenCount: finalText.length
});
```

### 5.2 In `web/app/api/analyses/persist/route.ts`
```typescript
console.log('[analyses/persist] Caching analysis', {
  analysisId,
  modelUsed: model,
  cascadeDepth: streamFallbackCount,
  cacheKey,
  timestamp
});
```

## 6. Diagnosis Checklist for Next Incident

- [ ] Find analysis ID with Sonnet 4.6 cost from OpenRouter logs
- [ ] Note creation timestamp
- [ ] Search app logs for LLMCascade messages around that time
- [ ] Extract fallback reason (timeout vs. 402 vs. refusal vs. other)
- [ ] Check OpenRouter Activity log for HTTP status + provider
- [ ] Correlate with DB: is model_used field set correctly?
- [ ] Check cache.ts: was empty-hash fallback triggered? (generateCacheKey should now throw)
- [ ] If hypothesis E (our code): trace validation logic
- [ ] Document findings in Sentry incident summary

## 7. Current Action Items

1. **Add structured logging** (proposed in ADR 011 §6)
   - Link stream ID → model → fallback reason throughout the cascade
   - Makes future RCA 10x faster

2. **Persist model metadata** in analysis record
   - `model_used`, `cascade_depth`, `fallback_reason`
   - Enables Supabase queries for anomalies

3. **Monitor OpenRouter quota**
   - Set alerts on 402 error rate
   - Alert if Sonnet 4.6 is invoked >2x per day (indicates systemic issue)

4. **Validate cache contract** (already done in this PR)
   - Cache.ts now throws on empty hash (prevents cache miss → double-call scenario)

---

**Next Step**: When you have an analysis with unexpected Sonnet 4.6 cost, run this checklist. First incident will reveal the pattern; then we can either fix code, adjust configuration, or document as expected behavior.
