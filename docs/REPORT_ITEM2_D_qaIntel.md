# Item 2 (D) — qa-intel False Positive Fixes

## 1. RCA
Five categories of false positives in the quality engine:

1. **Severity tier suppression**: `verify-quality-engine.ts` exited early on critical findings, never printing medium/low issues — masking lower-severity regressions
2. **Missing upsert check**: DB operation rule (`data-integrity.ts`) only flagged bare `insert` without `onConflict`, but `upsert` is the correct Supabase pattern and was incorrectly flagged
3. **POST-307 not scoped to handler**: `security.ts` scanned the entire file for `307` — a GET handler using 307 (harmless) would false-positive
4. **userId in sensitive patterns**: `userId` in URL paths was flagged as a hardcoded sensitive ID, but it's a legitimate route parameter
5. **Empty-catch without comment exemption**: `streaming.ts` flagged any empty catch block, even those containing only a comment explaining why it's empty

## 2. Contract
- All severity tiers must print before any exit
- `upsert` must not be flagged by the DB operation rule
- POST-307 detector must scope to the POST handler body only
- `userId` must not be flagged as a sensitive ID in route params
- Catch blocks containing only comments must be exempt

## 3. Fix
- `scripts/verify-quality-engine.ts` (lines 288–322): Restructured to collect all tiers (`criticalFindings`, `highFindings`, `nonCritical`) and print them independently before any `process.exit()` call
- `scripts/quality-engine/rules/data-integrity.ts`: Added `upsert` to the allowed operation set
- `scripts/quality-engine/rules/security.ts` (lines 205–224): Scoped 307 check to only the POST handler body using regex extraction of the function body
- `scripts/quality-engine/rules/security.ts`: Removed `userId` from the sensitive ID pattern list
- `scripts/quality-engine/rules/streaming.ts`: Exempted catch blocks where all statements are comments (comment-only body)

## 4. Tangents
- The `qa-intel` skill itself was run to validate the fixes
- The severity reporting fix also uncovered that medium/low findings were never surfaced in CI — now they are advisory but visible

## 5. Skills Run
- `qa-intel` — run to verify fixes resolve the false positives
- `supabase-postgres-best-practices` — consulted for `upsert` pattern validation

## 6. Gates
- `tsc --noEmit`: ✅ Passed
- `vitest run` (59 files, 973 tests): ✅ Passed
- `qa-intel` baseline comparison: ✅ No new issues, false positives resolved

## 7. Files Changed
- `scripts/verify-quality-engine.ts` — tier reporting restructure (lines 288–322)
- `scripts/quality-engine/rules/data-integrity.ts` — upsert check added
- `scripts/quality-engine/rules/security.ts` — POST-307 handler scoping (lines 205–224), userId removal
- `scripts/quality-engine/rules/streaming.ts` — comment-only catch exemption