# Test Fixtures & Mock Data Implementation

**Document**: Complete Test Fixture Specification  
**Version**: 1.0.0  
**Status**: READY FOR AUTOMATED TEST IMPLEMENTATION  
**Generated**: 2026-05-22 (Session Continuation)  
**Purpose**: Provides all fixtures, mocks, and helpers for executing 38 pairwise test cases

---

## Overview

All test infrastructure is now in place for executing comprehensive pairwise test coverage:

| Component | Location | Status | Purpose |
|---|---|---|---|
| **User Fixtures** | `tests/fixtures/users.ts` | ✅ Complete | 5 user profiles + auth sessions |
| **Video Fixtures** | `tests/fixtures/videos.ts` | ✅ Complete | 5 pre-analyzed videos + cache entries |
| **Service Mocks** | `tests/mocks/services.ts` | ✅ Complete | OpenRouter, Redis, Stripe, Supabase |
| **Test Config** | `tests/pairwise/config.ts` | ✅ Complete | Environment setup + helpers |
| **Test Matrix** | `docs/testing/PAIRWISE_TEST_MATRIX_WAVES_1_4.md` | ✅ Complete | 38 test case specifications |

---

## Fixture Inventory

### User Profiles (5 profiles)

```typescript
testUsers = {
  freeUser,              // Standard free tier (0/3 quota used)
  freeUserNearQuota,    // Free tier at quota boundary (2/3 used)
  freeUserOverQuota,    // Free tier exceeded (3/3 used)
  proUser,              // Pro tier (unlimited)
  enterpriseUser,       // Enterprise tier (premium features)
  adminUser,            // Admin role (access to /api/admin)
  ciTestUser,           // Persistent test user for CI bypass
}
```

**Usage in Tests**:
```typescript
import { testUsers, authHeaders } from '../fixtures/users';

// Use free user with fresh auth
const headers = authHeaders.supabase(supabaseSession(testUsers.freeUser.id).access_token);

// Use admin for protected routes
const response = await fetch('/api/admin/stats', {
  headers: authHeaders.supabase(supabaseSession(testUsers.adminUser.id).access_token),
});
```

---

### Video Fixtures (5 videos)

```typescript
testVideos = {
  shortEducational,     // 10-min React tutorial (fast to analyze)
  longTechnical,        // 60-min Node.js course (stress test)
  multiLanguage,        // French transcript (charset handling)
  unavailableVideo,     // Deleted/private video (error path)
  longTranscript,       // ~50KB transcript (timeout handling)
}
```

**Usage in Tests**:
```typescript
// Test cache hit with short video
const cacheEntry = redisCacheEntries.freshAnalysis; // Already cached
const response = await analyzeVideo(testVideos.shortEducational.videoId);
// Should return instantly from cache

// Test timeout with long transcript
const result = await analyzeVideo(testVideos.longTranscript.videoId, { timeout: 10000 });
// Should handle streaming response + adaptive timeout
```

---

### Cache Entries (3 states)

```typescript
redisCacheEntries = {
  freshAnalysis,        // < 5 minutes old (TTL: ~1 hour remaining)
  staleAnalysis,        // 90+ minutes old (TTL expired, available for stale-while-revalidate)
  rateLimitEntry,       // Rate limit counter (2/3 analyses used)
}
```

**Usage in Tests**:
```typescript
// Simulate fresh cache hit
mockRedis.set(redisCacheEntries.freshAnalysis.key, redisCacheEntries.freshAnalysis.value);
const result = await analyzeVideo('dQw4w9WgXcQ'); // Should hit cache
expect(result.source).toBe('cache');

// Simulate cache miss with network failure
mockRedis.delete(redisCacheEntries.freshAnalysis.key);
mockOpenRouter.timeout(5000);
const result = await analyzeVideo('dQw4w9WgXcQ'); // Should timeout, return error
expect(result.error).toBe('NETWORK_TIMEOUT');
```

---

### Service Mocks (4 services)

#### OpenRouter API Mock
```typescript
openrouterMocks = {
  successResponse,        // Valid analysis (with 16 sections)
  timeoutResponse,        // 11-second delay (exceeds timeout)
  rateLimitResponse,      // 429 Too Many Requests
  invalidKeyResponse,     // 401 Unauthorized
  modelNotFoundResponse,  // 404 Model not found
  connectionRefused,      // ECONNREFUSED network error
}
```

**Usage in Tests**:
```typescript
// Test successful analysis
mockOpenRouter.respond(openrouterMocks.successResponse);
const result = await analyzeVideo('dQw4w9WgXcQ');
expect(result.sections).toHaveLength(16);

// Test timeout handling
mockOpenRouter.respond(openrouterMocks.timeoutResponse);
const result = await analyzeVideo('dQw4w9WgXcQ', { timeout: 3000 });
expect(result.error).toBe('TIMEOUT');
```

#### Upstash Redis Mock
```typescript
upstashMocks = {
  setResponse,            // OK response for SET
  getResponse,            // Returns cached value
  getNullResponse,        // NULL for nonexistent key
  incrResponse,           // Increments counter
  connectionTimeout,      // ETIMEOUT on connection
  authError,              // WRONGPASS error
  rateLimitError,         // Rate limit exceeded
}
```

**Usage in Tests**:
```typescript
// Test quota enforcement with fresh count
mockUpstash.respond(upstashMocks.getResponse); // Returns "2"
const { remaining } = await checkQuota(testUsers.freeUser.id);
expect(remaining).toBe(1); // 1 of 3 remaining

// Test fallback when Redis unavailable
mockUpstash.error(upstashMocks.connectionTimeout);
const { remaining } = await checkQuota(testUsers.freeUser.id);
// Should fall back to database query
expect(remaining).toBeGreaterThanOrEqual(0);
```

#### Stripe Mock
```typescript
stripeMocks = {
  chargeSuccess,          // Successful $9 charge
  chargeDeclined,         // Card declined
  webhookInvalidSignature, // Invalid webhook signature
  webhookSuccess,         // Valid webhook event
}
```

**Usage in Tests**:
```typescript
// Test successful upgrade to Pro
mockStripe.respond(stripeMocks.chargeSuccess);
const result = await upgradeSubscription(testUsers.freeUser.id, 'pro');
expect(result.tier).toBe('pro');

// Test webhook handling
const event = stripeMocks.webhookSuccess;
const result = await handleStripeWebhook(event);
expect(result.processed).toBe(true);
```

#### Supabase Mock
```typescript
supabaseMocks = {
  authSuccess,            // Valid auth session
  authFailure,            // Invalid token
  connectionTimeout,      // Network timeout
  databaseError,          // Table doesn't exist
  rlsViolation,           // RLS policy violation
}
```

**Usage in Tests**:
```typescript
// Test successful auth check
mockSupabase.respond(supabaseMocks.authSuccess);
const user = await getCurrentUser();
expect(user.email).toBe('test@example.com');

// Test RLS policy enforcement
mockSupabase.respond(supabaseMocks.rlsViolation);
const result = await insertAnalysis(testUsers.freeUser.id, videoId);
expect(result.error).toContain('row-level security');
```

---

## Configuration Registry

### Environment Configurations

```typescript
testEnvironments = {
  production: { NODE_ENV: 'production', NEXT_PUBLIC_VERCEL_ENV: 'production' },
  ci: { GITHUB_ACTIONS: 'true', CI: 'true' },
  development: { NODE_ENV: 'development' },
}
```

### Auth Provider Configurations

```typescript
authConfigs = {
  supabase: { AUTH_PROVIDER: 'supabase', url: '...', anonKey: '...' },
  nextauth: { AUTH_PROVIDER: 'nextauth', NEXTAUTH_SECRET: '...' },
}
```

### Rate Tier Configurations

```typescript
rateTierConfigs = {
  free: { analysesPerMonth: 3, exportsPerMonth: 1, sharesPerMonth: 30 },
  pro: { analysesPerMonth: 999, exportsPerMonth: 10, sharesPerMonth: 999 },
  enterprise: { analysesPerMonth: 9999, exportsPerMonth: 9999, sharesPerMonth: 9999 },
}
```

---

## Helper Functions

### Test Request Creation

```typescript
const request = createTestRequest(
  'PW1-001',
  '/api/analyses',
  { url: 'https://youtube.com/watch?v=dQw4w9WgXcQ' },
  testUsers.freeUser.id
);
// Returns: { method, url, headers, body }
```

### Response Validation

```typescript
const validation = validateResponse(response, 200, 'Executive Summary');
// Returns: { passed: boolean, status, expectedStatus, hasContent }
```

### Test Configuration Lookup

```typescript
const config = getTestConfig('PW1-001');
// Returns: { environment, caseId }
```

---

## Mock Service Control API

### Set Service as Unhealthy

```typescript
import { setServiceUnhealthy, restoreServiceHealth } from '../mocks/services';

// Simulate OpenRouter outage
setServiceUnhealthy('openrouter', 'Service maintenance');

// Run tests that verify graceful degradation
const result = await analyzeVideo(videoId); // Should fallback
expect(result.source).toBe('cache_fallback');

// Restore service
restoreServiceHealth('openrouter');
```

### Check Mock Status

```typescript
import { mockStatus } from '../mocks/services';

console.log(mockStatus.openrouter);
// { healthy: false, latency: 800, lastError: 'Service maintenance' }
```

---

## Next Phase: Automated Test Implementation

### Phase 2 Deliverables

All fixtures are now ready for implementing the automated test suite:

**File Structure**:
```
tests/pairwise/
├── index.spec.ts              # Main test harness
├── auth.spec.ts               # Auth & authorization tests (PW1-003, -013, ...)
├── errors.spec.ts             # Error handling tests (PW1-002, -037, ...)
├── quota.spec.ts              # Rate limiting & quota tests (PW1-006, -021, ...)
├── cache.spec.ts              # Cache behavior tests (PW1-025, ...)
├── middleware.spec.ts         # Routing & middleware tests (PW1-004, -029, ...)
└── config.ts                  # (already created)
```

**Test Harness Pattern**:
```typescript
import { test, expect } from '@playwright/test';
import { testUsers, createTestRequest } from '../fixtures/users';
import { testVideos } from '../fixtures/videos';
import { fixtures } from './config';

test.describe('Pairwise Tests - Wave 1-4', () => {
  test('PW1-001: Production + Supabase + Free + Fresh Cache', async ({ page }) => {
    // Setup
    const user = fixtures.users.freeUser;
    const video = fixtures.videos.shortEducational;
    
    // Execute
    const response = await page.request.post(
      '/api/analyses',
      {
        headers: { Authorization: 'Bearer token' },
        data: { url: `https://youtube.com/watch?v=${video.videoId}` },
      }
    );
    
    // Verify
    expect(response.ok()).toBe(true);
    expect(response.json()).resolves.toHaveProperty('sections');
  });
});
```

### Estimated Timeline

- **Phase 2a**: Implement 10 happy path tests (2-3 hours)
- **Phase 2b**: Implement 12 error handling tests (3-4 hours)
- **Phase 2c**: Implement 8 auth/quota tests (2-3 hours)
- **Phase 2d**: Implement 8 cache/middleware tests (2-3 hours)
- **Phase 2e**: Setup CI/CD integration (1-2 hours)
- **Total**: ~12-15 hours for complete test suite

### Critical Success Factors

✅ **All fixtures prepared** — No additional fixture development needed  
✅ **Mocks comprehensive** — Covers all network scenarios  
✅ **Config centralized** — Single source of truth for test configuration  
✅ **Helpers functional** — Ready to use in test implementations  

**Next step**: Begin Phase 2 implementation of automated Playwright test suite

---

## Usage Quick Reference

### Import Fixtures
```typescript
import { testUsers, authHeaders, nextAuthSession } from '../fixtures/users';
import { testVideos, cachedAnalyses, redisCacheEntries } from '../fixtures/videos';
```

### Import Mocks
```typescript
import {
  openrouterMocks,
  upstashMocks,
  stripeMocks,
  networkErrors,
  setServiceUnhealthy,
  restoreServiceHealth,
} from '../mocks/services';
```

### Import Config
```typescript
import {
  testEnvironments,
  authConfigs,
  rateTierConfigs,
  apiEndpoints,
  middlewarePaths,
  createTestRequest,
  validateResponse,
  fixtures,
} from './config';
```

---

## Document Metadata

**Location**: `/docs/testing/TEST_FIXTURES_IMPLEMENTATION.md`  
**Version**: 1.0.0  
**Status**: READY FOR PHASE 2 (Automated Tests)  
**Fixtures Count**: 4 files, 50+ fixtures, 20+ mock scenarios  
**Next Step**: Implement automated test suite using Playwright

---

*Test infrastructure ready. Phase 2: Automated Test Implementation (2-3 sessions)*  
*Covers Waves 1-4: Core Infrastructure + API Routes + Error Handling + Security Hardening*
