# Observability & Monitoring Guide

**Last Updated**: 2026-05-14  
**Status**: Production-Ready ✅

This document explains how to monitor, debug, and observe hex-yt-intel in production.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Components](#components)
3. [Dashboards](#dashboards)
4. [Logs & Events](#logs--events)
5. [Metrics](#metrics)
6. [Alerts](#alerts)
7. [Troubleshooting](#troubleshooting)
8. [Emergency Runbook](#emergency-runbook)

---

## Architecture Overview

Observability in hex-yt-intel is built on three pillars:

### 1. **Sentry** (Error Tracking & Performance Monitoring)
- Captures all unhandled exceptions
- Tracks performance metrics (API latency, database queries)
- Session replay for debugging user issues
- Release tracking for version-based error grouping

### 2. **Supabase** (Data Storage & Usage Logs)
- Stores user activity in `usage_logs` table
- Tracks analyses, searches, embedding costs
- Supports custom metric aggregation
- Row-level security (RLS) for data isolation

### 3. **Vercel** (Infrastructure Logs)
- Deployment logs and build errors
- Edge function logs (if using Edge Middleware)
- Real-time request monitoring
- Performance metrics (TTFB, FCP, etc.)

---

## Components

### Health Check Endpoint
**Endpoint**: `GET /api/health`

Returns status of all critical components.

```bash
curl https://hex-yt-intel.vercel.app/api/health | jq
```

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2026-05-14T10:30:00Z",
  "components": {
    "database": { "status": "ok", "latency": 45 },
    "sentry": { "status": "ok", "dsn_configured": true },
    "worker": { "status": "ok", "latency": 120 }
  },
  "uptime": 3600,
  "version": "1.0.0"
}
```

**Status Codes**:
- `200` → Healthy or Degraded (at least core services working)
- `503` → Unhealthy (critical services down)

### Monitoring Utilities
**Location**: `web/lib/monitoring/`

Key files:
- `sentry-utils.ts` - Sentry integration helpers
- `metrics.ts` - Business metric tracking

**Usage**:
```typescript
import { trackAPIRequest, setUserContext, addBreadcrumb } from '@/lib/monitoring/sentry-utils';
import { trackAnalysisCreated } from '@/lib/monitoring/metrics';

// Track API request with auto-timing
await trackAPIRequest('POST', '/api/analyses', async () => {
  // Your code here
});

// Set user context for error tracking
setUserContext(userId, email, tier);

// Track metrics
trackAnalysisCreated(userId, 'pro', latencyMs);
```

---

## Dashboards

### 1. Admin Dashboard
**URL**: `https://hex-yt-intel.vercel.app/admin/dashboards`

Real-time observability dashboard showing:
- System health status
- Component latencies
- Key metrics (analyses created, searches run, active users)
- Performance stats (API latency, error rate, uptime)
- Links to external monitoring tools

**Access**: Requires authentication (TODO: Add admin role check)

### 2. Sentry Dashboard
**URL**: `https://sentry.io/organizations/hex-tech-lab/projects/`

Shows:
- **Issues**: Grouped errors sorted by frequency and recency
- **Performance**: Slowest transactions, bottlenecks
- **Releases**: Track errors by code version
- **User Feedback**: Session replays, affected users

### 3. Vercel Analytics
**URL**: `https://vercel.com/hex-tech-lab/hex-yt-intel/monitoring`

Shows:
- Real-time request logs
- Edge function performance
- Deployment history
- Build logs and errors

### 4. Supabase Analytics
**URL**: `https://app.supabase.com/project/_/analytics`

Shows:
- Database query performance
- Storage usage
- Authentication metrics

---

## Breadcrumbs & Events

### Breadcrumb Tracking
All key operations emit structured breadcrumbs for debugging. Breadcrumbs appear in Sentry error details as a timeline of events leading up to the error.

**Available Breadcrumb Categories**:
- `operation` - Generic operation (default)
- `database` - Database query (SELECT, INSERT, UPDATE, DELETE)
- `api` - API request/response
- `external_service` - Third-party service call (Worker, OpenRouter, OpenAI)
- `rate_limiting` - Rate limit events
- `quota` - Quota enforcement
- `validation` - Input validation
- `security` - Security events (webhook signature, auth failures)
- `billing` - Billing/Stripe events
- `metric` - Custom metric tracking

**Example Breadcrumb Usage**:
```typescript
import { addBreadcrumb, trackAPIRequest, trackDatabaseQuery, trackExternalCall } from '@/lib/monitoring/sentry-utils';

// Track operation with context
addBreadcrumb('Video ID extracted', { videoId, url });

// Track API request with auto-timing and error capture
await trackAPIRequest('POST', '/api/analyses', async () => {
  // Your async code
});

// Track database query with timing and error context
await trackDatabaseQuery('insert', 'analyses', async () => {
  // Your Supabase query
}, { userId, videoId });

// Track external service call with timing
await trackExternalCall('openai', 'text-embedding-3-small', async () => {
  // Your external API call
}, { context: 'data' });
```

### Log Format
All logs follow a structured JSON format:

```json
{
  "timestamp": "2026-05-14T10:30:00Z",
  "level": "info|warning|error",
  "service": "api|worker|database",
  "endpoint": "/api/analyses",
  "user_id": "user_123",
  "trace_id": "abc123def456",
  "status_code": 200,
  "duration_ms": 245,
  "message": "Analysis created successfully"
}
```

### Log Levels
- **DEBUG**: Development info (disabled in production)
- **INFO**: Normal operation (user actions, successful requests)
- **WARNING**: Degraded performance (slow queries, near quota)
- **ERROR**: Request failures (500 errors, database errors)
- **FATAL**: System-critical (database down, worker unreachable)

### Accessing Logs

**Sentry Issues**:
```
Sentry → Organization → hex-tech-lab → Projects → hex-yt-intel → Issues
```

**Vercel Logs**:
```
Vercel → Project → hex-yt-intel → Deployments → [Select Deploy] → Logs
```

**Supabase Logs**:
```
Supabase → Project → SQL Editor → SELECT * FROM usage_logs WHERE created_at > NOW() - INTERVAL 24 HOURS;
```

---

## Metrics

### Tracked Metrics

#### API Metrics
- `api_request` - Total API calls (count)
- `api_latency` - Response time (ms)
- `api_error_4xx` - Client errors (count)
- `api_error_5xx` - Server errors (count)

#### Business Metrics
- `analysis_created` - Analyses generated (count)
- `analysis_latency` - Time to generate analysis (ms)
- `search_executed` - Searches performed (count)
- `search_results` - Results returned (count)

#### Infrastructure Metrics
- `embedding_generated` - Embeddings created (count)
- `embedding_tokens` - Tokens used (count)
- `embedding_cost` - Cost in USD (amount)
- `external_call` - Third-party service calls (count)
- `external_latency` - Third-party latency (ms)

#### Billing Metrics
- `stripe_transaction` - Payment processed (count)
- `stripe_amount` - Transaction amount (currency)

### Querying Metrics

**Sentry Custom Metrics**:
```
Sentry → Dashboards → Create Widget
Use: event.measurements.* for custom metrics
```

**Supabase Metrics**:
```sql
-- Average API latency by endpoint (last 24h)
SELECT 
  metadata->>'endpoint' as endpoint,
  AVG(CAST(metadata->>'latency_ms' AS NUMERIC)) as avg_latency
FROM usage_logs
WHERE created_at > NOW() - INTERVAL 24 HOURS
  AND action = 'api_request'
GROUP BY metadata->>'endpoint'
ORDER BY avg_latency DESC;

-- Total analyses created by tier
SELECT 
  metadata->>'tier' as tier,
  COUNT(*) as total
FROM usage_logs
WHERE action = 'analysis_created'
GROUP BY metadata->>'tier';
```

---

## Alerts

### Alert Rules (via Sentry)

Set up in: **Sentry → Settings → Alert Rules**

**Critical Alerts** (Email + Slack):
1. Error rate > 1% (5-minute window)
   - Condition: `count() > 100 AND count() / total_count() > 0.01`
   - Action: Email, Slack #alerts

2. High latency (P95 > 2 seconds)
   - Condition: `p95_transaction_duration > 2000`
   - Action: Slack #alerts

3. Database connection errors
   - Condition: `tags.db_error` exists
   - Action: Email, Slack #critical

4. Stripe webhook failures
   - Condition: `tags.service = "stripe"` AND `level = "error"`
   - Action: Email (billing team)

**Warning Alerts** (Slack only):
1. Redis latency > 500ms
   - Condition: `measurements.redis_latency > 500`
   - Action: Slack #ops

2. Rate limit hits
   - Condition: `status_code = 429`
   - Action: Slack #ops

### Alert Configuration

**Slack Integration**:
1. Sentry → Settings → Integrations → Add Slack
2. Authorize workspace
3. Create alert rules (see above)
4. Set target channel: #alerts, #critical, #ops

**Email Alerts**:
1. Sentry → Settings → Project Settings → Email
2. Add team email
3. Configure delivery (immediate, daily digest)

---

## Troubleshooting

### Problem: Dashboard shows "Database Error"

**Steps**:
1. Check Supabase project status:
   ```
   Supabase → Project → Status
   ```

2. Verify connection limits:
   ```
   Supabase → Project → Settings → Database
   Check: Connection pool availability
   ```

3. Check recent migrations:
   ```
   Supabase → Project → Migrations
   Look for recent failed migrations
   ```

4. Test connection:
   ```bash
   psql "postgresql://user:password@host/db" -c "SELECT 1"
   ```

### Problem: Worker latency spikes

**Steps**:
1. Check Cloudflare dashboard:
   ```
   Cloudflare → Account → Workers → yt-intel
   ```

2. View worker logs:
   ```
   Workers → yt-intel → Logs (real-time)
   ```

3. Check error rate:
   ```
   Workers → Analytics → Requests
   Look for 4xx/5xx errors
   ```

4. Scale up: Increase worker timeout if consistently slow
   ```toml
   # wrangler.toml
   [env.production]
   routes = "..."
   compatibility_date = "2024-01-01"
   compatibility_flags = ["nodejs_compat"]
   ```

### Problem: High error rate (>1%)

**Steps**:
1. Go to Sentry Issues page
2. Sort by frequency
3. Click top error to see:
   - Stack trace
   - Affected users
   - Session replays
4. Check release history (was there a recent deploy?)
5. Possible causes:
   - Database connection pool exhausted
   - API rate limits (OpenRouter, YouTube)
   - Invalid user input
   - External service down

### Problem: Slow API responses (P95 > 2s)

**Steps**:
1. Check Sentry Performance dashboard
2. Find slowest transaction
3. Click to see:
   - Slow spans (database, external API)
   - Timeline of operations
4. Optimizations:
   - Add database indexes
   - Implement caching (Redis)
   - Parallelize external API calls
   - Reduce transcript length

---

## Emergency Runbook

### Scenario 1: Error Rate Spikes to 10%

**Goal**: Restore service to <1% error rate within 15 minutes.

**Steps**:

1. **Assess severity** (2 min):
   ```
   Sentry → Issues → Check if affecting users
   Vercel → Real-time logs → Count errors
   ```

2. **Identify root cause** (3 min):
   - Recent deploy? → Rollback
   - Database issue? → Check Supabase status
   - Third-party down? → Check worker, OpenRouter status
   - Rate limiting? → Check API quotas

3. **Mitigate immediately**:
   - **If recent deploy**: `vercel rollback` or revert commit
   - **If database**: Restart pool / scale up connections
   - **If worker**: Check logs, redeploy if needed
   - **If rate limited**: Increase batch size, add retry backoff

4. **Monitor recovery** (5 min):
   ```
   Sentry → Dashboards → Error rate
   Watch for decline below 1%
   ```

5. **Communicate**:
   - Slack #critical: "Error rate spike: INVESTIGATING"
   - Update: "ROOT CAUSE: [reason]"
   - Final: "RESOLVED: Error rate back to [X]%"

6. **Post-incident**:
   - Create ticket: "Postmortem: Error spike on [date]"
   - Add to runbook: "What failed and how to prevent"
   - Update alerts: Tighten thresholds if needed

### Scenario 2: Database Connection Pool Exhausted

**Goal**: Restore database availability within 10 minutes.

**Steps**:

1. **Verify issue**:
   ```
   Supabase → Settings → Database → Connection pool
   Check utilization (should be <90%)
   ```

2. **Immediate action**:
   - Scale connections: Settings → Database → increase `max_connections`
   - Or scale Vercel: Add more instances

3. **Identify leak**:
   - Sentry → Issues → filter by "db_connection"
   - Find operation holding connection too long
   - Add timeout or connection.close()

4. **Monitor**:
   ```
   SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
   ```

5. **Prevention**:
   - Implement connection pooling (Supabase does this)
   - Add query timeouts: `SET statement_timeout = '30s'`
   - Monitor pool utilization in dashboards

### Scenario 3: Worker Continuously Errors (502 Bad Gateway)

**Goal**: Restore metadata fetching within 5 minutes.

**Steps**:

1. **Check worker status**:
   ```
   Cloudflare → Workers → yt-intel → Status
   ```

2. **View logs**:
   ```
   Workers → Analytics → Tail logs
   Look for errors
   ```

3. **Redeploy**:
   ```bash
   cd worker/
   wrangler deploy --env production
   ```

4. **Check configuration**:
   ```
   Workers → yt-intel → Settings
   Verify: YouTube API key set correctly
   ```

5. **Fallback**:
   - Temporarily cache metadata in Supabase
   - Return cached data for repeat requests
   - Queue job to rebuild worker

---

## Monitoring Checklist

### Daily
- [ ] Check Sentry dashboard: error count < 50
- [ ] Review error trends: no new recurring issues
- [ ] Verify /api/health returns 200

### Weekly
- [ ] Review slow transactions (P95 > 1.5s)
- [ ] Check database query performance
- [ ] Verify all alerts are firing correctly

### Monthly
- [ ] Review error grouping: any miscategorized?
- [ ] Audit user impact: how many affected by errors?
- [ ] Plan scaling: traffic growth trends?
- [ ] Review costs: embed generation, API calls

---

## Configuration

### Environment Variables

```bash
# Sentry
NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/xxx
SENTRY_AUTH_TOKEN=xxx  # For releases

# Monitoring
ENABLE_PERFORMANCE_MONITORING=true
TRACE_SAMPLE_RATE=0.1  # 10% in prod, 100% in dev
REPLAY_SAMPLE_RATE=0.1  # 10% in prod

# Health Check
HEALTH_CHECK_TIMEOUT_MS=5000
DATABASE_POOL_WARNING_THRESHOLD=0.8
```

### Sentry Integration in Code

**Monitoring Utilities** (use these in API endpoints):
```typescript
import {
  addBreadcrumb,           // Log operation context
  trackAPIRequest,         // Track API request with auto-timing
  trackDatabaseQuery,      // Track DB operation with timing
  trackExternalCall,       // Track third-party call with timing
  setUserContext,          // Set user info for error context
  clearUserContext,        // Clear user info on logout
  tagError,                // Tag error with custom context
  captureMetric,           // Track business metric
  reportError,             // Report error with severity
} from '@/lib/monitoring/sentry-utils';

// Set user context at start of request
setUserContext(userId, email, tier);

// Log breadcrumb for operation
addBreadcrumb('Started analysis', { videoId });

// Track external service call with auto-timing
try {
  const result = await trackExternalCall(
    'openrouter',
    'claude-analysis',
    () => callOpenRouter(metadata, transcript),
    { videoId }
  );
} catch (error) {
  Sentry.captureException(error, {
    tags: { service: 'openrouter', operation: 'claude-analysis' },
    contexts: { video: { videoId } },
  });
}

// Track database query with auto-timing
await trackDatabaseQuery(
  'insert',
  'analyses',
  async () => {
    const { data, error } = await supabase.from('analyses').insert(...);
    if (error) throw error;
    return data;
  },
  { userId, videoId }
);

// Report error with severity
reportError(new Error('Analysis failed'), {
  endpoint: '/api/analyses',
  method: 'POST',
  userId,
  severity: 'high',
  additionalContext: { videoId, tier }
});
```

**Raw Sentry API** (for custom use cases):
```typescript
import * as Sentry from '@sentry/nextjs';

// Set up breadcrumbs
Sentry.addBreadcrumb({
  category: 'api',
  message: 'POST /api/analyses',
  level: 'info',
  data: { videoId: 'xxx', userId: 'yyy' }
});

// Capture exception with context
Sentry.captureException(error, {
  tags: { endpoint: '/api/analyses' },
  contexts: { api: { videoId, userId } }
});

// Capture message (warning, info, etc)
Sentry.captureMessage('Rate limit exceeded for user', 'warning');
```

---

## References

- **Sentry Docs**: https://docs.sentry.io/platforms/javascript/guides/nextjs/
- **Vercel Monitoring**: https://vercel.com/docs/observability
- **Supabase Analytics**: https://supabase.com/docs/guides/analytics
- **Next.js Performance**: https://nextjs.org/learn/seo/web-performance

---

## Support

For observability issues:
1. Check this guide first
2. Search Sentry issues
3. Ask in #ops Slack channel
4. Create ticket: "Observability: [issue]"

Last reviewed: 2026-05-14
