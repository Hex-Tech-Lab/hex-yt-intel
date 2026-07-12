# Search Enrichment Observability (Phase 1 — Launch Safe)

**Date**: 2026-07-12  
**Status**: ✅ Implemented (Phase 1)  
**Related ADR**: ADR 011 (LLM Model Routing Policy & Fallback Cascade Strategy)  
**PR**: (This PR)

---

## 1. Executive Summary

This document outlines the Phase 1 observability implementation for search result enrichment failures. The goal is to provide **visibility into enrichment health** without changing the API contract or user-facing behavior.

**Key guarantees:**
- ✅ Zero API breaking changes
- ✅ Silent failures still silently fail (user gets partial results)
- ✅ New Sentry observability tracks failure rates and root causes
- ✅ Future Phase 2 can add explicit error visibility without rework

---

## 2. Current Behavior (Pre-Implementation)

### Enrichment Pipeline

```
Vector Search (Upstash) → Array of 5 result objects
    ↓
Fetch Full Data (Supabase) for each result in parallel
    ↓
    On error: return null (silent)
    ↓
Filter out nulls → return validResults
```

**Problem**: Individual enrichment errors are logged to Sentry (line 202-205), but there's **no aggregate visibility** into:
- How many results failed vs succeeded
- What percentage of enrichment requests are failing
- Whether enrichment is degrading over time

---

## 3. Phase 1 Implementation

### 3.1 Sentry Message Trigger

**Location**: `/web/app/api/search/route.ts` (lines 216-244)

When enrichment produces **any failures** (failureCount > 0):

```typescript
if (failureCount > 0) {
  Sentry.captureMessage('Search: Partial enrichment failure', {
    level: 'warning',
    tags: {
      operation: 'search-enrichment',
      successCount: String(successCount),
      failureCount: String(failureCount),
      successRatio: String(Math.round(successRatio)),
    },
    contexts: {
      search: {
        query: query.substring(0, 100),
        topK,
        totalAttempted: enrichedResults.length,
        successCount,
        failureCount,
        successRatio: Math.round(successRatio * 100) / 100,
      },
      api: {
        requestId,
        userId,
        endpoint: '/api/search',
      },
    },
  });
}
```

### 3.2 Sentry Tags (Queryable Dimensions)

| Tag | Example | Purpose |
|---|---|---|
| `operation` | `search-enrichment` | Alerts & dashboards filter by operation |
| `successCount` | `4` | Number of successful enrichments |
| `failureCount` | `1` | Number of failed enrichments |
| `successRatio` | `80` | Percentage success (0-100) |

### 3.3 Sentry Contexts (Rich Data for Debugging)

**Context**: `search`
- `query` (first 100 chars)
- `topK` (requested result count)
- `totalAttempted` (vector search returned N results)
- `successCount` / `failureCount`
- `successRatio` (0-100%, decimal)

**Context**: `api`
- `requestId` (UUID for tracing)
- `userId` (scoped issue tracking)
- `endpoint` (`/api/search`)

---

## 4. Test Scenarios

### Scenario A: Perfect Enrichment
```
Vector Search: 5 results
Enrichment Attempts: 5
Successful: 5
Failed: 0
Expected Sentry: NO MESSAGE (no trigger)
Expected Response: 200 OK, 5 results
```

### Scenario B: Partial Enrichment Failure
```
Vector Search: 5 results
Enrichment Attempts: 5
Successful: 3
Failed: 2
Expected Sentry: ✅ 'Search: Partial enrichment failure'
  - tags: { successCount: '3', failureCount: '2', successRatio: '60' }
  - context.search.successRatio: 60.0
Expected Response: 200 OK, 3 results
```

### Scenario C: Complete Enrichment Failure
```
Vector Search: 5 results
Enrichment Attempts: 5
Successful: 0
Failed: 5
Expected Sentry: ✅ 'Search: Partial enrichment failure'
  - tags: { successCount: '0', failureCount: '5', successRatio: '0' }
  - context.search.successRatio: 0.0
Expected Response: 200 OK, [] (empty results)
```

### Scenario D: Zero Vector Results
```
Vector Search: 0 results
Enrichment Attempts: 0
Successful: 0
Failed: 0
Expected Sentry: NO MESSAGE
Expected Response: 200 OK, [] (empty results)
```

---

## 5. Monitoring & Alerting Recommendations

### 5.1 Sentry Dashboard Queries

**Query 1: Daily Enrichment Failure Rate**
```
event.transaction: "POST /api/search"
message: "Search: Partial enrichment failure"
```
**Alert Threshold**: > 10% daily failures
**Action**: Investigate database connectivity, permissions, timeout issues

**Query 2: Zero Success Enrichments**
```
event.context.search.successCount: "0"
```
**Alert Threshold**: > 1 per hour
**Action**: P1 incident — enrichment service is down

**Query 3: User-Scoped Failures**
```
event.context.api.userId: "<user_id>"
message: "Search: Partial enrichment failure"
```
**Action**: Diagnose user-specific permission or quota issues

### 5.2 Grafana/CloudWatch Metrics (Future)

Once Phase 2 is implemented, export these metrics:
- `search_enrichment_success_ratio` (gauge, 0-100)
- `search_enrichment_failures_total` (counter, cumulative)
- `search_enrichment_latency_p95` (histogram, milliseconds)

---

## 6. Troubleshooting Guide

### Issue: High Enrichment Failure Rate (> 10%)

**Common Causes**:

1. **Database Connection Limit Exceeded**
   - Check Supabase connection pool status
   - Look for "too many connections" errors in Sentry `context.search` 
   - Temporary: Reduce `topK` parameter in search requests

2. **Row-Level Security (RLS) Policy Issue**
   - Verify `analyses` table RLS policies allow authenticated users to read
   - Check `verifyResourceOwnership` has correct user_id matching

3. **Network Timeout**
   - Check `error.retryable = true` in Sentry
   - Increase Supabase connection timeout (currently implicit)
   - Monitor Vercel function duration (should be < 25s for search)

4. **Supabase Service Degradation**
   - Check [status.supabase.com](https://status.supabase.com)
   - Look for `error: categorizeSearchError(err, 'database_fetch')` errors
   - Temporary: Route to backup search index if available

### Issue: Enrichment Failures Only for Specific User

**Diagnostics**:
- Query Sentry: `event.context.api.userId: "<user_id>"`
- Check if user has proper billing tier (quota enforcement in `guardTraffic`)
- Verify user's analyses exist in vector index (may be missing embeddings)

### Issue: No Enrichment Failures Recorded

**Possible Scenarios**:
1. ✅ Enrichment is working perfectly (no trigger, no message)
2. ❌ Sentry is not initialized (check `SENTRY_DSN` env var)
3. ❌ Rate limit is suppressing Sentry messages

---

## 7. API Contract (Unchanged)

**Request**:
```json
POST /api/search
{
  "query": "machine learning",
  "topK": 5
}
```

**Response** (Unchanged from prior behavior):
```json
200 OK
{
  "results": [
    {
      "analysisId": "abc123",
      "title": "ML Fundamentals",
      "videoId": "dQw4w9WgXcQ",
      "excerpt": "Machine learning is...",
      "score": 0.92,
      "createdAt": "2026-07-01T10:00:00Z"
    },
    ...
  ],
  "count": 3,
  "query": "machine learning",
  "tier": "pro"
}
```

**Status Code**: Always `200 OK`, even if some enrichments fail
**Failure Behavior**: Silent (failed results omitted, successful ones included)

---

## 8. Phase 2 Future Improvements (Wave D)

### 8.1 Optional Client Visibility

```typescript
// Future: Phase 2
Sentry.captureMessage('Search: Enrichment degraded', {
  tags: { operation: 'search-enrichment', mode: 'client-visible' },
  ...
});

// Optionally return partial results with metadata
{
  "results": [ /* 3 successful */ ],
  "count": 3,
  "partialResults": {
    "attempted": 5,
    "succeeded": 3,
    "failed": 2
  },
  "query": "...",
  "tier": "..."
}
```

### 8.2 Retry Logic

```typescript
// Phase 2: Implement exponential backoff retry
// - On timeout errors: retry 1x (immediately)
// - On permission errors: skip (don't retry)
// - On unknown errors: retry 1x (with 500ms delay)
```

### 8.3 Observability API

```typescript
// Phase 2: New internal endpoint for ops/support
GET /api/admin/search-health
Response:
{
  "enrichmentSuccessRatio": 95.2,
  "last24hFailures": 127,
  "slowestEnrichmentMs": 1850,
  "recentFailedAnalysisIds": ["id1", "id2"]
}
```

---

## 9. Deployment Checklist

- [x] Sentry observability added to search route
- [x] Tags and contexts defined for queryable monitoring
- [x] Documentation complete (this file)
- [x] Test scenarios documented
- [x] No API contract changes
- [x] Type-check passes
- [x] Lint passes (pre-existing issues unrelated)
- [x] Ready for merge (Phase 1 — launch safe)

---

## 10. References

- **Sentry Docs**: https://docs.sentry.io/platforms/javascript/enriching-events/
- **ADR 005**: Hybrid Edge Architecture (Vercel/Cloudflare)
- **ADR 011**: LLM Model Routing Policy & Fallback Cascade Strategy
- **PR**: (This PR)
