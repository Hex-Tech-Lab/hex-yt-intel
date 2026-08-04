# Sprint 1 P0 — Remove Mock HMAC Secret from Source

## 1. RCA
The file `scripts/deploy-hmac-secret.sh` contained a hardcoded production `STREAM_HMAC_SECRET` value (`SSqdnev979rW2Z2b/x2J7UQ8/Veo1HfA21WU6L8elqU=`), along with hardcoded Vercel `PROJECT_ID` and `TEAM_ID`. Anyone with repo access had the production secret. Additionally, `scripts/deploy-hmac-secret.sh` also hardcoded `PROJECT_ID`, `TEAM_ID`, and a placeholder `WORKER_ACCOUNT_ID`.

## 2. Contract
- Remove all hardcoded secrets, project IDs, and team IDs from `scripts/deploy-hmac-secret.sh`
- Make the script read all sensitive values from environment variables at runtime
- Fail closed if any required env var is missing
- The script must still work when invoked with the correct env vars
- Document the correct usage pattern

## 3. Fix
- **`scripts/deploy-hmac-secret.sh`**: Changed from hardcoded values to env var reads:
  - `HMAC_SECRET` → reads from `$STREAM_HMAC_SECRET` (required, fail-closed)
  - `PROJECT_ID` → reads from `$VERCEL_PROJECT_ID` (required)
  - `TEAM_ID` → reads from `$VERCEL_TEAM_ID` (required)
  - `WORKER_ACCOUNT_ID` → reads from `$CLOUDFLARE_ACCOUNT_ID` (with fallback placeholder)
- Added a fail-closed guard: if `STREAM_HMAC_SECRET` is not set, the script exits immediately with a usage message
- Updated the usage comment to show the correct invocation pattern

## 4. Tangents
- Discovered `scripts/validate-env.js` and `scripts/poll-logs-snapshot.sh` — both correctly use env vars, no hardcoded secrets
- `scripts/quality-engine/calibration/data/multi-smell-dataset-v1_2.csv` contains third-party Apache project data with HMAC references — irrelevant (test/calibration data)
- Test files (`stream-token-security.test.ts`, `content-sig-binding.test.ts`, `chat-stream-requestId.test.ts`) contain test-only secret values — acceptable as they're never used outside tests
- **The compromised secret `SSqdnev979rW2Z2b/x2J7UQ8/Veo1HfA21WU6L8elqU=` should be rotated** — this is a production secret that was exposed in Git. The person who originally set it should generate a new one and update the Vercel/Cloudflare environment variables.

## 5. Skills Run
- `owasp-top-10` — checked A02 (Cryptographic Failures) and A05 (Security Misconfiguration) to ensure the fix follows best practices for secret management
- `build-graph` — updated code review knowledge graph

## 6. Gates
- `tsc --noEmit`: ✅ Passed (bash script, no TypeScript changes)
- `vitest run` (59 files, 973 tests): ✅ Passed

## 7. Files Changed
- `scripts/deploy-hmac-secret.sh` — replaced hardcoded secret + project IDs with env var reads (lines 1–16)