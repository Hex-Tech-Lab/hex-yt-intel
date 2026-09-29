# OC TASK DIRECTIVE: WAVE 9 - E2E REAPER INTEGRATION & LINT RECONCILIATION

**Role:** Systems & Test Engineer (OC GLM-5.3-flash)
**Providers:** `baseten`, `modal`. `allow_fallbacks: false`.
**Constraint:** Unified diffs only. No explanations.

---

### Task 1: Clean up unused `container` variables in HighlightsScrubber.test.tsx
- **File:** `web/components/dashboard/__tests__/HighlightsScrubber.test.tsx`
- **Problem:** Linter reported 2 warnings:
  `339:13 warning 'container' is assigned a value but never used`
  `356:13 warning 'container' is assigned a value but never used`
- **Action:** Replace `{ container, findByTestId, findByText }` with `{ findByTestId, findByText }` on lines 339 and 353 (or prefix with `_container`).

---

### Task 2: P1 Reaper End-to-End Integration Test
- **File:** `web/lib/services/__tests__/analysis-reap-policy.integration.test.ts`
- **Objective:** Create a dedicated integration test suite asserting the end-to-end contract between the Reaper's `buildSettlePatch` and Dimension Remediation's `computeMissingDimensions` & candidate selection.
- **Coverage:**
  1. Test reaped analyses with 0, 1, 7, 8, 10, and 11 dimensions.
  2. Assert the exact persisted patch shape for each:
     - 0 dimensions: `billing_status: 'failed'`, `validation_passed: false`, `validation_report.status: 'failed'`.
     - 1 and 7 dimensions: `billing_status: 'failed'`, `validation_passed: false`, `validation_report.status: 'partial'`, `reaped_dimensions: 1` and `7`.
     - 8 and 10 dimensions (usable partials >= MIN_SALVAGEABLE_DIMENSIONS): `billing_status: 'failed'`, `validation_passed: false`, `validation_report.status: 'partial'`, `reaped_dimensions: 8` and `10`.
     - 11 dimensions: `billing_status: 'completed'`, `validation_passed: true`, `validation_report.status: 'complete'`.
  3. Assert that for 1, 7, 8, and 10 dimensions, `computeMissingDimensions` accurately detects missing dimensions (e.g. 10 missing for 1-dim, 4 missing for 7-dim, 1 missing for 10-dim, 0 for 11-dim), proving these rows are targeted for remediation rather than being dropped or billed prematurely.

---

Output the complete, unified diffs.
