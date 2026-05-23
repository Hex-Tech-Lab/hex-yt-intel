# Production Verification Guide

## Overview

This document describes the production verification scripts that ensure your deployment is healthy and ready for traffic. These scripts perform three types of verification:

1. **Infrastructure Checks** — HTTP connectivity, SSL certificates, response times
2. **Component Health** — Database, Cloudflare Worker, Sentry configuration
3. **Frontend Rendering** — Headless browser crawls to validate client-side environment strings and hydration

## Quick Start

### Basic Verification

```bash
./scripts/verify-production.sh
```

This runs all verification stages and reports overall health. Default URL is `https://hex-yt-intel.vercel.app`.

### Verify Different Deployment

```bash
./scripts/verify-production.sh https://staging.example.com
```

### Frontend-Only Verification (Playwright)

```bash
./scripts/run-production-verification.sh https://your-deployment.vercel.app
```

### Headless Mode (Browser Visible)

```bash
./scripts/run-production-verification.sh https://your-deployment.vercel.app --headed
```

## Verification Stages

### Stage 1: Connectivity & Deployment
- ✓ Deployment URL accessibility
- ✓ SSL certificate validity and expiration date

**Fails if**: URL is unreachable or SSL certificate is invalid

### Stage 2: Health & Endpoints
- ✓ Health endpoint returns 200 with component statuses
- ✓ Home page is accessible
- ✓ Auth endpoints are configured
- ✓ Metadata API endpoint is available

**Fails if**: Critical endpoints return error codes

### Stage 3: Frontend Rendering & Client Environment
- ✓ No hydration mismatches or hydration errors
- ✓ Client environment strings are materialized (not empty/undefined)
- ✓ Auth pages render securely (no config leaks)
- ✓ No uninitialized environment variables in HTML

**Fails if**: 
- `ReferenceError: window is not defined`
- `Hydration mismatch` errors
- Unpolyfilled environment variables like `process.env.NEXT_PUBLIC_SUPABASE_URL`
- Rendered HTML contains raw secret patterns

### Stage 4: Component Verification
- ✓ Database connectivity via health endpoint
- ✓ Cloudflare Worker operational
- ✓ Environment variables are present

**Fails if**: Database or Worker components report errors

### Stage 5: Performance
- ✓ Health endpoint response time < 1 second
- ⚠ Warning if response time 1-2 seconds
- ⚠ Warning if response time > 2 seconds

## Playwright Test Coverage

The `production-verification.spec.ts` test suite includes:

### Frontend Rendering Tests
```typescript
test('home page renders without hydration errors')
test('home page client environment strings are materialized')
```

**What it checks**:
- No `Hydration mismatch` errors
- No `ReferenceError: window is not defined`
- No uninitialized variables in HTML
- Body content is rendered (> 100 characters)
- Sentry configuration is present if DSN is set

### Auth Route Tests
```typescript
test('auth signin page renders securely')
test('auth callback page handles redirects gracefully')
```

**What it checks**:
- No hardcoded secrets in auth pages
- Proper redirect handling for OAuth flow
- No sensitive data leaks in HTML

### API Endpoint Tests
```typescript
test('health endpoint returns structured response')
test('metadata endpoint is accessible')
```

**What it checks**:
- Health endpoint has required properties
- Metadata endpoint is accessible or handles errors gracefully

### Client Environment Validation Tests
```typescript
test('no uninitialized environment references in HTML')
test('clientEnv exports are present and non-empty')
```

**What it checks**:
- No `process.env.*` references appear in final HTML
- Critical environment variables are properly inlined
- No empty string values in client environment

## Common Issues & Fixes

### "Hydration mismatch" Error

**Cause**: Server-rendered HTML differs from client-rendered HTML

**Fix**:
1. Check that all environment variables are properly set in deployment
2. Verify `clientEnv` exports match actual environment
3. Check for timezone-dependent rendering
4. Verify no browser-specific code in SSR

### "process.env.NEXT_PUBLIC_SUPABASE_URL" in HTML

**Cause**: Environment variables not inlined during build

**Fix**:
1. Verify `NEXT_PUBLIC_SUPABASE_URL` is set in Vercel environment
2. Force rebuild with `pnpm vercel deploy --prod --force`
3. Check that `clientEnv` export is being used

### Health Endpoint Returns Error

**Cause**: Database or Worker connectivity issue

**Fix**:
1. Check Supabase project status in dashboard
2. Verify Cloudflare Worker is deployed
3. Check Redis/Upstash connectivity
4. Review Vercel deployment logs

### Response Time > 2 seconds

**Cause**: Slow database queries or network latency

**Fix**:
1. Check database query performance
2. Verify Cloudflare Worker is in correct region
3. Review Vercel analytics for cold starts

## CI/CD Integration

### GitHub Actions

Add to your workflow:

```yaml
- name: Verify Production Deployment
  run: ./scripts/verify-production.sh https://hex-yt-intel.vercel.app
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

For Playwright tests:

```yaml
- name: Install Playwright Browsers
  run: cd web && npx playwright install --with-deps

- name: Run Frontend Verification Tests
  run: DEPLOYMENT_URL=https://hex-yt-intel.vercel.app ./scripts/run-production-verification.sh
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

## Output Examples

### Successful Verification
```
✓ ALL CHECKS PASSED - Deployment is ready for traffic
  ✓ Passed:  15/15
  ⚠ Warned:  0/15
  ✗ Failed:  0/15
```

### Frontend Rendering Success
```
✓ Frontend rendering verified (no hydration mismatches, client strings valid)
```

### Failed Check
```
✗ Frontend rendering check failed
  → Check Playwright output for specific error
  → Run with: ./scripts/run-production-verification.sh URL --headed
```

## Troubleshooting

### Playwright Not Found

```bash
# Install dependencies
cd web
pnpm install
npx playwright install --with-deps
```

### "Deployment URL is not accessible"

```bash
# Test connectivity manually
curl -v https://your-url.vercel.app/

# Check DNS
nslookup your-url.vercel.app

# Verify URL format
./scripts/verify-production.sh https://your-deployment.vercel.app
```

### Health Endpoint Returns 500

```bash
# Check Vercel deployment logs
vercel logs https://your-deployment.vercel.app

# Verify environment variables
vercel env ls

# Force redeploy
vercel deploy --prod --force
```

## Environment Variables Required for Full Verification

For frontend rendering tests to fully validate your setup:

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anonymous key
- `NEXT_PUBLIC_SENTRY_DSN` — Sentry error tracking DSN
- `OPENROUTER_API_KEY` — OpenRouter API key
- `NEXTAUTH_SECRET` — NextAuth.js secret

All critical environment variables should be set in Vercel's environment settings before deployment.

## Advanced Usage

### Debug Mode with Playwright

Run with browser visible for debugging:

```bash
./scripts/run-production-verification.sh https://your-deployment.vercel.app --headed
```

Browser will stay open, allowing you to inspect pages and debug issues.

### Custom Deployment URL

```bash
# Verify staging environment
./scripts/verify-production.sh https://staging-hex-yt-intel.vercel.app

# Verify local development server
./scripts/verify-production.sh http://localhost:3000
```

### Check Specific Stages

To run just health checks without frontend tests (faster):

```bash
# Edit verify-production.sh and comment out:
# check_frontend_rendering || true
./scripts/verify-production.sh
```

## See Also

- [Deployment Guide](./DEPLOYMENT.md)
- [Environment Variables](../../CLAUDE.md#critical-environment-variables)
- [Health Endpoint Documentation](../../web/app/api/health/README.md)
