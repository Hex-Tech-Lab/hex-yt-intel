# Deployment Guide: hex-yt-intel

Complete guide to deploying, monitoring, and rolling back hex-yt-intel to production.

## Table of Contents

1. [Overview](#overview)
2. [Pre-Deployment Checklist](#pre-deployment-checklist)
3. [Automated Deployment Pipeline](#automated-deployment-pipeline)
4. [Manual Deployment](#manual-deployment)
5. [Post-Deployment Verification](#post-deployment-verification)
6. [Monitoring & Alerts](#monitoring--alerts)
7. [Rollback Procedures](#rollback-procedures)
8. [Staging Environment](#staging-environment)
9. [Secrets & Configuration](#secrets--configuration)
10. [Troubleshooting](#troubleshooting)

---

## Overview

### Deployment Architecture

```
GitHub (hex-tech-lab/hex-yt-intel)
    ↓ [on push to main/master]
GitHub Actions CI/CD Pipeline
    ├─ Type Check (pnpm run type-check)
    ├─ Lint (pnpm run lint)
    ├─ Test (pnpm run test)
    ├─ Build (pnpm run build)
    ├─ Security Check (no secrets, no hardcoded credentials)
    └─ Environment Validation
        ↓ [if all pass]
Vercel Deployment
    ├─ Region: IAD (N. Virginia), LHR (London), SFO (San Francisco)
    ├─ Auto-scaling: Enabled
    ├─ Edge caching: Enabled
    └─ CDN: Cloudflare
        ↓ [post-deployment]
Database Migration
    └─ Supabase (supabase db push)
        ↓
Health Check
    └─ /api/health endpoint
        ↓
Production Ready ✓
```

### Deployment Environments

| Environment | Branch  | URL                              | Database | Status |
|-------------|---------|----------------------------------|----------|--------|
| Production  | master  | https://hex-yt-intel.vercel.app | Production Supabase | Auto-deploy on merge |
| Staging     | staging | https://staging.hex-yt-intel.vercel.app | Staging Supabase | Auto-deploy on push |
| Development | main    | localhost:3000 | Local | Manual only |

---

## Pre-Deployment Checklist

Before merging to `master` or pushing to `staging`, verify:

### Code Quality
- [ ] All tests passing locally: `pnpm test`
- [ ] Type checking passes: `pnpm type-check`
- [ ] Linting passes: `pnpm lint`
- [ ] No secrets in code (search for `sk_live`, `pk_live`, API keys)
- [ ] No hardcoded environment variables
- [ ] Build succeeds locally: `pnpm build`

### Database
- [ ] All migrations created and tested locally
- [ ] Database schema synced: `supabase db push`
- [ ] RLS policies verified on all tables
- [ ] No breaking changes to public schema

### Configuration
- [ ] All required env vars set in Vercel project
- [ ] Production secrets configured (Sentry token, API keys)
- [ ] CORS settings correct
- [ ] Rate limiting configured

### Testing
- [ ] Integration tests pass
- [ ] E2E tests pass (if applicable)
- [ ] API endpoints tested with prod data
- [ ] Authentication flow verified

### Documentation
- [ ] CHANGELOG updated
- [ ] README reflects current features
- [ ] API documentation current
- [ ] Rollback plan documented

### Review
- [ ] Code reviewed by team member
- [ ] Security review passed
- [ ] All PR comments addressed
- [ ] Commit messages clear and descriptive

---

## Automated Deployment Pipeline

### How It Works

1. **Trigger**: Push to `master` or `main` branch
2. **Setup**: Checkout code, install dependencies
3. **Quality**: Type check, lint, test
4. **Build**: Compile Next.js application
5. **Security**: Check for exposed secrets and credentials
6. **Verify**: Validate environment variables
7. **Deploy**: Push to Vercel (if all previous steps pass)
8. **Migrate**: Apply database migrations
9. **Health**: Run health check on deployed URL

### Pipeline Status

View pipeline status:
1. Go to GitHub: https://github.com/Hex-Tech-Lab/hex-yt-intel
2. Click "Actions" tab
3. View latest workflow run

Each step will show ✅ (passed), ❌ (failed), or ⏭️ (skipped).

### Secrets Required

Configure these secrets in GitHub (Settings → Secrets):

```env
VERCEL_TOKEN=<vercel-api-token>
VERCEL_ORG_ID=<vercel-org-id>
VERCEL_PROJECT_ID=<vercel-project-id>
SUPABASE_ACCESS_TOKEN=<supabase-api-token>
NEXT_PUBLIC_SENTRY_DSN=<sentry-dsn>
SENTRY_AUTH_TOKEN=<sentry-auth-token>
```

---

## Manual Deployment

If automated deployment fails, deploy manually:

### 1. Deploy to Vercel

```bash
# Login to Vercel
vercel login

# Deploy to production
vercel deploy --prod

# Or if using pnpm
pnpm dlx vercel deploy --prod
```

### 2. Apply Database Migrations

```bash
# Authenticate with Supabase
export SUPABASE_ACCESS_TOKEN="<your-access-token>"

# Push migrations
cd web
npx supabase db push

# Verify schema
npx supabase db execute "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
```

### 3. Verify Deployment

```bash
# Run verification script
./scripts/verify-production.sh https://hex-yt-intel.vercel.app

# Or manual health check
curl https://hex-yt-intel.vercel.app/api/health | jq '.'
```

---

## Post-Deployment Verification

### Automated Checks (via CI/CD)

The pipeline automatically:
- ✅ Runs health check on deployed URL
- ✅ Verifies database connectivity
- ✅ Checks Cloudflare Worker
- ✅ Validates Sentry configuration
- ✅ Tests core API endpoints

### Manual Verification

```bash
# 1. Health Check
curl -s https://hex-yt-intel.vercel.app/api/health | jq '.'
# Expected: { status: "healthy", ... }

# 2. Home Page
curl -s https://hex-yt-intel.vercel.app/ | head -20

# 3. Auth Endpoint
curl -s https://hex-yt-intel.vercel.app/api/auth/signin -w "\n%{http_code}"
# Expected: 200 or 307

# 4. Database Connection
curl -s https://hex-yt-intel.vercel.app/api/health | jq '.components.database'
# Expected: { status: "ok", latency: <number> }

# 5. Cloudflare Worker
curl -s https://hex-yt-intel.vercel.app/api/health | jq '.components.worker'
# Expected: { status: "ok", latency: <number> }
```

### Performance Checks

```bash
# Check Core Web Vitals in Sentry
# Dashboard: https://sentry.io/organizations/hex-tech-lab/releases/hex-yt-intel/

# Monitor error rate
# Dashboard: https://vercel.com/hex-tech-lab/hex-yt-intel/monitoring

# Check Cloudflare analytics
# Dashboard: https://dash.cloudflare.com/
```

---

## Monitoring & Alerts

### Sentry (Error Tracking)

- **Dashboard**: https://sentry.io/organizations/hex-tech-lab/issues/?project=hex-yt-intel
- **Alerts**: Configured for:
  - Error rate > 5% in 5 minutes
  - New error type
  - Spike in errors

### Vercel (Performance)

- **Dashboard**: https://vercel.com/hex-tech-lab/hex-yt-intel
- **Analytics**: Real-time deployment metrics
- **Functions**: Serverless function monitoring

### Upstash Redis (Cache)

- **Dashboard**: https://console.upstash.com/
- **Metrics**: Cache hit rate, latency, memory usage

### Supabase (Database)

- **Dashboard**: https://app.supabase.com/project/
- **Metrics**: Connection count, query performance, storage

### Health Endpoint Polling

Monitor health endpoint continuously:

```bash
# Check every 60 seconds
while true; do
  curl -s https://hex-yt-intel.vercel.app/api/health | jq '.status' && sleep 60
done

# Or use a monitoring service
# PingDom, UptimeRobot, etc.
```

---

## Rollback Procedures

### Quick Rollback (Vercel)

If deployment is broken, rollback in < 1 minute:

1. Go to https://vercel.com/hex-tech-lab/hex-yt-intel/deployments
2. Find the previous working deployment
3. Click "Promote to Production"

This instantly redirects production traffic to the previous build.

### Full Rollback (Code + Database)

If database migrations broke something:

```bash
# 1. Rollback deployment in Vercel (see above)

# 2. Rollback database migrations
export SUPABASE_ACCESS_TOKEN="<your-token>"
cd web

# View migration history
npx supabase migration list

# Reset to specific migration
npx supabase db reset
# ⚠️ WARNING: This resets entire database!

# OR: Manually revert migrations
# Edit supabase/migrations/{timestamp}_fix.sql
# Then: npx supabase db push
```

### Testing Rollback (Staging)

Before rolling back production, test on staging:

1. Push rollback commit to `staging` branch
2. Wait for staging deployment to complete
3. Verify with `./scripts/verify-production.sh staging.hex-yt-intel.vercel.app`
4. If verified, repeat steps for `master` branch

### Post-Rollback Checklist

After rollback:
- [ ] Run `./scripts/verify-production.sh`
- [ ] Check Sentry for new errors
- [ ] Verify database integrity
- [ ] Notify team of rollback
- [ ] Document root cause in issue
- [ ] Create fix and redeploy

---

## Staging Environment

### Setup

Staging mirrors production but uses separate resources:

```env
# .env.staging
NEXT_PUBLIC_SUPABASE_URL=https://staging-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=staging-anon-key
NEXT_PUBLIC_SENTRY_DSN=staging-dsn
OPENROUTER_API_KEY=staging-key
```

### Deploy to Staging

```bash
# Option 1: Push to staging branch (auto-deploys)
git checkout -b feature/my-feature
git push origin feature/my-feature

# Then create PR to staging
# When merged: auto-deploys to https://staging.hex-yt-intel.vercel.app

# Option 2: Manual deploy to staging
vercel deploy --scope=hex-tech-lab
```

### Test on Staging

```bash
# Verify staging deployment
./scripts/verify-production.sh https://staging.hex-yt-intel.vercel.app

# Run integration tests against staging
DEPLOYMENT_URL=https://staging.hex-yt-intel.vercel.app pnpm test:e2e

# Manual testing in browser
# https://staging.hex-yt-intel.vercel.app
```

### Promote to Production

Once staging is verified:

```bash
# Create PR from staging → master
gh pr create --base master --head staging --title "Release: ..."

# After review and merge, auto-deploys to production
```

---

## Secrets & Configuration

### Vercel Environment Variables

Set in: https://vercel.com/hex-tech-lab/hex-yt-intel/settings/environment-variables

**Production**:
```env
NEXT_PUBLIC_SUPABASE_URL=<supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
NEXT_PUBLIC_SENTRY_DSN=<sentry-dsn>
NEXT_PUBLIC_APP_VERSION=1.0.0
OPENROUTER_API_KEY=<openrouter-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
CLOUDFLARE_WORKER_URL=https://yt-intel.hex-tech-lab.workers.dev
SENTRY_AUTH_TOKEN=<sentry-auth-token>
```

**Staging**:
```env
# Same as production but with staging keys
```

**Preview** (PR deployments):
```env
# Inherit from Staging
```

### Rotating Secrets

When rotating API keys:

1. Create new key in source system (Supabase, Sentry, etc.)
2. Update in Vercel environment variables
3. Redeploy: `vercel deploy --prod` or push to main
4. Verify with `./scripts/verify-production.sh`
5. Revoke old key in source system

### Security Best Practices

- ✅ Never commit secrets to Git
- ✅ Use Vercel's environment variable encryption
- ✅ Rotate keys quarterly
- ✅ Use separate keys for each environment
- ✅ Enable audit logging in Vercel
- ✅ Use RBAC for secret access

---

## Troubleshooting

### Deployment Failed

**Check logs**:
```bash
# View GitHub Actions logs
gh run view <run-id> --log

# View Vercel deployment logs
vercel logs --prod

# View build logs
vercel env pull .env.production.local
pnpm build
```

**Common issues**:

| Issue | Solution |
|-------|----------|
| "Type errors found" | Run `pnpm type-check` and fix errors locally |
| "Linting failed" | Run `pnpm lint --fix` |
| "Build exceeded time limit" | Optimize imports, enable `optimizePackageImports` |
| "Out of memory" | Increase Vercel Functions memory in vercel.json |
| "Env var missing" | Check Vercel project settings, add missing var |

### Health Check Failing

**Database connection error**:
```bash
# Check Supabase status
curl https://status.supabase.com/api/v2/status

# Check connection string in Vercel env vars
vercel env list

# Test locally
supabase status
```

**Worker error**:
```bash
# Check Cloudflare Worker status
curl https://yt-intel.hex-tech-lab.workers.dev/fetch-metadata?video_id=dQw4w9WgXcQ

# Check wrangler logs
cd worker/
wrangler tail
```

**Sentry error**:
```bash
# Check DSN is set
curl https://hex-yt-intel.vercel.app/api/health | jq '.components.sentry'

# Test Sentry connection
curl -X POST https://[dsn]@[domain].ingest.sentry.io/[project-id] \
  -H "Content-Type: application/json" \
  -d '{"message": "test"}'
```

### Slow Response Times

**Check metrics**:
```bash
# Response time
curl -w "@curl-format.txt" -o /dev/null https://hex-yt-intel.vercel.app/api/health

# Vercel Analytics
# https://vercel.com/hex-tech-lab/hex-yt-intel/analytics

# Sentry Performance
# https://sentry.io/organizations/hex-tech-lab/performance/?project=hex-yt-intel
```

**Optimize**:
- Check database query performance (Supabase)
- Enable caching headers
- Reduce bundle size
- Optimize images

### Errors Not Showing in Sentry

**Check configuration**:
```bash
# Verify NEXT_PUBLIC_SENTRY_DSN is set
curl https://hex-yt-intel.vercel.app/api/health | jq '.components.sentry'

# Check Sentry project
# https://sentry.io/organizations/hex-tech-lab/projects/hex-yt-intel/

# Verify auth token in Vercel
vercel env pull .env.production.local
grep SENTRY_AUTH_TOKEN
```

---

## Additional Resources

- **Vercel Docs**: https://vercel.com/docs
- **Next.js Docs**: https://nextjs.org/docs
- **Supabase Docs**: https://supabase.com/docs
- **Sentry Docs**: https://docs.sentry.io/
- **GitHub Actions**: https://docs.github.com/en/actions

---

## Support

- **Team Slack**: #deployments
- **On-Call**: Check rotation in PagerDuty
- **Escalation**: Contact DevOps team lead

---

**Last Updated**: 2026-05-14  
**Maintained By**: DevOps Team  
**Review Schedule**: Quarterly
