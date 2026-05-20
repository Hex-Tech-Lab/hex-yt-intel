# GitHub Actions Secrets Configuration

This document describes the required secrets for hex-yt-intel CI/CD pipeline to function correctly.

## Required Secrets

All secrets must be configured in GitHub repository settings under **Settings > Secrets and variables > Actions**.

### Vercel Deployment

| Secret Name | Description | Source |
|---|---|---|
| `VERCEL_TOKEN` | Authentication token for Vercel API | [Vercel Dashboard](https://vercel.com/account/tokens) - Create token with deployment scope |
| `VERCEL_ORG_ID` | Organization ID in Vercel | Get from Vercel dashboard or use `vercel whoami` |
| `VERCEL_PROJECT_ID` | Project ID for hex-yt-intel | Get from Vercel dashboard or `.vercel/project.json` in repository |

### Sentry Error Tracking

| Secret Name | Description | Source |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Public DSN for client-side error reporting (production) | [Sentry Project Settings](https://sentry.io/settings/) |
| `SENTRY_AUTH_TOKEN` | Authentication token for Sentry API (production build) | [Sentry Auth Tokens](https://sentry.io/settings/account/api/auth-tokens/) |
| `STAGING_NEXT_PUBLIC_SENTRY_DSN` | Public DSN for staging environment | Same as production, or separate Sentry project |
| `STAGING_SENTRY_AUTH_TOKEN` | Authentication token for staging environment | Same as production, or separate Sentry token |

### Supabase Database

| Secret Name | Description | Source |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Personal access token for Supabase CLI | [Supabase Account Settings](https://app.supabase.com/account/tokens) - Create personal access token |

## Setup Instructions

### 1. Vercel Secrets

**Get VERCEL_TOKEN:**
1. Go to https://vercel.com/account/tokens
2. Click "Create Token"
3. Select scope: "Full Account"
4. Copy the token value

**Get VERCEL_ORG_ID:**
```bash
vercel whoami
# Returns org ID
```

**Get VERCEL_PROJECT_ID:**
```bash
cd web
cat .vercel/project.json | jq '.projectId'
```

### 2. Sentry Secrets

**Get SENTRY_AUTH_TOKEN:**
1. Go to https://sentry.io/settings/account/api/auth-tokens/
2. Click "Create New Token"
3. Select scopes: `project:releases`, `org:read`
4. Copy the token value

**Get NEXT_PUBLIC_SENTRY_DSN:**
1. Go to Sentry project settings
2. Navigate to "Client Keys (DSN)"
3. Copy the public DSN URL (starts with `https://`)

### 3. Supabase Secrets

**Get SUPABASE_ACCESS_TOKEN:**
1. Go to https://app.supabase.com/account/tokens
2. Click "Generate New Token"
3. Name it "GitHub Actions"
4. Copy the token value

## Verification

After adding all secrets, verify the workflow can access them:

```bash
# Check workflow runs at:
# https://github.com/Hex-Tech-Lab/hex-yt-intel/actions

# All jobs should reach the deployment stage without auth errors
```

## Troubleshooting

### "Unable to authenticate with Vercel"
- Verify VERCEL_TOKEN is correct and not expired
- Ensure token has deployment permissions
- Check VERCEL_ORG_ID and VERCEL_PROJECT_ID match your account

### "Sentry API authentication failed"
- Verify SENTRY_AUTH_TOKEN has `project:releases` scope
- Check token hasn't expired (tokens can expire after 90 days)
- Regenerate token if needed

### "Supabase access denied"
- Verify SUPABASE_ACCESS_TOKEN is for the correct project
- Check token permissions include migration management
- Ensure token hasn't expired

## Rotation Schedule

| Secret | Rotation Period | Reason |
|---|---|---|
| `VERCEL_TOKEN` | Quarterly | Security best practice |
| `SENTRY_AUTH_TOKEN` | Quarterly or when scope changes | May expire after 90 days |
| `SUPABASE_ACCESS_TOKEN` | Annually | Reduce blast radius if compromised |

## References

- [GitHub Actions Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Vercel API Tokens](https://vercel.com/docs/rest-api#authentication/create-an-access-token)
- [Sentry API Authentication](https://docs.sentry.io/api/authentication/)
- [Supabase Access Tokens](https://supabase.com/docs/guides/cli/local-development)
