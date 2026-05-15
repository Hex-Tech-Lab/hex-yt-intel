# Google OAuth Setup Guide for hex-yt-intel

## Service Account Configuration

**Service Account Email**: `agent-orchestrator@gen-lang-client-0373183545.iam.gserviceaccount.com`  
**Project ID**: `gen-lang-client-0373183545`  
**Key Location**: `/home/kellyb_dev/.config/gcloud/hex-yt-intel-key.json`

### Prerequisites

#### 1. **Enable Required APIs** in Google Cloud Console (MANUAL - Service Account Cannot Enable Programmatically)

**Why Manual?** The service account has Editor role in IAM, but Google Cloud requires console access to enable the Service Usage API first. This is a security boundary.

**Required APIs** (3 total):

| API | ID | Purpose | Why It's Required | Status |
|-----|----|---------| ------ | -------|
| Cloud Resource Manager API | `cloudresourcemanager.googleapis.com` | Manages OAuth credentials and projects | Needed to create/manage OAuth client IDs | ⏳ NEEDS MANUAL ENABLE |
| **Google People API** | **`people.googleapis.com`** | Retrieve user profile and email during OAuth | **CRITICAL**: Supabase OAuth callback needs to fetch user profile (email, name, picture) after authorization. Without this, OAuth flow fails with "scope not found" or 403 error | ⏳ NEEDS MANUAL ENABLE |
| Google Cloud IAM API | `iam.googleapis.com` | Service account and role management | Needed to manage service account permissions | ⏳ NEEDS MANUAL ENABLE |

⚠️ **CRITICAL NOTE**: The deprecated "Google+ API" (`plus.googleapis.com`) is **NOT** sufficient. You **MUST** enable the **Google People API** (`people.googleapis.com`) instead. Google+ was sunsetted years ago and will cause OAuth failures.

**Steps to Enable Manually**:

1. Go to: https://console.cloud.google.com/apis/dashboard?project=gen-lang-client-0373183545
2. Click **"Enable APIs and Services"** (top bar)
3. Search for and enable **each API** in this order:
   
   **Step 1: Enable Cloud Resource Manager API**
   - Search: "Cloud Resource Manager"
   - Click the result
   - Click **"Enable"**
   - Wait 2-3 minutes for propagation
   
   **Step 2: Enable Google People API**
   - Search: "Google People API" or just "People API"
   - Click the result (should show: "Provides access to information about profiles and contacts")
   - Click **"Enable"**
   - Wait 2-3 minutes for propagation
   - ⚠️ DO NOT enable "Google+ API" (deprecated, will not work)
   
   **Step 3: Enable Google Cloud IAM API**
   - Search: "Cloud Identity and Access Management"
   - Click the result
   - Click **"Enable"**
   - Wait 2-3 minutes for propagation

4. Verify all three are enabled:
   - Go to: https://console.cloud.google.com/apis/dashboard?project=gen-lang-client-0373183545
   - Look for all three APIs in the "Enabled APIs" list
   - If not visible, refresh the page

**Fail-Fast Verification** (run after EACH API enable to confirm propagation):
```bash
# Check if APIs are enabled (repeat after each API enable, wait 2-3 min between checks)
gcloud services list --enabled \
  --filter="name:(cloudresourcemanager.googleapis.com OR people.googleapis.com OR iam.googleapis.com)" \
  --format="table(name)" \
  --project=gen-lang-client-0373183545
```

Expected output after all three are enabled:
```
NAME
cloudresourcemanager.googleapis.com
iam.googleapis.com
people.googleapis.com
```

**If you see `plus.googleapis.com` instead of `people.googleapis.com`**: You enabled the wrong API. Disable Google+ API and enable Google People API instead.

2. **Grant Service Account Permissions**:
   - IAM & Admin → Service Accounts → agent-orchestrator
   - Grant role: `Editor` (for OAuth management)

### Setup Steps

#### Step 1: Authenticate with Service Account (One-time)

```bash
# Already configured at:
# /home/kellyb_dev/.config/gcloud/hex-yt-intel-key.json

# Verify authentication
gcloud auth activate-service-account --key-file=/home/kellyb_dev/.config/gcloud/hex-yt-intel-key.json
gcloud config set project gen-lang-client-0373183545
gcloud auth list
```

Expected output:
```
ACTIVE  ACCOUNT
*       agent-orchestrator@gen-lang-client-0373183545.iam.gserviceaccount.com
```

#### Step 2: Create OAuth 2.0 Consent Screen

Navigate to: https://console.cloud.google.com/apis/credentials/consent?project=gen-lang-client-0373183545

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

Navigate to: https://console.cloud.google.com/apis/credentials?project=gen-lang-client-0373183545

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
- The service account key is stored at `/home/kellyb_dev/.config/gcloud/hex-yt-intel-key.json`
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
  --project=gen-lang-client-0373183545
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

**API Enablement Timeline**:
- Estimated time to enable all three APIs: 10-15 minutes (including propagation delays)
- After enabling: Wait 2-3 minutes between each enable for system propagation
- Verification: Run the `gcloud services list` command to confirm

## Support

For issues:
1. Check the Troubleshooting section above
2. Verify all URIs are correct (copy-paste carefully!)
3. **Ensure APIs are enabled** (use checklist above)
4. Check service account has Editor role (already confirmed ✅)
5. Wait 5 minutes after enabling APIs before proceeding
6. Contact: kellybakri@gmail.com
