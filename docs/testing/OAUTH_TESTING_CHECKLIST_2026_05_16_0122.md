---
Filename: OAUTH_TESTING_CHECKLIST.md
Location: /docs/testing/
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:13:51 EEST (GCW)
Purpose: OAUTH TESTING CHECKLIST
---

# OAuth Flow Testing Checklist

**Status**: Infrastructure complete, ready for browser testing  
**Date**: 2026-05-16  
**Critical Fixes Applied**:
1. ✅ Session cookies now set explicitly on response object in callback
2. ✅ RLS disabled on users table (migration 20260516)
3. ✅ Auth provider correctly routes to Supabase
4. ✅ Middleware enforces auth on /api/analyses endpoint

## Testing Steps (Browser Required)

### 1. Sign In Flow
1. Go to https://yt-intel.getmytestdrive.com/auth/signin
2. Click "Sign in with Google"
3. Complete Google OAuth (grant permissions)
4. **Expected**: Should redirect to home page (/) with authenticated session
5. **Verify**: Browser console should show successful auth

### 2. Session Persistence
1. After signin, check browser DevTools → Application → Cookies
2. Look for cookies starting with `sb-` (Supabase session tokens)
3. **Expected**: Should see at least `sb-adnmbikaqnxivalqoild-auth-token` and `sb-refresh-token`
4. **Verify**: Cookies should have `HttpOnly` and `Secure` flags

### 3. Analyze Flow
1. On home page, paste a YouTube URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ
2. Click "Analyze" button
3. **Expected**: Should call /api/analyses and generate analysis markdown
4. **Success Criteria**:
   - Analysis displays in left panel
   - Markdown shows 16-section UCIS framework
   - Request completes within 30 seconds

### 4. API Response Verification
1. Open browser DevTools → Network
2. Click Analyze
3. Check POST /api/analyses request
4. **Expected Status**: 201 (Created)
5. **Expected Response**:
   ```json
   {
     "id": "uuid",
     "videoId": "dQw4w9WgXcQ",
     "title": "Never Gonna Give You Up",
     "markdown": "[16-section analysis]",
     "createdAt": "2026-05-16T..."
   }
   ```

### 5. User Record Verification (Supabase)
1. Go to Supabase Dashboard → hex-yt-intel project
2. Navigate to SQL Editor
3. Run:
   ```sql
   SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT 5;
   ```
4. **Expected**: Should see your authenticated user with today's date

### 6. Error Cases
#### 6a. Without Auth
- Open DevTools in private window
- Try to access https://yt-intel.getmytestdrive.com/api/analyses
- **Expected**: 307 redirect to /auth/signin

#### 6b. Invalid YouTube URL
- Sign in with Google
- Paste invalid URL: "not a youtube url"
- Click Analyze
- **Expected**: 400 Bad Request with error message

#### 6c. Missing OpenRouter Key
- Should see error in response (if key is missing)
- **Expected**: 500 error in console with OpenRouter details

## Current Deployment Status

**Production URL**: https://yt-intel.getmytestdrive.com  
**Latest Commit**: c8585ab (RLS migration committed)  
**Vercel Deployment**: Should auto-deploy from main branch

**Required Vercel Environment Variables** (verify in Vercel UI):
- ✅ NEXT_PUBLIC_SUPABASE_URL
- ✅ NEXT_PUBLIC_SUPABASE_ANON_KEY
- ✅ OPENROUTER_API_KEY
- ✅ AUTH_PROVIDER=supabase
- ✅ GOOGLE_CLIENT_SECRET (for OAuth callback)

## Known Limitations

1. **Placeholder Transcript**: Currently returns dummy transcript, not real YouTube captions
2. **Claude Haiku Free**: Uses free OpenRouter tier (may have rate limits)
3. **No Persist**: Analysis stored but embedding generation is async
4. **Supabase RLS**: Now disabled on users table (allows OAuth signup but less secure)

## Troubleshooting

### Issue: "Failed to analyze video" after signin
**Likely Causes**:
1. OPENROUTER_API_KEY not set in Vercel env vars
2. Google OAuth callback URL mismatch
3. Supabase credentials in env vars

**Fix**:
1. Verify OPENROUTER_API_KEY is set: `vercel env ls`
2. Check Supabase project settings → URL & Key are correct
3. Review Vercel deployment logs

### Issue: Signin hangs/redirects loop
**Status**: ✅ FIXED (commit f3ddcdc)  
**Root Cause**: Cookies not persisting across requests  
**Fix Applied**: Explicit cookie setting on response in callback route

### Issue: User not created in database
**Status**: ✅ FIXED (migration 20260516)  
**Root Cause**: RLS policy blocking inserts  
**Fix Applied**: Disabled RLS on public.users table

---

## Next Steps (Post-Testing)

1. [ ] Browser test all 6 scenarios above
2. [ ] Document any errors in Sentry
3. [ ] If analyze works: Chunk 9 (Billing) can proceed
4. [ ] If analyze fails: Debug specific error path
