# Redis Setup - Upstash Configuration

**Date**: 2026-05-16  
**Status**: ✅ Fully configured (local + Vercel production)  
**Purpose**: Distributed rate limiting, session caching, analytics  

## Configuration

### Local Development (.env.local) - ✅ DONE
```bash
UPSTASH_REDIS_REST_URL=https://becoming-lioness-125833.upstash.io
UPSTASH_REDIS_REST_TOKEN=gQAAAAAAAeuJAAIgcDI5YmFlMjVmYzY1MzE0MjMwODBmZjQ1NTVlMjY0MDQ0Mw
```

### Vercel Production - ✅ DONE (2026-05-16T01:09 EEST)
Added via `vercel env add`:
```
UPSTASH_REDIS_REST_URL     → https://becoming-lioness-125833.upstash.io
UPSTASH_REDIS_REST_TOKEN   → gQAAAAAAAeuJAAIgcDI5YmFlMjVmYzY1MzE0MjMwODBmZjQ1NTVlMjY0MDQ0Mw
```
Environments: Production, Preview, Development

## Features Enabled by Redis

### 1. Rate Limiting (Chunk 9)
- Per-user daily limits (free: 3/month, pro: unlimited)
- Prevents abuse and quota overages
- Uses `upstash_redis_key:user:{userId}:analyses:count`

### 2. Session Caching (Optional)
- Cache Supabase auth sessions for fast lookups
- Reduces database queries on every request
- 5-minute TTL

### 3. Request Tracking
- Track API calls per user
- Accumulate for billing/analytics
- Expire daily to reset quotas

## Client Implementation

**File**: `web/lib/redis.ts`

**Features**:
- ✅ REST API (serverless-compatible, no TCP)
- ✅ Automatic fallback to in-memory cache if Redis unavailable
- ✅ Type-safe async/await interface
- ✅ Expiration support (SETEX, EXPIRE)
- ✅ Counter operations (INCR, INCRBY)

**Usage**:
```typescript
import { setRedisValue, getRedisValue, incrementRedisValue } from '@/lib/redis';

// Set a value with expiration
await setRedisValue('key', 'value', 3600); // 1 hour

// Increment a counter (for rate limiting)
const count = await incrementRedisValue('user:123:requests', 1);

// Get a value
const value = await getRedisValue('key');
```

## Verification

After adding to Vercel, the logs will show:
```
[redis.ts] Redis client initialized
```

Instead of:
```
[redis.ts] Redis credentials not configured, using in-memory cache
```

**Test Command** (local):
```bash
# Verify Redis is connected
curl -X POST https://becoming-lioness-125833.upstash.io/set/test-key/test-value \
  -H "Authorization: Bearer gQAAAAAAAeuJAAIgcDI5YmFlMjVmYzY1MzE0MjMwODBmZjQ1NTVlMjY0MDQ0Mw"
```

## Troubleshooting

### Redis Still Using In-Memory Cache
1. Check Vercel env vars were saved: `vercel env ls | grep UPSTASH`
2. Verify token is correct (starts with `gQAAAA...`)
3. Check deployment logs for auth errors

### Rate Limiting Not Working
- If `redis.available === false`, falls back to memory (works in single instance)
- For multi-instance Vercel (recommended for prod), need Redis for cross-instance consistency

### Upstash Console
- View usage: https://console.upstash.io/redis/db-id-here
- Monitor commands, check TTL, clear data
- Pricing: $0/month for free tier + usage

## Next Steps

1. **Immediate**: Add credentials to Vercel (3 min)
2. **Short-term**: Test rate limiting in Chunk 9
3. **Medium-term**: Monitor Redis usage for quota scaling
4. **Long-term**: Consider Redis persistence for session state (Upstash Premium)

## Files Modified

- `web/.env.local` - Added Upstash credentials
- `web/.env.example` - Added template for Upstash config
- `web/lib/redis.ts` - Already supports Upstash (no changes needed)

---

**Ready**: Credentials in local .env, pending Vercel setup
