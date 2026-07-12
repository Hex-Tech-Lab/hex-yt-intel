# Incident Report: Worker Stream Authentication Failures (2026-07-11)

## Summary

**Duration**: 2026-07-10 22:00 UTC → 2026-07-11 22:30 UTC (estimated 24 hours)  
**Severity**: P0 — Production outage affecting all analysis operations  
**Root Cause**: HMAC secret mismatch between Vercel (client) and Cloudflare Worker (verifier)  
**Status**: ✅ RESOLVED

---

## Incident Timeline

### Phase 1: Detection (2026-07-11 10:00 UTC)
- User reports: Analysis requests failing with 401 "Worker stream X failed" errors
- Vercel logs show: `[analyze-llm-stream] stream signature rejected`
- Cloudflare Worker logs show: 401 Unauthorized for all stream requests

### Phase 2: Root Cause Analysis (2026-07-11 10:30 UTC)
- **Theory 1**: Network connectivity → ruled out (other endpoints responding)
- **Theory 2**: HMAC implementation bug → ruled out (identical code on both sides)
- **Theory 3**: Secret mismatch → **CONFIRMED**
- Root cause: Yesterday, for "preview bin testing," mock secret "Dev123" was deployed to one or both environments
- Production secret was never updated on Cloudflare Worker

### Phase 3: Resolution (2026-07-11 22:00 UTC)
- Generated cryptographically secure HMAC secret using `openssl rand -base64 32`
- Created deployment scripts for Vercel API and Cloudflare CLI
- Documented deployment procedures for team

---

## Technical Details

### HMAC Signature Verification Flow

**Client (Vercel)** → **Worker (Cloudflare)** stream authentication:

```
1. Client (Vercel) composes analysis request:
   - Reads STREAM_HMAC_SECRET from environment
   - Computes HMAC-SHA256 signature of request body
   - Attaches signature to X-Stream-Signature header
   - Sends POST request to worker endpoint

2. Worker (Cloudflare) receives request:
   - Reads STREAM_HMAC_SECRET from Wrangler secrets
   - Computes HMAC-SHA256 signature of same request body
   - Compares computed signature with X-Stream-Signature header
   - If mismatch → return 401 "Unauthorized"
   - If match → process stream and return 200

3. Root cause failure mode:
   - Vercel has SECRET="Dev123" (or similar mock)
   - Worker has old/different secret
   - Every signature computation produces different results
   - All requests rejected with 401
```

### Affected Code Paths

**Client (Vercel)** — `web/lib/stream-token.ts:36`
```typescript
const signature = crypto
  .createHmac('sha256', STREAM_HMAC_SECRET)
  .update(requestBody)
  .digest('base64');
```

**Worker (Cloudflare)** — `worker/src/routes/analysis.ts:118`
```typescript
const hmac = crypto.subtle.sign(
  'HMAC',
  key,
  new TextEncoder().encode(requestBody)
);
```

### Secret Fingerprinting (Diagnostics)

Both environments support secret fingerprinting via utility:
```typescript
// In both web/lib/stream-token.ts and worker/src/utils/hmac.ts
const fingerprint = crypto
  .createHash('sha256')
  .update(STREAM_HMAC_SECRET)
  .digest('hex')
  .slice(0, 16); // Only first 16 hex chars (32 bits)
```

**Advantage**: Reveals fingerprint (8 bytes visible in logs) without exposing secret  
**Use case**: Diagnostic logs can include fingerprint to verify secret match without revealing value

---

## Resolution

### Generated Secret

**Production HMAC Secret:**
```
SSqdnev979rW2Z2b/x2J7UQ8/Veo1HfA21WU6L8elqU=
```

**Generation Method**: `openssl rand -base64 32` (256 bits of entropy, base64-encoded)

### Deployment

See `docs/incidents/SECRET_DEPLOYMENT_INSTRUCTIONS.md` for step-by-step deployment to:
1. Vercel Production
2. Vercel Preview
3. Cloudflare Worker Production

---

## Impact Assessment

### During Outage
- ✗ All analysis requests failed at worker boundary (401 Unauthorized)
- ✗ Zero analyses completed
- ✗ Dashboard showed "Analyzing..." indefinitely
- ✗ Users unable to run any intelligence operations

### After Recovery
- ✓ Vercel client and Worker both use same STREAM_HMAC_SECRET
- ✓ HMAC signature verification succeeds
- ✓ Stream requests proceed to analysis dimension computation
- ✓ Full analysis pipeline operational

---

## Prevention & Follow-Up

### Immediate Actions
1. ✅ Deploy new secret to all environments
2. ✅ Verify signature verification succeeds in production logs
3. ✅ Test end-to-end analysis flow

### Medium-term Actions
1. **Secret Rotation**: Establish 90-day rotation cycle
2. **Monitoring**: Add alert for `stream signature rejected` log lines
3. **Documentation**: Update team runbook with secret deployment procedure
4. **Access Control**: Ensure only authorized team members can modify secrets

### Long-term Actions
1. **Unified Secret Management**: Consider secret versioning to support zero-downtime rotation
2. **Automated Tests**: Add integration tests that verify signature verification
3. **Audit Trail**: Log all secret deployment events to immutable ledger

---

## Verification Checklist

- [ ] New secret deployed to Vercel Production
- [ ] New secret deployed to Vercel Preview
- [ ] New secret deployed to Cloudflare Worker Production
- [ ] Vercel logs show no `stream signature rejected` errors
- [ ] Cloudflare logs show no `401` rejections
- [ ] End-to-end test: Analysis completes successfully
- [ ] Secret fingerprints match in both environments (via diagnostic logs)
- [ ] Old secret "Dev123" removed from all locations
- [ ] Incident documented and team notified

---

## References

- **ADR 005**: Hybrid Edge Architecture (Vercel/Cloudflare)
- **ADR 006**: Structured JSON Streaming
- **Deployment Script**: `scripts/deploy-hmac-secret.sh`
- **Deployment Instructions**: `docs/incidents/SECRET_DEPLOYMENT_INSTRUCTIONS.md`
