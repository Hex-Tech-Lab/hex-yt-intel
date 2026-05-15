# Google OAuth Setup Guide for hex-yt-intel

## Service Account Configuration

**Service Account Email**: `agent-orchestrator@gen-lang-client-0373183545.iam.gserviceaccount.com`  
**Project ID**: `gen-lang-client-0373183545`  
**Key Location**: `/home/kellyb_dev/.config/gcloud/hex-yt-intel-key.json`

### Prerequisites

#### 1. **Enable Required APIs** in Google Cloud Console (MANUAL - Service Account Cannot Enable Programmatically)

**Why Manual?** The service account has Editor role in IAM, but Google Cloud requires console access to enable the Service Usage API first. This is a security boundary.

**Required APIs** (3 total):

| API | ID | Purpose | Status |
|-----|----|---------| -------|
| Cloud Resource Manager API | `cloudresourcemanager.googleapis.com` | Manages OAuth credentials | ⏳ NEEDS MANUAL ENABLE |
| Google+ API | `plus.googleapis.com` | OAuth consent screen (deprecated but required) | ⏳ NEEDS MANUAL ENABLE |
| Google Cloud Identity and Access Management API | `iam.googleapis.com` | Service account management | ⏳ NEEDS MANUAL ENABLE |

**Steps to Enable Manually**:

1. Go to: https://console.cloud.google.com/apis/dashboard?project=gen-lang-client-0373183545
2. Click **"Enable APIs and Services"** (top bar)
3. Search for and enable **each API** in this order:
   
   **Step 1: Enable Cloud Resource Manager API**
   - Search: "Cloud Resource Manager"
   - Click the result
   - Click **"Enable"**
   - Wait 2-3 minutes for propagation
   
   **Step 2: Enable Google+ API**
   - Search: "Google+ API" or "Plus API"
   - Click the result
   - Click **"Enable"**
   - Wait 2-3 minutes for propagation
   
   **Step 3: Enable Google Cloud IAM API**
   - Search: "Cloud Identity and Access Management"
   - Click the result
   - Click **"Enable"**
   - Wait 2-3 minutes for propagation

4. Verify all three are enabled:
   - Go to: https://console.cloud.google.com/apis/dashboard?project=gen-lang-client-0373183545
   - Look for all three APIs in the "Enabled APIs" list
   - If not visible, refresh the page

**Verification Command** (run after manual enabling):
```bash
# This will work ONLY after Service Usage API is enabled
gcloud services list --enabled \
  --filter="name:(cloudresourcemanager.googleapis.com OR plus.googleapis.com OR iam.googleapis.com)" \
  --format="table(name)" \
  --project=gen-lang-client-0373183545
```

Expected output:
```
NAME
cloudresourcemanager.googleapis.com
iam.googleapis.com
plus.googleapis.com
```

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

### OAuth Redirect Error

**Solution**: Verify redirect URIs match exactly:
- In Google Cloud Console (Step 3)
- In Supabase settings
- In application code

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

## API ENABLEMENT STATUS TRACKER

**Completion Checklist**:
- [ ] Cloud Resource Manager API enabled
- [ ] Google+ API enabled  
- [ ] Cloud IAM API enabled
- [ ] OAuth 2.0 Consent Screen configured (Step 2)
- [ ] OAuth 2.0 Credentials created (Step 3)
- [ ] Credentials added to Supabase (Step 4)
- [ ] Credentials added to Vercel (Step 4)
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
