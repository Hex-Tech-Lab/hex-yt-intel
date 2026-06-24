### First break point

- **stage**: embed webhook placeholder guard (QStash hop 2)
- **why it breaks**: The guard at `embed/route.ts:66-70` only checks `includes('placeholder')`. env.ts MOCK_DEFAULTS provide `UPSTASH_VECTOR_REST_TOKEN: 'mock-vector-token'` (L49), which does NOT contain `'placeholder'`. The guard passes, the webhook proceeds to call `generateEmbedding(markdown)` with the mock OpenRouter key, which fails after 3 retries × ~5s = ~15s. QStash retries 2 more times, consuming ~45s total per stuck task.
- **evidence**: `web/app/api/webhooks/embed/route.ts:66-70` (guard logic); `web/lib/env.ts:48-49` (MOCK_DEFAULTS)

### Fix applied

- **file**: `web/app/api/webhooks/embed/route.ts`
- **before**: lines 66-70 checked only `includes('placeholder')` for both URL and token
- **after**: lines 68-72 add `includes('mock')` checks for both URL and token
- **evidence**:
```
const isPlaceholder = 
  !vectorUrl || 
  vectorUrl.includes('placeholder') || 
  vectorUrl.includes('mock') ||
  !vectorToken || 
  vectorToken.includes('placeholder') ||
  vectorToken.includes('mock');
```
- **label**: code-observed

### Verification

- **what is now proven**: env.ts MOCK_DEFAULTS token `'mock-vector-token'` now triggers `isPlaceholder = true` at embed/route.ts:66 (token includes `'mock'`). In preview/CI, the webhook returns `skipped: true` (200) instead of attempting real OpenRouter calls with mock credentials. Downtime per stuck task drops from ~45s to ~0s.
- **what remains unknown**: whether the `UPSTASH_VECTOR_REST_URL` from MOCK_DEFAULTS (`'rested-ferret-38816-eu1-vector.upstash.io'`) is intentionally a real URL or also a mock — it contains neither `'placeholder'` nor `'mock'`, so the URL check still passes. If the URL is also a mock but the token is the only gate, the fix works because `isPlaceholder` is truthy on the token check alone.
- **what downstream behavior is still dependent on this fix**: the entire vector write path (generateEmbedding → vectorIndex.upsert) is still unverified at runtime. This fix only prevents the mock-credential failure path.

### Risks / follow-ups

- The env.ts `isPlaceholder` function (L55-65) checks `'dummy'`, `'placeholder'`, `'stub'`, `'ci-build'` but NOT `'mock'`. If `MOCK_DEFAULTS` patterns are the standard, env.ts `isPlaceholder` should be aligned with the embed webhook's guard in a future pass.
- No test exists for the embed webhook's placeholder guard behavior. Adding one would prevent regression.

### Conclusion

The embed webhook's placeholder guard now checks for `'mock'` in addition to `'placeholder'`. The earliest proven break point in the vector chain is fixed for preview/CI environments — the webhook returns `skipped: true` instead of attempting 3 retries of `generateEmbedding` with mock credentials.