# HMAC Secret Deployment — Production Incident Fix

## Generated Secret

**Production HMAC Secret (Deploy to all environments):**
```
SSqdnev979rW2Z2b/x2J7UQ8/Veo1HfA21WU6L8elqU=
```

## Deployment Steps

### 1️⃣ Deploy to Vercel Production Environment

```bash
# Step A: Set the secret in Vercel production
vercel env add STREAM_HMAC_SECRET --environment production

# When prompted, paste:
# SSqdnev979rW2Z2b/x2J7UQ8/Veo1HfA21WU6L8elqU=

# Step B: Trigger production redeploy
vercel deploy --prod
```

**Verification:**
```bash
vercel env ls --environment production | grep STREAM_HMAC_SECRET
# Should show: STREAM_HMAC_SECRET (masked)
```

### 2️⃣ Deploy to Vercel Preview Environment

```bash
# Same secret for preview (testing purposes)
vercel env add STREAM_HMAC_SECRET --environment preview

# When prompted, paste:
# SSqdnev979rW2Z2b/x2J7UQ8/Veo1HfA21WU6L8elqU=
```

### 3️⃣ Deploy to Cloudflare Worker Production

```bash
# Deploy the secret to Cloudflare worker
cd worker
wrangler secret put STREAM_HMAC_SECRET --env production

# When prompted, paste:
# SSqdnev979rW2Z2b/x2J7UQ8/Veo1HfA21WU6L8elqU=

# Step B: Redeploy the worker
wrangler deploy --env production
```

**Verification:**
```bash
# Check Cloudflare dashboard or logs for successful deployment
# The secret itself won't be visible, but you can verify via secret fingerprint
```

## Verification & Testing

### 1. Check for secret fingerprint match

In Vercel logs, search for:
```
[analyze-llm-stream] stream signature rejected
```

The `keyFpPrimary` value should match the HMAC secret fingerprint. Both Vercel and Cloudflare should produce the same fingerprint when using the same secret.

### 2. Test an analysis request

1. Go to https://yt-intel.getmytestdrive.com/dashboard
2. Enter a YouTube video URL
3. Click "Analyze"
4. Check:
   - ✅ No "Worker stream X failed (401)" errors
   - ✅ Analysis progresses through dimensions
   - ✅ Vercel logs show successful persist
   - ✅ Cloudflare worker logs show no auth failures

### 3. Monitor logs for success

**Vercel Dashboard:**
- URL: https://vercel.com/techhypexps-projects/hex-yt-intel/logs
- Search for: `[analyze-llm-stream]`
- Should see successful persist messages, NOT `invalid_signature`

**Cloudflare Dashboard:**
- Go to Worker logs
- Should see successful stream requests, NOT `401` rejections

## Rollback (If needed)

If this secret doesn't work, revert to the previous secret:

```bash
# Revert Vercel production
vercel env add STREAM_HMAC_SECRET --environment production
# (Use previous secret value)
vercel deploy --prod

# Revert Cloudflare worker
cd worker
wrangler secret put STREAM_HMAC_SECRET --env production
# (Use previous secret value)
wrangler deploy --env production
```

## Post-Deployment

1. **Document the new secret** in secure vault (1Password, etc.)
2. **Update rotation schedule** (rotate every 90 days)
3. **Add monitoring alert** for signature verification failures
4. **Update team runbook** with this deployment procedure
5. **Close incident ticket** when all tests pass

## Timeline

- **Generated**: 2026-07-11 22:20 UTC
- **Created this document**: 2026-07-11 22:22 UTC
- **Deployment status**: READY FOR DEPLOYMENT

## Emergency Contact

If deployment fails or is blocked:
1. Check both services have `STREAM_HMAC_SECRET` set (not empty)
2. Verify character encoding (no line breaks, UTF-8)
3. Wait 5-10 minutes for cache refresh after deployment
4. If still failing, check `docs/incidents/INCIDENT_2026-07-11_WORKER_AUTH_FAILURE.md` for RCA
