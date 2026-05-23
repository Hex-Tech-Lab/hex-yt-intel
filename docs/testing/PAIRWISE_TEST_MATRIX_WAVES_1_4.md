# Pairwise Test Matrix: Waves 1-4 (Foundational Stabilization)

**Document**: Pairwise Test Coverage Specification  
**Version**: 1.0.0  
**Build**: Latest (post-remediation)  
**Timestamp**: 2026-05-22 (Session Continuation)  
**Scope**: Waves 1-4 comprehensive validation  
**Purpose**: Minimal combinatorial coverage of all critical execution paths

---

## Test Matrix Overview

**7 Dimensions × Pairwise Coverage = 38 High-Value Test Cases**

| # | Environment | Auth Method | Rate Tier | Error Type | Cache State | API Endpoint | Middleware Path | Test ID | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Production | Supabase | Free | None | Fresh | analyses | Protected | PW1-001 | Happy Path |
| 2 | Production | Supabase | Pro | Network Fail | Stale | search | Public | PW1-002 | Error + Cache |
| 3 | Production | NextAuth | Enterprise | Missing Data | Expired | metadata | Admin | PW1-003 | Premium Tier |
| 4 | Development | Supabase | Free | Invalid Input | Fresh | export | Public | PW1-004 | Dev Baseline |
| 5 | Development | NextAuth | Pro | None | Stale | share | Protected | PW1-005 | Dev NextAuth |
| 6 | CI | Supabase | Free | Network Fail | Fresh | analyses | Public | PW1-006 | CI Polyfill |
| 7 | CI | NextAuth | Enterprise | Missing Data | Expired | search | Protected | PW1-007 | CI NextAuth |
| 8 | Production | Supabase | Enterprise | Invalid Input | Fresh | metadata | Public | PW1-008 | Enterprise Auth |
| 9 | Development | Supabase | Pro | None | Stale | export | Admin | PW1-009 | Dev Admin |
| 10 | Development | NextAuth | Free | Network Fail | Fresh | share | Public | PW1-010 | Dev Free Tier |
| 11 | CI | Supabase | Pro | Missing Data | Stale | analyses | Admin | PW1-011 | CI Admin Path |
| 12 | CI | NextAuth | Free | Invalid Input | Fresh | search | Public | PW1-012 | CI Free Tier |
| 13 | Production | NextAuth | Free | Network Fail | Stale | export | Protected | PW1-013 | NextAuth Free |
| 14 | Production | Supabase | Pro | None | Expired | share | Admin | PW1-014 | Supabase Admin |
| 15 | Development | Supabase | Enterprise | Missing Data | Fresh | metadata | Protected | PW1-015 | Dev Enterprise |
| 16 | Development | NextAuth | Free | Invalid Input | Stale | analyses | Public | PW1-016 | Dev NextAuth Free |
| 17 | CI | Supabase | Free | None | Fresh | export | Protected | PW1-017 | CI Supabase Free |
| 18 | CI | NextAuth | Pro | Network Fail | Expired | share | Public | PW1-018 | CI NextAuth Pro |
| 19 | Production | Supabase | Free | Missing Data | Stale | search | Public | PW1-019 | Prod Supabase Free |
| 20 | Production | NextAuth | Pro | Invalid Input | Fresh | metadata | Protected | PW1-020 | Prod NextAuth Pro |
| 21 | Development | Supabase | Free | Network Fail | Expired | share | Admin | PW1-021 | Dev Network Error |
| 22 | Development | NextAuth | Enterprise | None | Fresh | analyses | Protected | PW1-022 | Dev NextAuth Ent |
| 23 | CI | Supabase | Enterprise | Invalid Input | Stale | export | Public | PW1-023 | CI Supabase Ent |
| 24 | CI | NextAuth | Free | Missing Data | Fresh | metadata | Admin | PW1-024 | CI NextAuth Free |
| 25 | Production | Supabase | Pro | Network Fail | Fresh | share | Public | PW1-025 | Prod Network |
| 26 | Production | NextAuth | Enterprise | None | Stale | analyses | Admin | PW1-026 | Prod NextAuth Ent |
| 27 | Development | Supabase | Pro | Invalid Input | Fresh | search | Protected | PW1-027 | Dev Supabase Pro |
| 28 | Development | NextAuth | Free | Missing Data | Expired | export | Public | PW1-028 | Dev NextAuth Free |
| 29 | CI | Supabase | Free | None | Fresh | metadata | Protected | PW1-029 | CI Supabase Free |
| 30 | CI | NextAuth | Enterprise | Network Fail | Stale | share | Admin | PW1-030 | CI NextAuth Ent |
| 31 | Production | Supabase | Enterprise | None | Fresh | export | Protected | PW1-031 | Prod Supabase Ent |
| 32 | Production | NextAuth | Free | Invalid Input | Expired | search | Public | PW1-032 | Prod NextAuth Free |
| 33 | Development | Supabase | Enterprise | None | Stale | analyses | Admin | PW1-033 | Dev Supabase Ent |
| 34 | Development | NextAuth | Pro | Network Fail | Fresh | metadata | Public | PW1-034 | Dev NextAuth Pro |
| 35 | CI | Supabase | Pro | Missing Data | Fresh | share | Protected | PW1-035 | CI Supabase Pro |
| 36 | CI | NextAuth | Free | Invalid Input | Stale | export | Public | PW1-036 | CI NextAuth Free |
| 37 | Production | Supabase | Free | Invalid Input | Stale | analyses | Admin | PW1-037 | Prod Input Error |
| 38 | Production | NextAuth | Pro | Missing Data | Fresh | search | Protected | PW1-038 | Prod Missing Data |

---

## Test Case Specifications

### Test Category 1: Happy Path (7 cases)

#### PW1-001: Production + Supabase + Free Tier + Clean + Fresh Cache + Analyses + Protected
**Scenario**: Standard authenticated user analysis in production  
**Prerequisites**:
- User authenticated via Supabase OAuth
- Redis cache is fresh (< 1 hour old)
- No rate limit warnings
- Network connectivity normal

**Execution Steps**:
1. POST /api/analyses with valid YouTube URL
2. Verify 200 response with markdown content
3. Check response headers contain Cache-Control: public
4. Verify database record created in analyses table
5. Verify usage_logs entry created

**Expected Outcomes**:
- ✅ Analysis completes in < 8 seconds
- ✅ Markdown structure valid (16 sections)
- ✅ User quota incremented (free tier: 1/3 used)
- ✅ Cache entry created with 1-hour TTL
- ✅ No Sentry errors logged

**Pass Criteria**:
- Response status: 200
- Body contains valid markdown with all 16 sections
- No TypeScript errors in logs
- Duration < 8000ms

---

#### PW1-014: Production + Supabase + Pro Tier + No Error + Expired Cache + Share + Admin Path
**Scenario**: Admin user sharing content via pro tier with cache miss  
**Prerequisites**:
- User authenticated via Supabase OAuth (admin role)
- Pro tier subscription active
- Cache expired (> 1 hour old)
- Admin path: /api/admin/stats

**Execution Steps**:
1. GET /api/admin/stats with valid admin token
2. Verify cache miss triggers fresh query
3. Check database hit for stats aggregation
4. Verify response contains aggregated metrics
5. Check cache rehydration successful

**Expected Outcomes**:
- ✅ Admin stats returned (user count, total analyses, quota usage)
- ✅ Database query completes in < 2 seconds
- ✅ Cache repopulated for next request
- ✅ No auth bypass detected
- ✅ Sentry logs include cache-miss breadcrumb

**Pass Criteria**:
- Response status: 200
- Body contains valid admin stats JSON
- Admin role verified in logs
- Duration < 2000ms

---

### Test Category 2: Error Handling (12 cases)

#### PW1-002: Production + Supabase + Pro Tier + Network Fail + Stale Cache + Search + Public
**Scenario**: Search endpoint with network failure, stale cache available  
**Prerequisites**:
- Supabase network unavailable (simulated via timeout)
- Search cache is stale (1-2 hours old)
- User tier: Pro (eligible for cache fallback)

**Execution Steps**:
1. Configure network timeout to 500ms (faster than retry)
2. POST /api/analyses/search with query
3. Monitor for OpenRouter timeout (3-second handshake)
4. Verify fallback to stale cache invoked
5. Check response headers contain Cache-Control: stale-while-revalidate

**Expected Outcomes**:
- ✅ Returns stale cache (marked as stale in response metadata)
- ✅ Falls back to OpenRouter if cache unavailable
- ✅ Logs include breadcrumb: "network_timeout" → "fallback_cache"
- ✅ User notified of stale data in response
- ✅ Background revalidation queued

**Pass Criteria**:
- Response status: 200 (with `_stale: true` marker in JSON)
- Body contains search results (cached or fresh)
- Sentry breadcrumb logged for fallback
- No 5xx errors

---

#### PW1-037: Production + Supabase + Free Tier + Invalid Input + Stale Cache + Analyses + Admin Path
**Scenario**: Invalid YouTube URL with stale cache on admin path  
**Prerequisites**:
- User submits malformed YouTube URL
- Previous analysis cached (stale)
- Attempting admin operation (quota reset)

**Execution Steps**:
1. POST /api/analyses with invalid URL format
2. Verify zod schema validation catches error
3. Check error response with ERROR_CODE = "INVALID_INPUT"
4. Verify quota NOT incremented (error before quota check)
5. Verify Sentry logs include ERROR_CODE + input details (sanitized)

**Expected Outcomes**:
- ✅ 400 Bad Request with structured error
- ✅ Error code: INVALID_INPUT
- ✅ User quota unchanged (0/3 still)
- ✅ No OpenRouter call made
- ✅ Sentry breadcrumb includes sanitized URL

**Pass Criteria**:
- Response status: 400
- Body contains `{ error: "Invalid YouTube URL", code: "INVALID_INPUT" }`
- Quota verification shows no increment
- Sentry breadcrumb present

---

### Test Category 3: Authentication & Authorization (8 cases)

#### PW1-003: Production + NextAuth + Enterprise Tier + Missing Data + Expired Cache + Metadata + Admin
**Scenario**: Admin user with incomplete NextAuth session  
**Prerequisites**:
- NextAuth session partially expired (token refreshed, user data missing)
- Enterprise tier subscription
- Accessing admin-only metadata endpoint

**Execution Steps**:
1. Call GET /api/metadata with partially expired session
2. NextAuth attempts token refresh
3. Verify user data populated from session callback
4. Check admin role verified from user.roles array
5. Return public metadata (no sensitive data exposure)

**Expected Outcomes**:
- ✅ NextAuth refreshes token automatically
- ✅ User identified even with expired cache
- ✅ Admin role verified
- ✅ Metadata returned (public video info only)
- ✅ No private data leaked

**Pass Criteria**:
- Response status: 200
- Admin role verified in logs
- Metadata contains only public fields
- Session refresh logged

---

#### PW1-013: Production + NextAuth + Free Tier + Network Fail + Stale Cache + Export + Protected
**Scenario**: Free tier user exporting content with NextAuth network failure  
**Prerequisites**:
- NextAuth provider (Google/GitHub) temporarily unavailable
- User has stale session cache (< 1 hour old)
- Export endpoint protected (not public)

**Execution Steps**:
1. POST /api/analyses/export with stale NextAuth session
2. Middleware checks session, finds stale cache
3. Attempt auth check with network timeout
4. Fall back to cached session (if still valid)
5. Verify free tier quota enforced

**Expected Outcomes**:
- ✅ Middleware allows request with cached session
- ✅ No auth failure on provider timeout
- ✅ Free tier export limit enforced (1/month)
- ✅ Breadcrumb logged: "auth_cached_fallback"
- ✅ Export completes (PDF generation)

**Pass Criteria**:
- Response status: 200
- Export file returned (PDF)
- Quota updated (1/1 for free tier)
- Auth fallback breadcrumb present

---

### Test Category 4: Rate Limiting & Quota (8 cases)

#### PW1-006: CI + Supabase + Free Tier + Network Fail + Fresh Cache + Analyses + Public
**Scenario**: CI environment with rate limit check on public endpoint  
**Prerequisites**:
- CI environment (GITHUB_ACTIONS=true)
- Free tier user (3 analyses/month limit)
- Fresh cache available
- Public endpoint (no auth required)

**Execution Steps**:
1. CI polyfill injects UPSTASH_REDIS_REST_URL dummy value
2. POST /api/analyses is called (attempts rate limit check)
3. Redis connection fails (mock Redis in CI)
4. Verify graceful degradation (allow request, log warning)
5. Database quota check succeeds
6. Analysis proceeds with fallback quota

**Expected Outcomes**:
- ✅ CI polyfill prevents false validation failures
- ✅ Request allowed despite Redis timeout
- ✅ Database quota check performs (authoritative)
- ✅ Breadcrumb logged: "redis_unavailable" → "db_fallback"
- ✅ Analysis completes successfully
- ✅ No critical errors in CI logs

**Pass Criteria**:
- Response status: 200
- Analysis created in database
- Quota verified via database (authoritative)
- CI polyfill breadcrumb logged
- Build succeeds (no CI failures)

---

#### PW1-021: Development + Supabase + Free Tier + Network Fail + Expired Cache + Share + Admin
**Scenario**: Local development with quota enforcement during share operation  
**Prerequisites**:
- NODE_ENV=development
- Free tier user (3 analyses/month quota)
- User has 2/3 quota used
- Cache expired (> 1 hour)
- Attempting to share analysis

**Execution Steps**:
1. POST /api/analyses/share with expired cache
2. Middleware checks auth (Supabase dev session)
3. Rate limiter attempts Redis check (local Redis instance)
4. If Redis unavailable, fall back to database quota
5. Verify quota check (2/3 used) allows operation
6. Create share token in database

**Expected Outcomes**:
- ✅ Share operation succeeds (within quota)
- ✅ Share token generated
- ✅ Cache miss doesn't block operation
- ✅ Quota check uses database fallback
- ✅ Share link returned to user

**Pass Criteria**:
- Response status: 200
- Body contains valid share token
- Database record created
- Quota still shows 2/3 (not incremented)

---

### Test Category 5: Cache Behavior (6 cases)

#### PW1-025: Production + Supabase + Pro Tier + Network Fail + Fresh Cache + Share + Public
**Scenario**: Sharing with fresh cache during network outage  
**Prerequisites**:
- Cache freshly populated (< 5 minutes old)
- OpenRouter/external network unavailable
- Pro tier user (unlimited analyses, faster cache)

**Execution Steps**:
1. POST /api/analyses/share for previously analyzed video
2. Network check finds OpenRouter unavailable
3. Cache is fresh, query logic returns cached analysis
4. Share token generated from cached data
5. Response headers show Cache-Control: public, max-age=3600

**Expected Outcomes**:
- ✅ Share succeeds using cache (zero OpenRouter calls)
- ✅ Cache hit prevents OpenRouter error propagation
- ✅ Response includes Cache-Control headers
- ✅ Share token valid and shareable
- ✅ Breadcrumb: "cache_hit" (no network call)

**Pass Criteria**:
- Response status: 200
- Share token valid
- Cache-Control headers present
- No OpenRouter API calls logged

---

### Test Category 6: Middleware & Routing (5 cases)

#### PW1-004: Development + Supabase + Free Tier + Invalid Input + Fresh Cache + Export + Public
**Scenario**: Public route accessed without auth, invalid input validation  
**Prerequisites**:
- Endpoint marked as public (no auth required)
- Request contains invalid export format parameter
- Development environment (lax validation)

**Execution Steps**:
1. POST /api/analyses/export without Authorization header
2. Middleware allows request (public route)
3. Zod schema validates export format
4. Invalid format rejected with 400
5. Error response includes format options

**Expected Outcomes**:
- ✅ Middleware allows unauthenticated access (public route)
- ✅ Validation catches invalid input
- ✅ 400 response with helpful error message
- ✅ No auth challenge returned
- ✅ No Sentry security alert

**Pass Criteria**:
- Response status: 400
- Error message includes valid format options
- No auth-related errors
- Request processed without middleware blocking

---

#### PW1-029: CI + Supabase + Free Tier + No Error + Fresh Cache + Metadata + Protected
**Scenario**: CI environment accessing protected metadata endpoint successfully  
**Prerequisites**:
- CI environment with DEV_BYPASS_TOKEN set
- X-Hex-Test-Secret header matches DEV_BYPASS_TOKEN
- Protected endpoint requires auth

**Execution Steps**:
1. POST /api/metadata with X-Hex-Test-Secret header
2. Middleware checks for DEV_BYPASS_TOKEN match (timing-safe comparison)
3. Matches successfully, early return (NextResponse.next())
4. Request proceeds to handler
5. Metadata endpoint returns public data

**Expected Outcomes**:
- ✅ DEV_BYPASS_TOKEN recognized in CI
- ✅ Middleware returns early (explicit return statement)
- ✅ No fall-through to auth check
- ✅ Request completes successfully
- ✅ Bypass logged in breadcrumbs (safe for CI logs)

**Pass Criteria**:
- Response status: 200
- Metadata returned
- Bypass confirmed in logs
- No auth failure despite protected route

---

## Risk Assessment

### Uncovered Scenarios (Intentional)

**Low Risk** (3-4 more cases needed):
- Redis partial outage (some keys available, TTL variations)
- Concurrent quota updates (race conditions at 1M+ requests/day)
- OpenRouter model fallback chain (Haiku 4.5 → Haiku 3.5)

**Medium Risk** (5-6 more cases needed):
- Supabase connection pooling exhaustion (high concurrency)
- PDF generation timeout with large transcripts (> 50KB)
- Stripe webhook race conditions (duplicate charge attempts)
- Sentry event batching overflow (> 100 events/sec)

**High Risk** (7-8 more cases needed):
- Full database failover (RLS policy verification after restore)
- Edge function timeout cascades (Cloudflare Worker + Vercel)
- Multi-region deployment consistency (cache invalidation across regions)

**Why These Are Deferred**:
- Require specialized test environments (load testing infrastructure)
- Low probability in normal usage patterns
- Covered by chaos engineering phase (Phase 2, future)
- Risk acceptance documented in ADR-007 (Pairwise Test Scope)

---

## Implementation Roadmap

### Phase 1: Test Fixtures & Mocks (Next)
**Timeline**: 1-2 sessions  
**Deliverables**:
- `tests/fixtures/users.ts` — 5 test user profiles (free/pro/enterprise + admin)
- `tests/fixtures/videos.ts` — 10 pre-analyzed YouTube videos with cached markdown
- `tests/fixtures/auth-sessions.ts` — NextAuth + Supabase session templates
- `tests/mocks/openrouter.ts` — OpenRouter API mock with timeout simulation
- `tests/mocks/upstash.ts` — Redis mock with cache state simulation
- `tests/mocks/stripe.ts` — Stripe webhook mock fixtures

### Phase 2: Automated Tests (Following Phase 1)
**Timeline**: 2-3 sessions  
**Deliverables**:
- `tests/pairwise/index.spec.ts` — Playwright harness for all 38 cases
- `tests/pairwise/auth.spec.ts` — Authentication & authorization cases (PW1-003, -013, -003 variants)
- `tests/pairwise/errors.spec.ts` — Error handling + network failures (PW1-002, -037 variants)
- `tests/pairwise/quota.spec.ts` — Rate limiting & quota enforcement (PW1-006, -021 variants)
- `tests/pairwise/cache.spec.ts` — Cache behavior & fallback (PW1-025 variants)
- `tests/pairwise/middleware.spec.ts` — Routing & authorization (PW1-004, -029 variants)
- GitHub Actions job: `.github/workflows/pairwise-test.yml` (runs in CI on every PR)

### Phase 3: Coverage Reporting (Final)
**Timeline**: 1 session  
**Deliverables**:
- Coverage dashboard: test pass/fail rates per dimension
- Risk matrix: which dimensions are under-tested
- Regression tracker: historical pass rate trends
- Automated alerts: coverage drops below 95%

---

## Test Execution Instructions

### Local Development
```bash
# Run all 38 pairwise tests (sequential, ~45 minutes)
pnpm test:pairwise

# Run single category
pnpm test:pairwise --grep "happy-path"
pnpm test:pairwise --grep "error-handling"
pnpm test:pairwise --grep "auth"

# Run single test case
pnpm test:pairwise --grep "PW1-001"

# Run with coverage report
pnpm test:pairwise --coverage
```

### CI Environment
```bash
# Automatically triggered on PR
# Runs in parallel (8 workers) if GitHub Actions available
# Max 15 minute timeout per test case
# Requires: DEV_BYPASS_TOKEN, NEXT_PUBLIC_SUPABASE_URL (CI polyfill)
```

### Production Validation
```bash
# Run smoke tests against production (weekly)
pnpm test:pairwise:prod --target=https://hex-yt-intel.vercel.app

# Requires: PROD_AUTH_TOKEN (read-only test user)
# Validates 10 critical cases only (fast, non-destructive)
```

---

## Success Criteria

✅ **All 38 test cases pass** (zero failures)  
✅ **Coverage > 95%** (measured against dimension matrix)  
✅ **CI execution < 15 minutes** (parallel workers)  
✅ **Error scenarios validate graceful degradation** (no 5xx errors)  
✅ **Auth paths verified for bypass attempts** (IDOR prevention)  
✅ **Quota enforcement tested at boundaries** (free/pro/enterprise)  
✅ **Cache fallback logic verified** (stale-while-revalidate pattern)  
✅ **Middleware control flow validated** (explicit returns present)

---

## Dimension Definitions

### Environment
- **Production**: `NEXT_PUBLIC_VERCEL_ENV=production`, NODE_ENV=production
- **CI**: `GITHUB_ACTIONS=true` or `CI=true`, CI polyfill active
- **Development**: `NODE_ENV=development`, local Redis/Supabase

### Auth Method
- **Supabase**: OAuth via Supabase (Google, GitHub), session cookies
- **NextAuth**: NextAuth.js provider (Google, GitHub, generic), JWT tokens

### Rate Tier
- **Free**: 3 analyses/month, 1 export/month, 30 shared links/month
- **Pro**: Unlimited analyses, 10 exports/month, unlimited shares
- **Enterprise**: Unlimited everything, priority queue

### Error Type
- **None**: Happy path, no errors expected
- **Network Fail**: OpenRouter/Supabase/Redis timeout or 5xx response
- **Missing Data**: Incomplete request body, missing required fields
- **Invalid Input**: Malformed URL, invalid format parameter, out-of-range values

### Cache State
- **Fresh**: Cache populated < 5 minutes ago
- **Stale**: Cache populated 1-2 hours ago (within TTL)
- **Expired**: Cache past TTL, requires revalidation

### API Endpoint
- **analyses**: POST /api/analyses (create analysis)
- **search**: POST /api/analyses/search (semantic search)
- **metadata**: GET /api/metadata (public video info)
- **export**: POST /api/analyses/export (PDF generation)
- **share**: POST /api/analyses/share (generate share token)

### Middleware Path
- **Public**: No auth required (e.g., /api/auth, /api/health)
- **Protected**: Auth required, regular user (e.g., /api/analyses, /api/search)
- **Admin**: Auth + admin role required (e.g., /api/admin/stats)

---

## Document Metadata

**Location**: `/docs/testing/PAIRWISE_TEST_MATRIX_WAVES_1_4.md`  
**Version**: 1.0.0  
**Status**: READY FOR IMPLEMENTATION  
**Next Step**: Create test fixtures (Task #2)  
**Dependencies**: Playwright, Jest, TypeScript fixtures

---

*Generated during Wave 1-4 Stabilization Sprint (May 2026)*  
*Covers: Core Infrastructure (Wave 1) + API Routes (Wave 2) + Error Handling (Wave 3) + Security Hardening (Wave 4)*
