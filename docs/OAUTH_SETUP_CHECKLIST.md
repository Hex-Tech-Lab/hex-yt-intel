# OAuth Setup Checklist: Step-by-Step Verification

**Status**: Pre-Setup  
**Last Updated**: 2026-05-15 20:25 EEST  
**Critical Items**: 🔴 **READ CRITICAL NOTES BEFORE STARTING**

---

## 🔴 CRITICAL NOTES (READ FIRST!)

1. **Google People API, NOT Google+ API**
   - ❌ Do NOT enable "Google+ API" (plus.googleapis.com) - it's deprecated
   - ✅ DO enable "Google People API" (people.googleapis.com)
   - 🔥 Wrong choice = OAuth fails with "scope not found" error

2. **Fail-Fast Verification After Each Step**
   - After enabling each API in Google Cloud Console
   - IMMEDIATELY run: `gcloud services list --enabled | grep [api-name]`
   - Do NOT wait 2-3 minutes - verify programmatically first
   - If not listed → API not actually enabled → retry

3. **Exact URL Matching Required**
   - Vercel NEXT_PUBLIC_SITE_URL = Single source of truth
   - Supabase Site URL must match exactly
   - Google OAuth Authorized Origins must include domain
   - Google OAuth Redirect URIs must include full path
   - Mismatch = `mismatched_redirect_uri` error (hard to debug)

---

## Phase 1: Google Cloud APIs (Manual Enablement)

### ✅ Step 1: Enable Cloud Resource Manager API

**In Google Cloud Console**:
1. Go to: https://console.cloud.google.com/apis/dashboard?project=gen-lang-client-0373183545
2. Click "Enable APIs and Services"
3. Search: "Cloud Resource Manager"
4. Click result (should say "Manage Google Cloud resources")
5. Click "Enable"
6. ✅ Wait 1-2 minutes

**Fail-Fast Verification** (run immediately after step above):
```bash
gcloud services list --enabled \
  --filter="name:cloudresourcemanager.googleapis.com" \
  --format="table(name)" \
  --project=gen-lang-client-0373183545
```

Expected: `cloudresourcemanager.googleapis.com` in output  
If missing: ❌ API not actually enabled → go back and try again

**Checkpoint**: 
- [ ] Cloud Resource Manager API shows in verification output

---

### ✅ Step 2: Enable Google People API (CRITICAL - NOT Google+)

**In Google Cloud Console**:
1. Go to: https://console.cloud.google.com/apis/dashboard?project=gen-lang-client-0373183545
2. Click "Enable APIs and Services"
3. Search: "Google People API" (NOT "Google+" or "Plus")
4. Click result (should say "Provides access to information about profiles and contacts")
5. Click "Enable"
6. ✅ Wait 1-2 minutes

**⚠️ VERIFY YOU DIDN'T ENABLE WRONG API**:
```bash
# Check if Google+ was accidentally enabled
gcloud services list --enabled \
  --filter="name:plus.googleapis.com" \
  --format="table(name)" \
  --project=gen-lang-client-0373183545
```

If Google+ API appears: **DISABLE IT IMMEDIATELY**
1. Go to APIs dashboard
2. Search "Google+ API"
3. Click it
4. Click "Disable"

**Fail-Fast Verification** (run after enabling People API):
```bash
gcloud services list --enabled \
  --filter="name:people.googleapis.com" \
  --format="table(name)" \
  --project=gen-lang-client-0373183545
```

Expected: `people.googleapis.com` in output  
If missing: ❌ API not actually enabled → try again

**Checkpoint**:
- [ ] Google People API shows in verification output
- [ ] Google+ API is NOT in verification output

---

### ✅ Step 3: Enable Google Cloud IAM API

**In Google Cloud Console**:
1. Go to: https://console.cloud.google.com/apis/dashboard?project=gen-lang-client-0373183545
2. Click "Enable APIs and Services"
3. Search: "Google Cloud Identity and Access Management API"
4. Click result
5. Click "Enable"
6. ✅ Wait 1-2 minutes

**Fail-Fast Verification**:
```bash
gcloud services list --enabled \
  --filter="name:iam.googleapis.com" \
  --format="table(name)" \
  --project=gen-lang-client-0373183545
```

Expected: `iam.googleapis.com` in output

**Checkpoint**:
- [ ] IAM API shows in verification output

---

### ✅ Verify All Three APIs at Once

```bash
gcloud services list --enabled \
  --filter="name:(cloudresourcemanager.googleapis.com OR people.googleapis.com OR iam.googleapis.com)" \
  --format="table(name)" \
  --project=gen-lang-client-0373183545
```

Expected output (exactly 3 lines):
```
NAME
cloudresourcemanager.googleapis.com
iam.googleapis.com
people.googleapis.com
```

**Checkpoint**:
- [ ] All three APIs listed
- [ ] No Google+ API listed
- [ ] Ready to proceed to Step 2

---

## Phase 2: OAuth Configuration in Google Cloud Console

### ✅ Step 4: Create OAuth 2.0 Consent Screen

**Prerequisites**: All 3 APIs enabled ✅

**In Google Cloud Console**:
1. Go to: https://console.cloud.google.com/apis/credentials/consent?project=gen-lang-client-0373183545
2. Click "Create" if not already created
3. **User Type**: Select "External"
4. **App Name**: `hex-yt-intel`
5. **User Support Email**: `kellybakri@gmail.com`
6. **Developer Contact Info**: `kellybakri@gmail.com`
7. **Scopes**:
   - Click "Add or Remove Scopes"
   - Search and add:
     - `userinfo.profile` (for user profile)
     - `userinfo.email` (for user email)
     - `openid` (for OpenID Connect)
   - Click "Update"
8. Review and click "Back to Dashboard"

**Checkpoint**:
- [ ] Consent screen configured
- [ ] Scopes include userinfo.profile, userinfo.email, openid
- [ ] Developer contact email set

---

### ✅ Step 5: Create OAuth 2.0 Credentials

**Prerequisites**: Consent screen created ✅

**In Google Cloud Console**:
1. Go to: https://console.cloud.google.com/apis/credentials?project=gen-lang-client-0373183545
2. Click "Create Credentials" (top)
3. Select "OAuth 2.0 Client IDs"
4. **Application Type**: "Web application"
5. **Name**: `hex-yt-intel-oauth`
6. **Authorized JavaScript Origins** (add each, press Enter after each):
   ```
   http://localhost:3000
   https://hex-yt-intel.vercel.app
   https://adnmbikaqnxivalqoild.supabase.co
   ```
7. **Authorized Redirect URIs** (add each):
   ```
   http://localhost:3000/auth/callback
   https://hex-yt-intel.vercel.app/auth/callback
   https://adnmbikaqnxivalqoild.supabase.co/auth/v1/callback
   ```
8. Click "Create"
9. **Copy and save the credentials**:
   - Client ID: `[copy this]`
   - Client Secret: `[copy this]`

**Save these immediately to a secure location** (don't commit to Git!)

**Checkpoint**:
- [ ] OAuth Client ID created
- [ ] OAuth Client Secret saved
- [ ] Both authorized origins configured
- [ ] All three redirect URIs configured

---

## Phase 3: Configure Supabase OAuth

### ✅ Step 6: Add Google OAuth Credentials to Supabase

**In Supabase Dashboard**:
1. Go to: https://app.supabase.com/project/adnmbikaqnxivalqoild/auth/providers
2. Click "Google"
3. Paste:
   - **Client ID**: [from Step 5]
   - **Client Secret**: [from Step 5]
4. Click "Save"

**Checkpoint**:
- [ ] Google OAuth provider configured in Supabase
- [ ] Client ID and Secret saved

---

### ✅ Step 7: Verify Supabase OAuth Redirect URIs

**In Supabase Dashboard**:
1. Go to: https://app.supabase.com/project/adnmbikaqnxivalqoild/settings/auth
2. Scroll to "Site URL"
3. Verify it shows: `https://hex-yt-intel.vercel.app`
4. Look for "Redirect URLs" section
5. Verify both are present:
   - `https://hex-yt-intel.vercel.app/auth/callback`
   - `https://adnmbikaqnxivalqoild.supabase.co/auth/v1/callback`

⚠️ If Site URL doesn't match, update it:
1. Click "Edit" next to Site URL
2. Change to: `https://hex-yt-intel.vercel.app`
3. Click "Save"

**Checkpoint**:
- [ ] Supabase Site URL = `https://hex-yt-intel.vercel.app`
- [ ] Redirect URLs are configured correctly

---

## Phase 4: Configure Vercel Environment Variables

### ✅ Step 8: Add Google Credentials to Vercel

**Prerequisites**: Supabase OAuth configured ✅

**Local development** (`.env.local`):
```env
NEXT_PUBLIC_GOOGLE_CLIENT_ID=[from Step 5]
GOOGLE_CLIENT_SECRET=[from Step 5]
```

**Production** (Vercel Dashboard):
1. Go to: https://vercel.com/dashboard
2. Select project: `hex-yt-intel`
3. Click "Settings"
4. Click "Environment Variables"
5. Add:
   - **Name**: `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
   - **Value**: [from Step 5]
   - **Environments**: Production, Preview, Development
   - Click "Save"
6. Repeat for `GOOGLE_CLIENT_SECRET`

**Checkpoint**:
- [ ] NEXT_PUBLIC_GOOGLE_CLIENT_ID in Vercel (all environments)
- [ ] GOOGLE_CLIENT_SECRET in Vercel (all environments)
- [ ] Vercel NEXT_PUBLIC_SITE_URL = `https://hex-yt-intel.vercel.app`

---

## Phase 5: Testing

### ✅ Step 9: Test Local Sign-In

**Prerequisites**: All above steps complete ✅

**Terminal**:
```bash
cd ~/projects/hex-yt-intel
pnpm dev
```

**Browser**:
1. Go to: http://localhost:3000/auth/signin
2. Click "Sign in with Google"
3. You should be redirected to Google login
4. Sign in with your Google account
5. You should be asked to grant permission
6. After approval, you should be redirected back to dashboard
7. You should see a user session in the browser (Network → Cookies)

**Checkpoint**:
- [ ] Local sign-in redirects to Google
- [ ] Google login accepts credentials
- [ ] Permission grant prompt appears
- [ ] After approval, redirected to dashboard
- [ ] No error messages

---

### ✅ Step 10: Test Production Sign-In

**Prerequisites**: 
- Local test passed ✅
- Vercel environment variables configured ✅

**Browser**:
1. Wait 2-3 minutes for Vercel to deploy (if you just added env vars)
2. Go to: https://hex-yt-intel.vercel.app/auth/signin
3. Click "Sign in with Google"
4. Follow same flow as local test

**Checkpoint**:
- [ ] Production sign-in works
- [ ] Google redirect works
- [ ] Session created after approval
- [ ] Redirects to dashboard
- [ ] No errors in browser console

---

## Phase 6: Post-Setup (Optional)

### ✅ Step 11: Downgrade Service Account (Optional but Recommended)

**After OAuth is working**:

1. Go to: https://console.cloud.google.com/iam-admin/iam?project=gen-lang-client-0373183545
2. Find service account: `agent-orchestrator@gen-lang-client-0373183545.iam.gserviceaccount.com`
3. Click the pencil icon to edit
4. Current role: `Editor`
5. Consider changing to: `Basic Editor` or custom role with minimal permissions
6. Click "Save"

**Why**: Service account doesn't need broad project management access after OAuth setup.

**Checkpoint**:
- [ ] Service account role downgraded (optional)

---

## Troubleshooting

### Error: "scope not found" or 403 Forbidden

**Cause**: Google+ API enabled instead of Google People API

**Fix**:
1. Disable Google+ API in Google Cloud Console
2. Enable Google People API
3. Retry OAuth flow

### Error: "mismatched_redirect_uri"

**Cause**: Redirect URI doesn't match exactly in all three places

**Fix**:
1. Check Supabase Site URL = `https://hex-yt-intel.vercel.app`
2. Check Google OAuth redirect URI = `https://hex-yt-intel.vercel.app/auth/callback`
3. Check Vercel NEXT_PUBLIC_SITE_URL = `https://hex-yt-intel.vercel.app`
4. All three must match exactly (no trailing slashes, exact domain)

### Error: "API not enabled" or "Service not found"

**Cause**: API enablement didn't propagate

**Fix**:
1. Run verification command: `gcloud services list --enabled | grep [api-name]`
2. If not listed, wait 5 minutes and try again
3. If still not listed, try disabling and re-enabling in console

---

## Summary

✅ **If all checkpoints are marked**: OAuth is fully configured and tested

⏳ **Next steps after OAuth is working**:
1. Apply database security fixes (see SECURITY_FIXES_REQUIRED.md)
2. Set up Facebook OAuth (if needed)
3. Test analyze API with authenticated user
4. Deploy to production

---

**Questions?** Refer to:
- Full setup guide: [GOOGLE_OAUTH_SETUP.md](GOOGLE_OAUTH_SETUP.md)
- Security fixes: [SECURITY_FIXES_REQUIRED.md](SECURITY_FIXES_REQUIRED.md)
- Architecture: [[auth_blocker_resolution]] (memory file)
