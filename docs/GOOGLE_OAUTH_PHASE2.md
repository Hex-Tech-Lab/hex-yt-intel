# Google OAuth Phase 2: Manual Console Setup

**Status**: APIs enabled ✅ | Ready for consent screen setup ⏳  
**Project**: hex-yt-intel (283991426265)  
**Service Account**: agent-orchestrator@hex-yt-intel.iam.gserviceaccount.com  

---

## Step 1: Create OAuth Consent Screen

**URL**: https://console.cloud.google.com/apis/credentials/consent?project=hex-yt-intel

1. Click **"Create"** button
2. Select User Type: **Internal** (skips privacy policy requirement)
3. Fill in:
   - **App name**: `hex-yt-intel`
   - **User support email**: `kellybakri@gmail.com`
   - **Developer contact info**: `kellybakri@gmail.com`
4. Click **"Save and Continue"**
5. On "Scopes" step, click **"Add or Remove Scopes"**
6. Search and select these three scopes:
   - `userinfo.profile` (https://www.googleapis.com/auth/userinfo.profile)
   - `userinfo.email` (https://www.googleapis.com/auth/userinfo.email)
   - `openid`
7. Click **"Update"** then **"Save and Continue"**
8. Review and click **"Back to Dashboard"**

---

## Step 2: Create OAuth 2.0 Client ID

**URL**: https://console.cloud.google.com/apis/credentials?project=hex-yt-intel

1. Click **"+ Create Credentials"** → **"OAuth client ID"**
2. Choose **Application type**: `Web application`
3. Enter **Name**: `hex-yt-intel-oauth`
4. Under **Authorized JavaScript origins**, add:
   ```
   http://localhost:3000
   https://hex-yt-intel.vercel.app
   https://adnmbikaqnxivalqoild.supabase.co
   ```
5. Under **Authorized redirect URIs**, add:
   ```
   http://localhost:3000/auth/callback
   https://hex-yt-intel.vercel.app/auth/callback
   https://adnmbikaqnxivalqoild.supabase.co/auth/v1/callback
   ```
6. Click **"Create"**
7. **⚠️ IMPORTANT**: Copy the **Client ID** and **Client Secret** immediately (shown only once)

---

## Step 3: Save Credentials to Vercel

Once you have the Client ID and Secret:

```bash
# Set in Vercel (public)
vercel env add NEXT_PUBLIC_GOOGLE_CLIENT_ID production
# Paste: [Client ID from step above]

# Set in Vercel (secret)
vercel env add GOOGLE_CLIENT_SECRET production
# Paste: [Client Secret from step above]

# Verify
vercel env ls production
```

---

## Step 4: Configure Supabase

1. Go to: https://app.supabase.com/project/adnmbikaqnxivalqoild/auth/providers
2. Enable **Google**
3. Paste:
   - **Client ID**: from Step 2
   - **Client Secret**: from Step 2
4. Click **Save**

---

## Step 5: Verify Live

Test at: https://hex-yt-intel.vercel.app/auth/signin

Should show Google sign-in option ✅

---

## Rollback Notes

If you need to start over:
- Delete the OAuth client from credentials page
- The consent screen can be reused (don't delete)
