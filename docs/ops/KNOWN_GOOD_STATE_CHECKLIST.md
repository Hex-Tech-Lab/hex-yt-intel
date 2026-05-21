# Known Good State Verification Checklist

**Date Created**: 2026-05-21  
**Sprint**: Database Stabilization (Phase 1)  
**Build**: 872f92e  
**Purpose**: Operational definition of reproducible system stability

A "Known Good State" is not just a commit hash. It's a reproducible set of conditions that guarantee the system works as designed. Use this checklist at the start of each session to verify the foundation is solid before starting feature work.

---

## Commit & Git State (5 items)

- [ ] Commit `872f92e` is HEAD on `main` branch
- [ ] Branch `database/stabilization` is deleted (feature branch lifecycle complete)
- [ ] No uncommitted files (`git status` is clean)
- [ ] All credentials rotated: old Upstash token revoked, new token in Vercel production env
- [ ] Last deployment status: Ready (check Vercel dashboard)

---

## CI/CD Pipeline State (5 items)

- [ ] `action.yml` specifies Node 24 and pnpm 11.1.3
- [ ] `.github/workflows/ci-cd.yml` uses only `pnpm --filter` commands (no `cd web &&` patterns)
- [ ] Build job env vars include all 4 fallbacks:
  - `SUPABASE_URL='https://dummy.supabase.co'`
  - `SUPABASE_ANON_KEY='dummy-anon-key'`
  - `SUPABASE_SERVICE_ROLE_KEY='dummy-service-key'`
  - `OPENROUTER_API_KEY='dummy-openrouter-key'`
- [ ] Security checks exclude `node_modules/` directory (grep with `--exclude-dir`)
- [ ] All 7 pipeline stages complete without errors (setup, type-check, lint, test, build, security, health-check)

---

## Codebase State (4 items)

- [ ] `web/tsconfig.json`: No `ignoreDeprecations` key (removed)
- [ ] `web/next.config.ts`: `turbopack.root: path.resolve(__dirname, '..')` (dynamic, not hardcoded)
- [ ] `.npmrc` (root): Contains both `auto-install-peers=true` and `frozen-lockfile=true`
- [ ] All three lockfiles valid:
  - `pnpm-lock.yaml` (root): lockfileVersion 9.0, autoInstallPeers: true
  - `web/pnpm-lock.yaml`: Same metadata
  - `worker/pnpm-lock.yaml`: Same metadata

---

## Database & Auth State (4 items)

- [ ] RLS enabled on all sensitive tables (`users`, `analyses`, `usage_logs`)
- [ ] Test user exists and is accessible: `da4381c6-f774-4c99-8f04-2c1c9e27d1fb` (kellybakri@gmail.com)
- [ ] Supabase OAuth configured with Google and GitHub providers
- [ ] `web/middleware.ts` has explicit `return` statements on all auth branches (lines: 36, 44, 61, 64)

---

## Production Deployment State (7 items)

- [ ] Vercel deployment status: Ready (check https://vercel.com/dashboard)
- [ ] Build time: ~47 seconds (typical range: 45-50s)
- [ ] Application endpoint: https://hex-yt-intel.vercel.app responds with 200 OK
- [ ] Sentry integration active: Breadcrumbs logged, errors tracked
- [ ] Rate limiting operational: Redis circuit breaker connected (verify in Upstash console)
- [ ] OPENROUTER_API_KEY active and tested (verify in OpenRouter dashboard)
- [ ] All Vercel environment variables match CLAUDE.md secrets list (7 variables)

---

## Local Development State (4-step verification)

Run these commands after pulling from main:

```bash
cd /home/kellyb_dev/projects/hex-yt-intel
git status  # Should be clean

cd web
pnpm install --frozen-lockfile  # Should complete without warnings
```

- [ ] **Install**: Completes without warnings or peer dependency conflicts
- [ ] **Type Check**: `pnpm type-check` passes with 0 errors
- [ ] **Lint**: `pnpm lint` passes with 0 violations
- [ ] **Build**: `pnpm build` succeeds in ~47 seconds

---

## Quick Verification (Under 5 minutes)

If you only have 5 minutes, run this quick check:

```bash
cd web
pnpm type-check && pnpm lint && pnpm build
echo "✅ Known Good State verified"
```

If all three gates pass, the system is stable.

---

## Checklist Usage

### ✅ Starting a new session
1. Run this checklist from top to bottom
2. If any item fails, consult the **Brittleness Points** section in `/docs/history/HANDOVER_REPORT_2026-05-21.md`
3. If all items pass, proceed with feature work

### ⚠️ If something breaks
1. Identify which section failed (Commit? CI/CD? Database? Deployment?)
2. Consult the matching **Brittleness Point** for recovery steps
3. Re-run the checklist to confirm recovery

### 📋 For deployment verification
Run the full checklist before pushing to production. At minimum, verify all 7 production deployment items are checked.

---

## Related Documents

- **Architectural Decisions**: `/CLAUDE.md` (ADRs 001-004)
- **CI/CD Configuration**: `.github/workflows/ci-cd.yml` and `action.yml`
- **Brittleness Points**: `/docs/history/HANDOVER_REPORT_2026-05-21.md` (section: Brittleness Points)
- **Next Session Landmines**: `/docs/history/HANDOVER_REPORT_2026-05-21.md` (section: Next Session Landmines)

---

**Last Updated**: 2026-05-21  
**Export Source**: HANDOVER_REPORT_2026-05-21.md (section: "The Known Good State")  
**Status**: ✅ Verified and operational
