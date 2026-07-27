# CI Node Engine Alignment & Workflow Update

**Date**: 2026-07-28  
**Author**: AGY (Gemini Lead Agent)  
**Location**: `/docs/ops/CI_NODE_ENGINE_ALIGNMENT_2026-07-28.md`  

---

## 1. Context & Diagnosis
GitHub Actions runner default Node 24 runtime was updated to `v24.18.0`. When `pnpm install` ran, pnpm logged:
```text
web | [WARN] Unsupported engine: wanted: {"node":"24.16.0"} (current: {"node":"v24.18.0","pnpm":"11.9.0"})
```

Because `web/package.json` specified exact `"node": "24.16.0"`, any Node 24 minor/patch release emitted a non-fatal warning during installation.

---

## 2. Changes Applied
1. **`web/package.json`**:
   Updated `"engines.node"` from `"24.16.0"` to `">=24.16.0 <25.0.0"`, allowing all Node 24 LTS patch releases to satisfy engine validation without warnings.
2. **`.github/workflows/ci-cd.yml`**:
   Updated `NODE_VERSION` from `"24.16.0"` to `"24"`.
3. **`.github/workflows/deploy-worker.yml`**:
   Updated `node-version` from `24.16.0` to `24`.

---

## 3. Verification
- `pnpm --filter @hex-yt-intel/web type-check`: **PASSED (0 errors)**.
- `vitest`: **PASSED (46/46 files, 860 unit tests green)**.
- Git Commit [`a023aa14`](https://github.com/Hex-Tech-Lab/hex-yt-intel/commit/a023aa14) pushed to `main`.
