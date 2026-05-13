# Monitoring & Observability Guide

This directory contains utilities for monitoring and observing hex-yt-intel.

## Files

- `sentry-utils.ts` - Sentry integration helpers (tracking, context, metrics)
- `metrics.ts` - Business metrics collection and aggregation

## Quick Start

### 1. Track API Requests

```typescript
import { trackAPIRequest, setUserContext } from '@/lib/monitoring/sentry-utils';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authConfig);
  const userId = session.user.id;

  // Set user context for error tracking
  setUserContext(userId, session.user.email, userTier);

  // Track request with auto-timing
  const result = await trackAPIRequest('POST', '/api/analyses', async () => {
    // Your request logic here
    return await someFunction();
  }, { userId, tier: userTier });

  return NextResponse.json(result);
}
```

### 2. Track Database Queries

```typescript
import { trackDatabaseQuery } from '@/lib/monitoring/sentry-utils';

const user = await trackDatabaseQuery(
  'select',
  'users',
  async () => {
    return await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
  },
  { userId }
);
```

### 3. Track External Service Calls

```typescript
import { trackExternalCall } from '@/lib/monitoring/sentry-utils';

const metadata = await trackExternalCall(
  'cloudflare-worker',
  'fetch-metadata',
  async () => {
    return await fetch(workerUrl).then(r => r.json());
  },
  { videoId }
);
```

### 4. Add Breadcrumbs

```typescript
import { addBreadcrumb } from '@/lib/monitoring/sentry-utils';

addBreadcrumb('Checking user quota', { userId, tier });
addBreadcrumb('Analysis created', { analysisId, title });
```

### 5. Track Business Metrics

```typescript
import { 
  trackAnalysisCreated, 
  trackSearch, 
  trackEmbedding 
} from '@/lib/monitoring/metrics';

// When analysis is created
trackAnalysisCreated(userId, tier, latencyMs);

// When search is performed
trackSearch(userId, tier, latencyMs, resultCount);

// When embedding is generated
trackEmbedding(userId, analysisId, tokensUsed, costUsd);
```

## API Route Example

Here's a complete example of a monitored API route:

```typescript
import { getServerSession } from 'next-auth';
import { authConfig } from '@/lib/auth/nextauth-config';
import { NextRequest, NextResponse } from 'next/server';
import { 
  trackAPIRequest, 
  trackDatabaseQuery,
  trackExternalCall,
  setUserContext,
  addBreadcrumb 
} from '@/lib/monitoring/sentry-utils';
import { trackAnalysisCreated } from '@/lib/monitoring/metrics';
import * as Sentry from '@sentry/nextjs';

export async function POST(request: NextRequest) {
  const startTime = performance.now();

  try {
    // Set user context
    const session = await getServerSession(authConfig);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const userTier = session.user.tier || 'free';
    setUserContext(userId, session.user.email, userTier);

    // Parse request
    const body = await request.json();
    addBreadcrumb('Received request', { url: body.url });

    // Track database query
    const { user } = await trackDatabaseQuery(
      'select',
      'users',
      async () => {
        const supabase = createClient(...);
        const { data } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .single();
        return data;
      },
      { userId }
    );

    // Check quota
    if (user.tier === 'free' && user.analyses_used >= 3) {
      return NextResponse.json(
        { error: 'Quota exceeded' },
        { status: 402 }
      );
    }

    // Track external service call
    const metadata = await trackExternalCall(
      'cloudflare-worker',
      'fetch-metadata',
      async () => {
        const res = await fetch(workerUrl);
        if (!res.ok) throw new Error(`${res.status}`);
        return await res.json();
      },
      { videoId: body.videoId }
    );

    // Generate analysis (tracked internally)
    const markdown = await generateAnalysis(metadata);
    addBreadcrumb('Analysis generated', { markdownLength: markdown.length });

    // Save to database
    const { analysis } = await trackDatabaseQuery(
      'insert',
      'analyses',
      async () => {
        const supabase = createClient(...);
        return await supabase
          .from('analyses')
          .insert({ ... })
          .single();
      },
      { userId }
    );

    // Track business metric
    const latency = performance.now() - startTime;
    trackAnalysisCreated(userId, userTier, latency);

    // Return response
    return NextResponse.json({
      id: analysis.id,
      title: metadata.title,
      markdown,
    });

  } catch (error) {
    const latency = performance.now() - startTime;
    console.error('[/api/endpoint] Error:', error);

    // Report error with full context
    Sentry.captureException(error, {
      tags: {
        endpoint: '/api/endpoint',
        method: 'POST',
      },
      contexts: {
        api: {
          latency,
          endpoint: '/api/endpoint',
        },
      },
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

## Key Patterns

### Pattern 1: Automatic Timing

```typescript
const result = await trackAPIRequest('GET', '/api/users', async () => {
  // This function is timed automatically
  return await someQuery();
});
// Timing is logged to Sentry automatically
```

### Pattern 2: User Context

```typescript
setUserContext(userId, email, tier);
// Now all errors are associated with this user
// You can see: "Affected users: 1" in Sentry
```

### Pattern 3: Breadcrumb Trail

```typescript
addBreadcrumb('Step 1: Fetched user');
addBreadcrumb('Step 2: Checked quota');
addBreadcrumb('Step 3: Generated analysis');
// If error occurs, you see the breadcrumb trail showing what happened
```

### Pattern 4: Tagged Errors

```typescript
Sentry.captureException(error, {
  tags: {
    severity: 'critical',
    endpoint: '/api/analyses',
  },
  contexts: {
    custom: { analysisId, userId },
  },
});
// Errors are tagged for filtering in Sentry dashboard
```

## Metrics Reference

### API Metrics

- `api_request` (count) - Number of API requests
- `api_latency` (ms) - Response time
- `api_error_4xx` (count) - Client errors
- `api_error_5xx` (count) - Server errors

### Business Metrics

- `analysis_created` (count)
- `analysis_latency` (ms)
- `search_executed` (count)
- `search_results` (count)
- `embedding_generated` (count)
- `embedding_tokens` (count)
- `embedding_cost` (usd)

### Example Query

```typescript
import { getMetricsSummary } from '@/lib/monitoring/metrics';

// Get metrics for last 60 minutes
const summary = getMetricsSummary(60);

// Output:
// {
//   'api_request': { count: 150, sum: 150, avg: 1 },
//   'api_latency': { count: 150, sum: 28500, avg: 190 },
//   'analysis_created': { count: 12, sum: 12, avg: 1 },
// }
```

## Best Practices

1. **Always set user context** at start of authenticated routes
2. **Add breadcrumbs** for multi-step operations
3. **Track external calls** (Worker, OpenRouter, Stripe)
4. **Report latency** for performance monitoring
5. **Use meaningful tags** for filtering errors
6. **Flush metrics** periodically (automatic every 1000 metrics)

## Troubleshooting

### Metrics not appearing in Sentry?
- Check: `NEXT_PUBLIC_SENTRY_DSN` is configured
- Check: Events are flowing (Sentry → Stats tab)
- Check: Sample rate isn't filtering out events

### User context not appearing?
- Call `setUserContext()` early in request handler
- Verify session is authenticated
- Check Sentry → Issues → User filter

### Performance metrics slow?
- Check database query optimization
- Check external service latency
- Add caching for frequently accessed data

## References

- [Sentry Next.js Docs](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Sentry Transactions](https://docs.sentry.io/product/performance/transaction-summary/)
- [Best Practices](docs/OBSERVABILITY.md)
