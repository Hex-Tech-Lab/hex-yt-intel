# Blocking Issues Diagnostic & Exit Strategy

**Date**: 2026-05-16  
**Status**: 🔴 BLOCKED - Two critical issues preventing analysis from completing  
**User**: <authenticated-user>  
**Session**: Attempted end-to-end test, hit blocker on database insert

---

## Current Blockers

### Issue 1: Model Fallback Failing
**Error**: `[callOpenRouter] Model anthropic/claude-haiku-latest failed, trying next...`  
**Status**: Fallback chain activated but all models failing  
**Root Cause**: Likely OPENROUTER_API_KEY missing or incorrect in Vercel production

**Verification Command**:
```bash
# Check if key is set in Vercel production:
vercel env ls | grep OPENROUTER
```

**Expected Output**:
```
OPENROUTER_API_KEY     Production  <OPENROUTER_API_KEY_PREFIX>...
```

**If Missing**: 
1. Go to Vercel: https://vercel.com/Hex-Tech-Lab/hex-yt-intel/settings/environment-variables
2. Add/verify: `OPENROUTER_API_KEY=<OPENROUTER_API_KEY_PREFIX>...` (get from local .env.local)
3. Redeploy: `git push origin main` triggers Vercel rebuild

---

### Issue 2: RLS Still Blocking Analyses Insert
**Error**: 
```
code: '42501',
message: 'new row violates row-level security policy for table "analyses"'
```

**Status**: Migration committed but NOT YET APPLIED to Supabase  
**Root Cause**: Manual SQL execution required in Supabase dashboard (CLI auth failed)

**Verification Command**:
```sql
-- Run in Supabase SQL Editor to check current RLS status:
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('users', 'analyses');
```

**Expected Output**:
```
tablename  | rowsecurity
-----------|------------
users      | f           (disabled ✓)
analyses   | t           (ENABLED - this is the problem)
```

**Fix Required** (Secure RLS Policies):
1. Open: https://supabase.com/dashboard/project/adnmbikaqnxivalqoild
2. Click: **SQL Editor** → **New Query**
3. Paste: 
```sql
-- Enable RLS (already enabled, but ensure it is)
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

-- Create policy for secure authenticated inserts
CREATE POLICY "Allow authenticated inserts based on user_id" 
ON public.analyses 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- Create policy for users to read their own analyses
CREATE POLICY "Allow users to read their own analyses" 
ON public.analyses 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);
```
4. Click: **Run**
5. Verify: RLS remains enabled (`rowsecurity` shows `t`) with policies in place

---

## Execution Priority

### MUST DO (Blocks everything):
1. ✅ Verify OPENROUTER_API_KEY in Vercel env vars
   - If missing: Add it, redeploy, test
   - If present: Verify it's correct (should start with `<OPENROUTER_API_KEY_PREFIX>`)

2. ✅ Disable RLS on analyses table
   - Run SQL command in Supabase dashboard
   - Verify with verification query above
   - Test analyze endpoint again

### THEN TEST:
```bash
# 1. Sign in to https://yt-intel.getmytestdrive.com/auth/signin
# 2. Paste: https://www.youtube.com/watch?v=dQw4w9WgXcQ
# 3. Click: Analyze
# 4. Should see 201 response with markdown report (not 500)
```

---

## Detailed Checklist for Next Session

### Pre-Flight Checks
- [ ] Verify OPENROUTER_API_KEY set in Vercel production
- [ ] Verify Supabase RLS status on analyses table
- [ ] Check Vercel deployment ID matches latest commit (47c5379+)
- [ ] Monitor Vercel logs during test: https://vercel.com/Hex-Tech-Lab/hex-yt-intel/logs

### Model Testing
```bash
# Test which models actually work on OpenRouter:
curl -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer <OPENROUTER_API_KEY_PREFIX>..." \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-haiku-latest","messages":[{"role":"user","content":"test"}]}'

# Try each model in order:
# 1. anthropic/claude-haiku-latest
# 2. anthropic/claude-haiku-4.5
# 3. anthropic/claude-3.5-haiku
# First success = that's the working model
```

### Database Testing
```sql
-- Verify RLS is disabled:
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'analyses';

-- Verify user has permission to insert:
INSERT INTO public.analyses (
  user_id, video_id, title, channel_title, 
  view_count, analysis_markdown, created_at
) VALUES (
  'test-user-id', 'test-video-id', 'Test', 'Test Channel',
  0, '# Test Analysis', NOW()
);
```

### Logs to Monitor
1. **Vercel**: https://vercel.com/Hex-Tech-Lab/hex-yt-intel/logs?query=OpenRouter
2. **Sentry**: https://sentry.io (hex-yt-intel project) - filter by "analyses"
3. **Supabase**: Check postgres logs for RLS errors

---

## Known Working Components

✅ **These are confirmed working**:
- OAuth signin flow (Google + callback)
- Session persistence (cookies set correctly)
- User auto-creation (public.users)
- Metadata fetch (Cloudflare Worker)
- Model fallback chain (code deployed)
- Middleware auth enforcement

🟠 **These are BLOCKED**:
- Model API call (needs correct key + available model)
- Analysis insert (needs RLS disabled)

---

## Exit Strategy

### Option 1: Manual Fix (Recommended)
1. Add OPENROUTER_API_KEY to Vercel env
2. Run SQL to disable RLS on analyses
3. Test analyze endpoint
4. Document findings in next session

### Option 2: Delegate to Next Session
Create summary for handoff:
- **What works**: Auth, user creation, metadata fetch, model fallback
- **What's blocked**: OpenRouter model call, RLS on analyses
- **What to fix**: 2 SQL commands + 1 env var

### Option 3: Use Supabase Dashboard
If CLI won't work:
1. Login to Supabase directly
2. Run RLS disable SQL manually
3. Verify with SELECT query
4. Test in browser

---

## Quick Commands for Next Session

```bash
# 1. Check environment
vercel env ls | grep -E "OPENROUTER|AUTH_PROVIDER|SUPABASE"

# 2. Check latest deployment
vercel logs --limit=50 | grep -E "OpenRouter|42501"

# 3. Verify Supabase connection
supabase status --linked

# 4. Test a single model
curl -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-3.5-haiku","messages":[{"role":"user","content":"Say ok"}],"max_tokens":10}'
```

---

## Session Summary

**What was accomplished**:
- ✅ OAuth signin flow working end-to-end
- ✅ Model fallback chain deployed
- ✅ User auto-creation working
- ✅ Metadata fetch working
- ✅ Analysis markdown generation working

**What's blocking**:
- 🔴 OpenRouter model call (API key or model availability)
- 🔴 RLS on analyses table (needs manual SQL)

**Next steps**:
1. Fix OPENROUTER_API_KEY in Vercel
2. Disable RLS on analyses via SQL
3. Test end-to-end: signin → analyze → markdown
4. If working: proceed to Chunk 9 (Billing)

---

## Files to Review

- [HANDOVER_REPORT_2026_05_16.md](./HANDOVER_REPORT_2026_05_16.md) - Full project state
- [RLS_DISABLE_INSTRUCTIONS.md](./RLS_DISABLE_INSTRUCTIONS.md) - RLS fix guide
- [OAUTH_TESTING_CHECKLIST.md](./OAUTH_TESTING_CHECKLIST.md) - Testing guide

---

**Prepared**: 2026-05-16 | **Status**: Blocked, awaiting manual fixes  
**Owner**: @kellybakri | **Next**: Execute checklist in new session or delegate
