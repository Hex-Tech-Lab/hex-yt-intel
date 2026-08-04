# Sprint 1 P0 — Restore Quality Engine as CI Gate

## 1. RCA
The qa-intel quality engine was already running in CI (`.github/workflows/ci-cd.yml:130-131`) but without the `--ci` flag, meaning critical and high findings were advisory only, not blocking. No baseline file existed for `--compare` mode, and no `package.json` scripts wired up the quality engine for local use.

## 2. Contract
- Add `--ci --compare` flags to the existing CI step so critical/high findings block the pipeline
- Generate and commit the baseline file (`.qa-intel/baseline.json`)
- Add `package.json` scripts for local use

## 3. Fix
- `.github/workflows/ci-cd.yml` (line 131): Changed `pnpm dlx tsx scripts/verify-quality-engine.ts` → `pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare`
- Generated `.qa-intel/baseline.json` (528KB) via `pnpm dlx tsx scripts/verify-quality-engine.ts --mode full --baseline`
- `package.json`: Added `qa-intel`, `qa-intel:ci`, and `qa-intel:baseline` scripts

## 4. Tangents
- The CI workflow already had a comprehensive setup (type-check, lint, unit-test, build, security-check, env-validation, deploy, DB migration, health check)
- The qa-intel baseline file is 528KB — this is expected for a full scan of the entire codebase
- The `--compare` flag will now catch new findings by comparing against the committed baseline

## 5. Skills Run
- `qa-intel` — run to verify the engine works correctly with `--ci --compare` flags
- `build-graph` — updated code review knowledge graph

## 6. Gates
- `tsc --noEmit`: ✅ Passed
- `vitest run` (59 files, 973 tests): ✅ Passed
- `qa-intel` baseline generation: ✅ Success

## 7. Files Changed
- `.github/workflows/ci-cd.yml` — added `--ci --compare` flags to qa-intel step (line 131)
- `.qa-intel/baseline.json` — new file (528KB, baseline for future comparisons)
- `package.json` — added 3 qa-intel scripts