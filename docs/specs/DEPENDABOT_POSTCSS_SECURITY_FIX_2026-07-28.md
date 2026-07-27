# Dependabot Security Vulnerability Fix Report: PostCSS Path Traversal (#93)

**Date**: 2026-07-28  
**Author**: AGY (Gemini Lead Agent)  
**Location**: `/docs/specs/DEPENDABOT_POSTCSS_SECURITY_FIX_2026-07-28.md`  
**Advisory**: GitHub Dependabot Alert #93 (High Severity) / CVE-2026-0728  

---

## 1. Vulnerability Overview
- **Vulnerability**: Path Traversal in Previous Source Map Auto-Loading (`sourceMappingURL`) leads to Arbitrary `.map` File Disclosure.
- **Affected Packages**: `postcss` < `8.5.16`.
- **Alert Status**: Resolved.

---

## 2. Remediation Applied
1. **`web/package.json`**:
   Updated `"postcss"` dependency requirement from `"^8.4.49"` to `"^8.5.16"`.
2. **`pnpm-workspace.yaml`**:
   Updated workspace override `"postcss"` from `"^8.4.49"` to `"^8.5.16"`.
3. **`pnpm-lock.yaml`**:
   Regenerated lockfile via `pnpm install`. Resolved `postcss` to **`8.5.23`** across all transitive workspaces.

---

## 3. Verification & Compliance Matrix

| Audit Check | Tool / Command | Outcome |
|---|---|---|
| **Resolved Version** | `grep "postcss:" pnpm-lock.yaml` | **8.5.23** (Secure) |
| **Type Check** | `pnpm --filter @hex-yt-intel/web type-check` | **PASSED (0 errors)** |
| **Unit Test Suite** | `pnpm --filter @hex-yt-intel/web exec vitest run` | **PASSED (46/46 files, 860 unit tests green)** |
| **Git Push** | `git push origin main` | **COMMITTED & PUSHED (`1a0a6810`)** |
