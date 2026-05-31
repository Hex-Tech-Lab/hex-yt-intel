# SECURE_DEPLOY.md - Zero-Trust Deployment Protocol

**Location**: `/docs/ops/SECURE_DEPLOY.md`  
**Version**: 1.0.0  
**Status**: ACTIVE  
**Last Updated**: 2026-05-31  

---

## 🛡️ Zero-Trust Philosophy
The `hex-yt-intel` repository operates under a **Zero-Trust Infrastructure** model. We decouple application logic from environment configuration to prevent architectural reconnaissance and credential exposure.

### Core Principles
1. **Secretless Source Control**: No hardcoded secrets, internal hostnames, or PII in any tracked file.
2. **Authoritative CI/CD**: The GitHub Actions pipeline is the singular, verified source of truth for deployments.
3. **Least Privilege**: Workflows operate with `permissions: contents: read` by default, elevation is granted per-job only.
4. **Supply Chain Integrity**: All GitHub Actions are pinned to specific SHAs to prevent upstream injection.

---

## 🔐 Environment Configuration

### Local Development
- Use `.env.local` for all secrets.
- **NEVER** commit `.env` files. Reference `.env.example` for required keys.
- Run `pnpm run build` locally to verify environment validation logic.

### CI/CD (GitHub Actions)
Sensitive variables are injected via **GitHub Secrets**. 

| Secret Key | Purpose | Scope |
|---|---|---|
| `PRODUCTION_SUPABASE_URL` | Supabase endpoint | Production |
| `PRODUCTION_SUPABASE_ANON_KEY` | Public access key | Production |
| `STAGING_SUPABASE_URL` | Staging endpoint | Staging |
| `DEV_TEST_USER_EMAIL` | E2E Test Identity | Testing |
| `VERCEL_TOKEN` | Deployment token | Global |

---

## 🚀 Hardened Workflows

### 1. Permission Isolation
Every workflow starts with a global restriction:
```yaml
permissions:
  contents: read
```
Write permissions (e.g., `pull-requests: write`) are granted only to specific jobs requiring PR comments.

### 2. Action Pinning (SHA)
We use immutable SHAs instead of mutable tags (e.g., `@v4`) to ensure the code we run today is the code we ran yesterday.
- `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` (v4.2.2)
- `actions/cache@d4323d4df104b026a6aa633f9c4b77615317652b` (v4.2.2)

### 3. Internal Hostname Obscurity
Production and Staging URLs are stored in job-level `env` variables or secrets. Health checks use these variables instead of hardcoded strings:
- `${{ env.PRODUCTION_URL }}`
- `${{ env.STAGING_URL }}`

---

## 🔍 Continuous Monitoring
- **Snyk**: Scans for vulnerabilities in dependencies and configuration.
- **CodeQL**: Automated static analysis to detect insecure coding patterns.
- **Pre-flight Guardrails**: `scripts/pre-flight.sh` validates environment consistency before build.

---

## 🛠️ Maintenance & Rotation
- **Credential Rotation**: Secrets should be rotated every 90 days or upon team member offboarding.
- **Workflow Audit**: Review `permissions:` blocks every quarter to ensure they remain minimal.

---

*This document serves as the master reference for secure deployment practices. Any changes to CI/CD architecture must be reflected here first.*
