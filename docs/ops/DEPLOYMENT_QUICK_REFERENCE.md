---
Filename: DEPLOYMENT_QUICK_REFERENCE.md
Location: /docs/ops/
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:13:51 EEST (GCW)
Purpose: DEPLOYMENT QUICK REFERENCE
---

# Deployment Quick Reference

Fast lookup for common deployment tasks.

## Status Check

```bash
# Production health
curl -s https://hex-yt-intel.vercel.app/api/health | jq '.'

# Staging health
curl -s https://staging.hex-yt-intel.vercel.app/api/health | jq '.'

# Or use verification script
pnpm verify:production
pnpm verify:staging
```

## Deployment

### Automatic (Preferred)

```bash
# Push to main/master (auto-deploys to production)
git push origin main

# Push to staging (auto-deploys to staging)
git push origin staging

# Monitor at: https://github.com/Hex-Tech-Lab/hex-yt-intel/actions
```

### Manual

```bash
# Deploy to production
pnpm deploy:prod

# Deploy to staging
pnpm deploy:staging

# Note: Requires VERCEL_TOKEN env var
```

## Database Migrations

```bash
# Automatic (runs after deployment)
# No action needed - CI/CD handles it

# Manual (if CI/CD fails)
export SUPABASE_ACCESS_TOKEN="<your-token>"
cd web && npx supabase db push
```

## Rollback

### Quick (< 1 minute)

1. Go to: https://vercel.com/hex-tech-lab/hex-yt-intel/deployments
2. Find previous working deployment
3. Click "Promote to Production"
4. Done - traffic redirected instantly

### Full (Code + Database)

```bash
# 1. Rollback Vercel (see above)

# 2. Reset database (WARNING: Resets entire DB!)
export SUPABASE_ACCESS_TOKEN="<your-token>"
cd web && npx supabase db reset
```

## Environment Variables

### Set in Vercel

1. Go to: https://vercel.com/hex-tech-lab/hex-yt-intel/settings/environment-variables
2. Add/update variables
3. Redeploy (push to main)

### Required Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### Optional Variables

```
NEXT_PUBLIC_SENTRY_DSN
OPENROUTER_API_KEY
CLOUDFLARE_WORKER_URL
```

### Validate Locally

```bash
pnpm env:validate
```

## Monitoring

### Errors

- Sentry: https://sentry.io/organizations/hex-tech-lab/issues/?project=hex-yt-intel
- Alert: Check Slack #security-alerts for critical errors

### Performance

- Vercel: https://vercel.com/hex-tech-lab/hex-yt-intel/analytics
- Functions: https://vercel.com/hex-tech-lab/hex-yt-intel/monitoring

### Database

- Supabase: https://app.supabase.com/project/[id]
- Connection pool: Check dashboard for open connections

## GitHub Secrets

All secrets configured in: https://github.com/Hex-Tech-Lab/hex-yt-intel/settings/secrets/actions

```
VERCEL_TOKEN               - Vercel API token
VERCEL_ORG_ID              - Vercel organization ID
VERCEL_PROJECT_ID          - Vercel project ID
SUPABASE_ACCESS_TOKEN      - Supabase API token
NEXT_PUBLIC_SENTRY_DSN     - Sentry error tracking DSN
SENTRY_AUTH_TOKEN          - Sentry authentication token
```

## Troubleshooting

### Deployment Failed

```bash
# View GitHub Actions logs
gh run view <run-id> --log

# View Vercel build logs
vercel logs --prod

# Check if type-check passes locally
pnpm type-check

# Check if build passes locally
pnpm build
```

### Health Check Failing

```bash
# Check database
curl -s https://hex-yt-intel.vercel.app/api/health | jq '.components.database'

# Check worker
curl -s https://hex-yt-intel.vercel.app/api/health | jq '.components.worker'

# Check Sentry
curl -s https://hex-yt-intel.vercel.app/api/health | jq '.components.sentry'
```

### Missing Environment Variable

```bash
# Add to Vercel (https://vercel.com/.../settings/environment-variables)
# Then redeploy:
pnpm deploy:prod

# Or wait for next push to main
```

## Logs

### Vercel Deployment Logs

```bash
vercel logs --prod
```

### Cloudflare Worker Logs

```bash
cd worker/
wrangler tail
```

### Supabase Logs

```bash
cd web/
npx supabase logs
```

## Performance Budgets

- First Contentful Paint (FCP): < 2s
- Largest Contentful Paint (LCP): < 2.5s
- Cumulative Layout Shift (CLS): < 0.1
- Total JS: < 200KB (gzipped)

Check: https://vercel.com/hex-tech-lab/hex-yt-intel/analytics

## Security

### Pre-Deployment Check

```bash
# No secrets in code?
grep -r "sk_\|pk_\|AIzaSy" web/app

# No hardcoded credentials?
git log -p --all -S "Bearer" | head -50

# Dependencies secure?
pnpm audit
```

### Headers

All security headers configured in vercel.json + next.config.ts:
- X-Content-Type-Options
- X-Frame-Options
- X-XSS-Protection
- Referrer-Policy
- Permissions-Policy

### RLS

All tables have Row-Level Security enabled:
- users (read own, update own)
- analyses (read own, insert own, update own, delete own)

## Common Tasks

### Add Feature

```bash
1. Create branch: git checkout -b feature/my-feature
2. Develop and test locally: pnpm dev
3. Type check: pnpm type-check
4. Lint: pnpm lint --fix
5. Test: pnpm test
6. Push: git push origin feature/my-feature
7. Create PR: gh pr create
8. Review and merge → auto-deploys to staging
9. Approve staging → merge to main → auto-deploys to production
```

### Fix Production Bug

```bash
1. Create branch: git checkout -b fix/bug-name
2. Fix and test locally
3. Push: git push origin fix/bug-name
4. Create PR to main (not staging)
5. Merge and deploy directly to production
6. Rollback if needed (see Rollback section)
```

### Rotate API Key

```bash
1. Generate new key in source system (Supabase, etc.)
2. Update in Vercel environment variables
3. Redeploy: git push origin main
4. Verify: pnpm verify:production
5. Revoke old key
```

### Check Database Integrity

```bash
export SUPABASE_ACCESS_TOKEN="<your-token>"
cd web

# List tables
npx supabase db execute "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"

# Check RLS policies
npx supabase db execute "SELECT * FROM information_schema.table_privileges WHERE table_schema='public';"

# Check migrations
npx supabase migration list
```

## Support

- **Deployment Issues**: Check DEPLOYMENT.md
- **Security Issues**: Check SECURITY.md
- **Full Documentation**: Read CHUNK_11_DEPLOYMENT.md
- **Script Help**: `./scripts/verify-production.sh --help` (if implemented)
- **Team Help**: #deployments Slack channel

---

**Last Updated**: 2026-05-14
