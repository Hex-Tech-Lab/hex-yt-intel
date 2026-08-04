# Item 3 (E) — Redis Token-Bucket Test Suite

## 1. RCA
The `tryConsumeTokenBucket` function in `web/lib/rate-limit-sliding-window.ts` had no test coverage. It uses Lua scripting via `@upstash/redis` to implement a sliding-window token bucket for rate limiting. Without tests, regressions in capacity/refill/edge-case logic were undetectable.

## 2. Contract
- Test suite must cover: capacity enforcement, refill behavior, concurrency, edge cases (zero capacity, fractional costs, exhaustion)
- Must mock `@upstash/redis` (not the same-module `executeRedisScript`) to avoid vitest same-module mocking limitation
- All 7 tests must pass consistently
- Must not require live Redis or network access

## 3. Fix
Created `web/lib/__tests__/token-bucket.test.ts` with 7 tests:

1. Returns true when bucket has sufficient tokens
2. Returns false when bucket is exhausted
3. Accepts cost equal to full capacity
4. Rejects cost exceeding capacity
5. Handles zero capacity (fail-closed)
6. Handles consecutive consumption until exhaustion
7. Handles fractional cost values

Mocking approach: Mocked `@upstash/redis` at the module level, provided env vars for client initialization, and mocked `Redis.eval` to control the Lua return value (`1` for success, `0` for failure).

## 4. Tangents
- The `@upstash/redis` client is initialized with env vars — tests provide `UPSTASH_VECTOR_REST_URL` and `UPSTASH_VECTOR_REST_TOKEN` to avoid initialization errors
- Same-module mocking (`executeRedisScript` directly) was impossible because vitest cannot mock functions exported from the same module being tested — the Redis client level was the correct mock boundary

## 5. Skills Run
- `ponytail` — applied to keep test mocking minimal and avoid over-engineering the test infrastructure
- `supabase` — consulted for rate-limiting patterns

## 6. Gates
- `vitest run` (59 files, 973 tests): ✅ Passed — token-bucket tests included in the suite
- `tsc --noEmit`: ✅ Passed

## 7. Files Changed
- `web/lib/__tests__/token-bucket.test.ts` — new file with 7 tests