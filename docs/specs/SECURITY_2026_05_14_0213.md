---
Filename: $file
Location: docs/specs/$file
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:11:06 EEST
Purpose: Architectural specification document
---
Filename: SECURITY.md
Location: /docs/specs/
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:13:51 EEST (GCW)
Purpose: SECURITY
---

# Security Checklist: hex-yt-intel

Pre-deployment and post-deployment security verification for hex-yt-intel.

## Table of Contents

1. [Pre-Deployment Security](#pre-deployment-security)
2. [Code Security](#code-security)
3. [Infrastructure Security](#infrastructure-security)
4. [Data Security](#data-security)
5. [API Security](#api-security)
6. [Authentication & Authorization](#authentication--authorization)
7. [Monitoring & Incident Response](#monitoring--incident-response)
8. [Security Headers](#security-headers)

---

## Pre-Deployment Security

Run **before every deployment to production**:

### Checklist

- [ ] No secrets in Git history
  ```bash
  # Search for common patterns
  git log -p --all -S "NEXT_PUBLIC_" -- web/app | head -50
  git log -p --all -S "sk_live" | head -50
  git log -p --all -S "pk_live" | head -50
  ```

- [ ] No hardcoded API keys
  ```bash
  grep -r "sk_\|pk_\|AIzaSy\|Bearer " web/app --include="*.ts" --include="*.tsx"
  ```

- [ ] No credentials in environment examples
  ```bash
  cat .env.example | grep -i "key\|secret\|token"
  ```

- [ ] Dependencies up to date and secure
  ```bash
  pnpm audit
  pnpm audit --prod
  ```

- [ ] No `console.log()` with sensitive data
  ```bash
  grep -r "console.log.*\(password\|secret\|token\|key\)" web/app
  ```

- [ ] All env vars validated at startup
  ```bash
  # Verify env.ts is imported in next.config.ts and _app.tsx
  grep -r "from.*env" web/app
  grep -r "from.*env" web/lib
  ```

---

## Code Security

### Dependency Security

```bash
# Audit for vulnerabilities
pnpm audit

# Fix vulnerabilities
pnpm audit --fix

# Check for vulnerable packages
pnpm outdated

# Review security advisories
# https://github.com/advisories
```

### Dependency Policies

- **Required**: All direct dependencies have security scanning enabled
- **Locked**: `pnpm-lock.yaml` checked into Git (reproducible builds)
- **Updates**: Dependencies updated monthly (security patches immediately)
- **Unused**: Remove unused dependencies regularly

### Code Review Security

Before merging PRs, verify:

- [ ] No new security vulnerabilities in dependencies
- [ ] No hardcoded secrets or credentials
- [ ] No SQL injection risks (use Supabase client, not raw queries)
- [ ] No XSS vulnerabilities (sanitize user input)
- [ ] No CSRF vulnerabilities (verify origin headers)
- [ ] Proper error handling (don't leak stack traces)
- [ ] Rate limiting on API endpoints
- [ ] Authentication checks on protected routes

---

## Infrastructure Security

### Vercel Security

```bash
# Enable security headers in vercel.json
# (Already configured in vercel.json)

# Security headers included:
# - X-Content-Type-Options: nosniff
# - X-Frame-Options: DENY
# - X-XSS-Protection: 1; mode=block
# - Referrer-Policy: strict-origin-when-cross-origin
# - Permissions-Policy: geolocation=(), microphone=(), camera=()
```

### Environment Variables

- [ ] Never commit `.env.local` or `.env.*.local`
- [ ] All secrets in Vercel project settings (encrypted)
- [ ] Different keys for staging vs. production
- [ ] Service role keys never exposed to client
- [ ] API keys rotated quarterly

### HTTPS & TLS

- [ ] All traffic encrypted (HTTP → HTTPS redirect)
- [ ] TLS 1.2+ enforced
- [ ] Certificate pinning (optional, for APIs)
- [ ] HSTS headers configured

---

## Data Security

### Database (Supabase)

```bash
# Verify RLS is enabled on all tables
supabase db execute "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"

# Check RLS policies
supabase db execute "SELECT * FROM information_schema.enabled_roles;"

# Verify schema
supabase db execute "SELECT * FROM information_schema.tables WHERE table_schema='public';"
```

### RLS Policies

All tables must have Row Level Security (RLS) policies:

**users table**:
```sql
-- Users can only read their own record
CREATE POLICY "users_select_own"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- Users can only update their own record
CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  USING (auth.uid() = id);
```

**analyses table**:
```sql
-- Users can only read their own analyses
CREATE POLICY "analyses_select_own"
  ON analyses FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only insert their own analyses
CREATE POLICY "analyses_insert_own"
  ON analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own analyses
CREATE POLICY "analyses_update_own"
  ON analyses FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can only delete their own analyses
CREATE POLICY "analyses_delete_own"
  ON analyses FOR DELETE
  USING (auth.uid() = user_id);
```

### Data Encryption

- [ ] Data at rest encrypted (Supabase automatic)
- [ ] Data in transit encrypted (TLS)
- [ ] PII fields encrypted (passwords, API keys)
- [ ] Encryption keys rotated annually

### Data Retention

- [ ] Old analyses deleted after 1 year (Pro tier feature)
- [ ] Deleted data removed from backups after 30 days
- [ ] Backup retention policy documented
- [ ] GDPR compliance: Export/Delete on request

---

## API Security

### Rate Limiting

```bash
# Configured via Upstash Redis
# Limits per endpoint (in web/app/api/*/route.ts):

# POST /api/analyses: 10 per hour per user
# GET /api/analyses: 100 per hour per user
# POST /api/analyses/search: 50 per hour per user
# GET /api/health: Unlimited (monitoring)
```

### Input Validation

All API endpoints must validate input:

```typescript
// Example: Validate URL in analyses endpoint
import { z } from 'zod';

const urlSchema = z.string().url();

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { url } = urlSchema.parse(body);
  // ... continue
}
```

### CORS Configuration

```typescript
// Configured in API routes
const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
```

### Error Handling

- [ ] Never expose stack traces to clients
- [ ] Log full errors to Sentry (server-side only)
- [ ] Return generic error messages to users
- [ ] 404 for missing resources (don't leak existence)

---

## Authentication & Authorization

### OAuth Configuration

**Google OAuth**:
- [ ] Only approve specific redirect URIs
- [ ] Enable PKCE for SPAs
- [ ] Store refresh tokens securely
- [ ] Revoke on logout

**GitHub OAuth**:
- [ ] Limit scopes (read:user, public_repo only)
- [ ] Store tokens in secure HTTP-only cookies
- [ ] Implement token refresh

### Session Management

```typescript
// Configured in web/lib/auth.ts
// Sessions stored in secure, HTTP-only cookies
// CSRF protection enabled
// Token expiration: 24 hours
```

### Permission Checks

All protected routes must verify user:

```typescript
// Example: Check authentication in API route
import { auth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check user has permission for this resource
  // ...
}
```

---

## Monitoring & Incident Response

### Error Tracking (Sentry)

- [ ] Sentry project created
- [ ] Error alerts configured
- [ ] Alert notification channels set up
- [ ] Integration with Slack/PagerDuty

**Monitor for**:
- Authentication failures
- Database connection errors
- API rate limit violations
- Unusual error spikes

### Security Alerts

**Configure in Sentry**:
```
Alert: Error count > 100 in 5 minutes
Action: Send to #security-alerts Slack channel
```

### Audit Logging

Log all sensitive operations:

```sql
-- Example audit log table
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,  -- 'delete_analysis', 'export_data', etc.
  resource_type TEXT NOT NULL,  -- 'analysis', 'user', etc.
  resource_id UUID,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Incident Response

**On security incident**:

1. **Immediately**:
   - [ ] Investigate in Sentry
   - [ ] Check logs in Vercel
   - [ ] Review database activity
   - [ ] Check Git history for suspicious commits

2. **Within 1 hour**:
   - [ ] Determine scope (how many users affected)
   - [ ] Identify root cause
   - [ ] Create incident ticket
   - [ ] Notify affected users (if needed)

3. **Within 24 hours**:
   - [ ] Deploy fix
   - [ ] Rotate affected credentials
   - [ ] Post-mortem analysis
   - [ ] Document lessons learned

---

## Security Headers

All security headers configured in `vercel.json` and `next.config.ts`:

### Response Headers

```
X-Content-Type-Options: nosniff
  Prevents MIME-sniffing attacks

X-Frame-Options: DENY
  Prevents clickjacking

X-XSS-Protection: 1; mode=block
  Legacy XSS protection

Referrer-Policy: strict-origin-when-cross-origin
  Controls referrer information

Permissions-Policy: geolocation=(), microphone=(), camera=()
  Disables unused browser features

Cache-Control: no-cache, no-store, must-revalidate
  Prevents caching of sensitive content (API routes)

Strict-Transport-Security: max-age=31536000; includeSubDomains
  HSTS enforced (auto via Vercel)
```

### Request Validation

```typescript
// Validate Content-Type
if (!request.headers.get('content-type')?.includes('application/json')) {
  return NextResponse.json({ error: 'Invalid Content-Type' }, { status: 400 });
}

// Validate Origin
const origin = request.headers.get('origin');
if (origin && !isAllowedOrigin(origin)) {
  return NextResponse.json({ error: 'CORS denied' }, { status: 403 });
}
```

---

## Security Testing

### OWASP Top 10

Test for common vulnerabilities:

- [ ] **A01:2021** – Broken Access Control (check RLS policies)
- [ ] **A02:2021** – Cryptographic Failures (check TLS, at-rest encryption)
- [ ] **A03:2021** – Injection (test SQL, command injection)
- [ ] **A04:2021** – Insecure Design (threat modeling, design review)
- [ ] **A05:2021** – Security Misconfiguration (check headers, env vars)
- [ ] **A06:2021** – Vulnerable Dependencies (pnpm audit)
- [ ] **A07:2021** – Identification & Authentication Failures (test OAuth, sessions)
- [ ] **A08:2021** – Software & Data Integrity Failures (check Git history)
- [ ] **A09:2021** – Logging & Monitoring Failures (verify Sentry, logs)
- [ ] **A10:2021** – Server-Side Request Forgery (SSRF) (validate URLs, allowlists)

### Penetration Testing

Schedule annual penetration testing with security firm.

---

## Compliance

### GDPR

- [ ] User can request data export
- [ ] User can request account deletion
- [ ] Privacy policy published
- [ ] Terms of service updated
- [ ] Cookie consent implemented (if applicable)

### Data Processing

- [ ] Data processing agreements signed
- [ ] Data retention policies documented
- [ ] Breach notification procedure defined
- [ ] DPA with Supabase reviewed

---

## Resources

- **OWASP**: https://owasp.org/
- **CWE**: https://cwe.mitre.org/
- **SANS**: https://www.sans.org/
- **Snyk**: https://snyk.io/
- **Dependabot**: https://dependabot.com/

---

## Contacts

- **Security Lead**: [name] ([email])
- **On-Call Security**: Check PagerDuty rotation
- **Report Vulnerability**: security@hex-tech-lab.com
- **Incident Channel**: #security-incidents (Slack)

---

**Last Updated**: 2026-05-14  
**Review Schedule**: Quarterly or after security incident
