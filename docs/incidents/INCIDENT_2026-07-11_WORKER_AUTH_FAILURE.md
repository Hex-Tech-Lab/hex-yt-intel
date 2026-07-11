# Incident: Worker Stream Authentication Failure (2026-07-11)

## Summary
Production analyses failing with `Worker stream X failed (401): invalid_signature` errors. All streaming analysis requests to Cloudflare worker are rejected during HMAC signature verification.

## Root Cause
HMAC secret mismatch between Vercel (signer) and Cloudflare Worker (verifier):
- **Vercel web client** signs tokens with `env.streamHmacSecret` (from web/lib/env.ts)
- **Cloudflare Worker** verifies with `env.STREAM_HMAC_SECRET` (from wrangler secrets)
- **Values do not match** → signature verification fails → 401 Unauthorized

## Impact
- ✋ ALL analysis synthesis blocked
- ✋ Chat grounding affected (cannot fetch fresh analyses)
- ✋ Dashboard shows perpetual "processing" state
- ~2 hours production downtime

## Verification Path
1. **Client signing** (web/lib/stream-token.ts:36)
   ```typescript
   const msg = `${videoId}:${analysisId}:${exp}:${modelStr}`;
   sig = await hmacHex(env.streamHmacSecret, msg);
   ```

2. **Worker verification** (worker/src/routes/analysis.ts:118)
   ```typescript
   const msg = `${videoId}:${analysisId}:${exp}:${modelStr}`;
   expected = await hmacHex(secret, msg); // secret = env.STREAM_HMAC_SECRET
   ```

3. **Mismatch detection** (worker/src/routes/analysis.ts:431-437)
   ```
   [analyze-llm-stream] stream signature rejected
   reason: invalid_signature
   keyFpPrimary: <fingerprint of STREAM_HMAC_SECRET>
   keyFpFallback: <fingerprint of DEV_HMAC_SECRET>
   ```

## Resolution Steps

### Immediate (Fix production)
1. Verify Vercel environment has `STREAM_HMAC_SECRET` set
   ```bash
   vercel env ls --environment production | grep STREAM_HMAC_SECRET
   ```

2. Get the fingerprint from Vercel logs
   - Go to: https://vercel.com/techhypexps-projects/hex-yt-intel/logs
   - Search for: "stream signature rejected"
   - Note the `keyFpPrimary` fingerprint

3. Verify Cloudflare Worker has matching secret
   - Option A: Redeploy worker with explicit secret sync
   ```bash
   # Copy the exact secret value from Vercel
   wrangler secret put STREAM_HMAC_SECRET --env production
   # Paste the exact same value from Vercel's environment
   ```

   - Option B: Regenerate and sync both sides
   ```bash
   # Generate new secret (use cryptographically secure method)
   openssl rand -base64 32  # e.g., outputs: "aBc12...XyZ="
   
   # Deploy to Vercel
   vercel env add STREAM_HMAC_SECRET --environment production
   # Paste the secret value
   
   # Deploy to Cloudflare
   wrangler secret put STREAM_HMAC_SECRET --env production
   # Paste the EXACT same value
   
   # Redeploy both
   vercel deploy --prod  # triggers Vercel rebuild
   wrangler deploy --env production  # triggers Cloudflare redeploy
   ```

### Verification
1. Check logs show `keyFpPrimary` matches on both sides
2. Make a test analysis request
3. Monitor Vercel/Cloudflare logs for success

### Long-term Prevention
- Add secret rotation audit to deployment checklist
- Monitor keyFpPrimary/keyFpFallback mismatch in alerts
- Add periodic secret sync verification test
- Document secret sync process in RUNBOOK

## Related Files
- web/lib/stream-token.ts — Client signing
- web/lib/env.ts — Vercel secret retrieval
- worker/src/routes/analysis.ts — Worker verification (lines 417-438)
- worker/src/crypto.ts — secretFingerprint diagnostic utility
- worker/wrangler.toml — Deployment configuration

## Metadata
- Detected: 2026-07-11 ~22:15 UTC
- Status: INVESTIGATING
- Severity: P0 (Production outage)
- Database fix: ✅ Applied transcript_hash migration
- Code fix: ✅ No code changes needed (signing/verification logic is correct)
- Environment fix: ⏳ PENDING (need secret sync)
