# Item 4 (F) — Cost-Formatter Consolidation

## 1. RCA
Three different call sites had duplicated cost-formatting logic with slightly different precision:

- `UsersAdminClient.tsx`: `(cost / 100).toFixed(4)` — 4 decimal places
- `UsageTab.tsx`: `(cost / 100).toFixed(2)` — inline formatting
- `billing-dashboard-client.tsx`: `(x / 100).toFixed(2)` — cents-to-usd conversion

This violated DRY and risked precision drift.

## 2. Contract
- Create shared helpers in `web/lib/utils/format.tsx` (`.tsx` for JSX compatibility)
- `fmtUsd`: converts cents to USD string with 2 decimal places, handles zero, handles micro-amounts
- `fmtCentsToUsd`: converts cents to raw number with 2 decimal places
- Update all 3 callers to import and use the shared helpers
- Preserve exact output format (no behavioral changes)

## 3. Fix
- Added `fmtUsd` (line 10) and `fmtCentsToUsd` (line 20) to `web/lib/utils/format.tsx`
- Updated `UsersAdminClient.tsx` (line 3): imports `fmtUsd`, replaces `(cost / 100).toFixed(4)`
- Updated `UsageTab.tsx` (line 5): imports `fmtUsd`, replaces inline `(cost / 100).toFixed(2)`
- Updated `billing-dashboard-client.tsx` (line 10): imports `fmtCentsToUsd`, replaces `(x / 100).toFixed(2)`

## 4. Tangents
- The file extension is `.tsx` (not `.ts`) because it's in a directory with other `.tsx` files and the project's tsconfig expects `.tsx` for JSX
- `fmtCost` (the old function) was removed from `UsersAdminClient.tsx` after confirming it was unused elsewhere

## 5. Skills Run
- `ponytail` — used to keep the helper functions minimal and avoid over-engineering
- `vercel-react-best-practices` — consulted for React component patterns

## 6. Gates
- `tsc --noEmit`: ✅ Passed
- `vitest run` (59 files, 973 tests): ✅ Passed
- `qa-intel`: ✅ No regressions

## 7. Files Changed
- `web/lib/utils/format.tsx` — added `fmtUsd`, `fmtCentsToUsd` (lines 10, 20)
- `web/app/admin/users/UsersAdminClient.tsx` — replaced `fmtCost` with `fmtUsd` import
- `web/components/templates/console/UsageTab.tsx` — replaced inline formatting with `fmtUsd` import
- `web/components/billing/billing-dashboard-client.tsx` — replaced inline formatting with `fmtCentsToUsd` import