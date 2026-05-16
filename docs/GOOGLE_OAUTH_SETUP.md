# Google OAuth Setup Guide for hex-yt-intel

## Service Account Configuration

**Service Account Email**: `agent-orchestrator@hex-yt-intel.iam.gserviceaccount.com`  
**Project ID**: `283991426265` (display: `hex-yt-intel`)  
**Key Location**: `/home/kellyb_dev/.config/gcloud/hex-yt-intel-new-key.json` (chmod 600)

### Prerequisites

#### 1. Google Cloud APIs (✅ ALL LIVE — 2026-05-15T21:25 EEST)

apis verified via `gcloud services list --enabled`:

| API | ID | Status |
|---|---|---|
| Cloud Resource Manager API | `cloudresourcemanager.googleapis.com` | ✅ Enabled (project 283991426265) |
| **Google People API** | **`people.googleapis.com`** | ✅ Enabled (NOT Google+) |
| Google Cloud IAM API | `iam.googleapis.com` | ✅ Enabled |

To verify manually:
```bash
gcloud services list --enabled \
  --filter="name:(cloudresourcemanager.googleapis.com OR people.googleapis.com OR iam.googleapis.com)" \
  --format="table(name)" \
  --project=283991426265
```

#### 2. Service Account Permissions

`agent-orchestrator@hex-yt-intel.iam.gserviceaccount.com` has **Owner + Service Usage Admin** roles (created 2026-05-15).  
Full credential was generated 2026-05-15T21:00 EEST.

---

### Setup Steps

#### Step 1: Authenticate with Service Account (One-time)

```bash
# Correct key file:
gcloud auth activate-service-account --key-file=/home/kellyb_dev/.config/gcloud/hex-yt-intel-new-key.json
gcloud config set project 283991426265
gcloud auth list
```

Expected output:
```
ACTIVE  ACCOUNT
*       agent-orchestrator@hex-yt-intel.iam.gserviceaccount.com
```

#### Step 2: Create OAuth 2.0 Consent Screen

Navigate to: https://console.cloud.google.com/apis/credentials/consent?project=283991426265

**Configuration**:
- **User Type**: External
- **App Name**: hex-yt-intel
- **User Support Email**: kellybakri@gmail.com
- **Developer Contact**: kellybakri@gmail.com

**Scopes Required**:
- `userinfo.profile`
- `userinfo.email`
- `openid`

#### Step 3: Create OAuth 2.0 Credentials

Navigate to: https://console.cloud.google.com/apis/credentials?project=283991426265

**Create → OAuth 2.0 Client IDs**:
- **Application Type**: Web application
- **Name**: hex-yt-intel-oauth
- **Authorized JavaScript origins**:
  ```
  http://localhost:3000
  https://hex-yt-intel.vercel.app
  https://adnmbikaqnxivalqoild.supabase.co
  ```
- **Authorized redirect URIs**:
  ```
  http://localhost:3000/auth/callback
  https://hex-yt-intel.vercel.app/auth/callback
  https://adnmbikaqnxivalqoild.supabase.co/auth/v1/callback
  ```

**Output** (save these):
- Client ID: `[GOOGLE_CLIENT_ID]`
- Client Secret: `[GOOGLE_CLIENT_SECRET]`

#### Step 4: Add Credentials to Project

**Local Development** (`.env.local`):
```env
GOOGLE_CLIENT_ID=[paste from step 3]
GOOGLE_CLIENT_SECRET=[paste from step 3]
```

**Production** (Vercel environment variables):
```bash
vercel env add GOOGLE_CLIENT_ID [paste]
vercel env add GOOGLE_CLIENT_SECRET [paste]
```

Also add to **Supabase** → Authentication → OAuth Providers → Google:
- Client ID: [paste]
- Client Secret: [paste]

#### Step 5: Verify Configuration

**Local**:
```bash
pnpm dev
# Visit http://localhost:3000/auth/signin
# Click "Sign in with Google"
# Should redirect to Google login
```

**Production**:
```bash
# Wait for Vercel deployment
# Visit https://hex-yt-intel.vercel.app/auth/signin
# Click "Sign in with Google"
# Should redirect to Google login
```

## Programmatic Management (Advanced)

Once the APIs are enabled, you can manage OAuth credentials via gcloud CLI:

```bash
# List existing OAuth clients
gcloud oauth-config list

# Create new OAuth client (if needed)
gcloud oauth-config create \
  --display-name="hex-yt-intel" \
  --redirect-uris="https://hex-yt-intel.vercel.app/auth/callback"

# Update existing client
gcloud oauth-config update [CLIENT_ID] \
  --redirect-uris="https://hex-yt-intel.vercel.app/auth/callback"
```

## Troubleshooting

### Error: Auth callback lands on 404 after Google sign-in

**Symptom**: OAuth succeeds, browser redirects to `/dashboard` → 404  
**Cause**: `web/app/auth/callback/route.ts` lines 8 and 46 fallback to `'/dashboard'`, which has no page  
**Fix (applied commit `efea2c1`)**: Changed both fallbacks to `'/'`. Root page is live at `web/app/page.tsx`.

**File reference**: `web/app/auth/callback/route.ts`  
```typescript
// Line 8 — before
const next = searchParams.get('next') || '/dashboard';
// Line 8 — after
const next = searchParams.get('next') || '/';

// Line 46 — before
const safeNext = decodedNext.startsWith('/') ? decodedNext : '/dashboard';
// Line 46 — after
const safeNext = decodedNext.startsWith('/') ? decodedNext : '/';
```

### Error: "Cloud Resource Manager API has not been used"

**Solution**: Enable the API
1. Visit: https://console.cloud.google.com/apis/api/cloudresourcemanager.googleapis.com
2. Click "Enable"
3. Wait 2-3 minutes for propagation
4. Retry the command

### Error: "Forbidden: User does not have permission"

**Solution**: Grant service account the Editor role
1. IAM & Admin → Service Accounts
2. Select `agent-orchestrator`
3. Grant role: `Editor`

### OAuth Redirect Error (mismatched_redirect_uri)

**Solution**: Verify redirect URIs match exactly:
- In Google Cloud Console (Step 3): `https://hex-yt-intel.vercel.app/auth/callback`
- In Supabase settings: Ensure both Google origin and redirect URI are configured
- In Vercel: NEXT_PUBLIC_SITE_URL = `https://hex-yt-intel.vercel.app`
- Check the "Patterns to Adopt" section above for exact matching requirements

### OAuth Scope Error (scope not found / 403 Forbidden)

**Symptom**: After clicking "Sign in with Google", you see error about invalid scopes

**Cause**: Google+ API enabled instead of Google People API

**Solution**:
1. Go to Google Cloud Console → APIs & Services → Enabled APIs
2. Search for "Google+"
3. If "Google+ API" is listed, disable it
4. Search for "Google People"
5. Enable "Google People API"
6. Wait 2-3 minutes for propagation
7. Run verification command: `gcloud services list --enabled | grep people.googleapis.com`
8. Retry OAuth sign-in

**Why this happens**: The deprecated Google+ API doesn't have the necessary user profile scopes. Only Google People API provides `userinfo.profile` and `userinfo.email` scopes needed for Supabase OAuth callback.

## Security Notes

⚠️ **Key Management**:
- The service account key is stored at `/home/kellyb_dev/.config/gcloud/hex-yt-intel-new-key.json`
- **Never commit this to Git** (it's in `.gitignore`)
- **Rotate the key annually** (Google Cloud best practice)

⚠️ **OAuth Secrets**:
- Client secrets are stored in Vercel environment variables
- Never log or expose them
- Use `vercel env pull` to sync locally (don't commit)

## References

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Supabase OAuth Providers](https://supabase.com/docs/guides/auth/social-login)
- [gcloud OAuth Config](https://cloud.google.com/sdk/gcloud/reference/oauth-config)
- [Google Cloud Console](https://console.cloud.google.com)

## PATTERNS TO ADOPT (Critical Best Practices)

### 1. Fail-Fast Enablement Verification

After enabling each API, verify it's actually enabled **before proceeding**:

```bash
# After enabling each API, run this immediately (don't wait 2-3 min to test)
gcloud services list --enabled \
  --filter="name:(cloudresourcemanager.googleapis.com OR people.googleapis.com OR iam.googleapis.com)" \
  --format="table(name)" \
  --project=283991426265
```

**Why**: API propagation can fail silently. Google Cloud Console might say "enabled" but backend services haven't synced yet. Verify programmatically first.

### 2. Stateless OAuth Configuration

Before enabling OAuth, ensure these match **exactly**:

1. **Vercel environment variable**:
   ```bash
   vercel env list | grep NEXT_PUBLIC_SITE_URL
   # Should show: https://hex-yt-intel.vercel.app
   ```

2. **Supabase Site URL** (Settings → General):
   ```
   https://hex-yt-intel.vercel.app
   ```

3. **Google OAuth Authorized JavaScript Origins**:
   ```
   https://hex-yt-intel.vercel.app
   ```

4. **Google OAuth Authorized Redirect URIs**:
   ```
   https://hex-yt-intel.vercel.app/auth/callback
   https://adnmbikaqnxivalqoild.supabase.co/auth/v1/callback
   ```

**Why**: Mismatched redirect URIs cause `mismatched_redirect_uri` errors that are hard to debug. Single source of truth: Vercel's NEXT_PUBLIC_SITE_URL.

### 3. Service Account Lifecycle Management

**During setup** (now):
- Service Account role: `Editor` ✅ (minimum for OAuth credential creation)

**After OAuth setup is complete**:
- Consider downgrading to `Basic Editor` or custom role with minimal permissions
- Service Account should NOT have `Owner` or `Admin` roles long-term
- Review service account permissions quarterly

**Why**: Principle of least privilege. Once OAuth credentials are created, the service account doesn't need broad project management access.

## API ENABLEMENT STATUS TRACKER

**Completion Checklist** (use this exactly):
- [ ] Cloud Resource Manager API enabled ✅
- [ ] **Google People API** enabled (NOT "Google+ API") ✅
- [ ] Cloud IAM API enabled ✅
- [ ] OAuth 2.0 Consent Screen configured (Step 2)
- [ ] OAuth 2.0 Credentials created (Step 3)
- [ ] Credentials added to Supabase (Step 4)
- [ ] Credentials added to Vercel (Step 4)
- [ ] Verify NEXT_PUBLIC_SITE_URL matches Supabase Site URL
- [ ] Sign-in flow tested locally (Step 5)
- [ ] Sign-in flow tested in production (Step 5)

**API Enablement Timeline (2026-05-15):**
| Time (EEST) | Action |
|---|---|
| 21:15 | Identified two GCP projects — wrong SA was active |
| 21:18 | Wrote `hex-yt-intel-new-key.json` for `agent-orchestrator@hex-yt-intel` |
| 21:25 | All three APIs enabled via `gcloud services enable` (project `283991426265`) |
| 21:36 | Google OAuth Client ID created via console; Vercel env vars set |
| 21:58 | Identified `/dashboard` 404 — callback fallback targets non-existent route |
| 22:01 | Commit `efea2c1` — fixed callback fallback to `/` |
| 22:06 | `web/middleware.ts` confirmed — only protects `/analyses` and `/api` |

**Completion Checklist** (use this exactly):
- [x] Cloud Resource Manager API enabled ✅
- [x] Google People API enabled (NOT Google+ API) ✅
- [x] Google Cloud IAM API enabled ✅
- [x] OAuth 2.0 Consent Screen configured ✅
- [x] OAuth 2.0 Credentials created ✅
- [x] Credentials added to Vercel (production env vars) ✅
- [x] Auth callback 404 fixed (`web/app/auth/callback/route.ts` → `'/'`) ✅
- [ ] Verify NEXT_PUBLIC_SITE_URL matches Supabase Site URL (pending user test)
- [ ] Sign-in flow tested in production (pending user test at `https://hex-yt-intel.vercel.app/auth/signin`)

---

## Support

For issues:
1. Check the Troubleshooting section above
2. Verify all URIs are correct (copy-paste carefully!)
3. **Ensure APIs are enabled** (use checklist above)
4. Check service account has Owner + Service Usage Admin roles (✅ confirmed 2026-05-15)
5. Wait 5 minutes after enabling APIs before proceeding
6. Contact: `kellybakri@gmail.com`

---

**Last Updated**: 2026-05-15T22:10 EEST  
**Current Session Commit**: `efea2c1` (auth callback 404 fix)
