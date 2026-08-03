# Item 1 (B9) — Admin Export Fix

## 1. RCA
Admin users could not export analyses belonging to other users. The export route at `web/app/api/analyses/[id]/export/route.ts` always filtered by `user_id` matching the caller's identity, regardless of role. No admin bypass existed.

## 2. Contract
- Admin users must be able to export any analysis by ID
- Non-admin users must remain restricted to their own analyses
- No regression in the existing export functionality
- Must pass `tsc --noEmit` and existing test suite

## 3. Fix
Added role-based access control in the export route handler:
- **Lines 81–87**: Queried `users.role` via service client to check if the caller is admin
- **Lines 104–106**: Conditional query — `if (!isAdmin) { query.eq('user_id', userId); }` — admins skip the `user_id` filter

## 4. Tangents
- No other API routes had the same gap; the admin check pattern was already present in other admin routes
- The `owasp-top-10` skill confirmed this was an access-control issue (A01 Broken Access Control)

## 5. Skills Run
- `owasp-top-10` — mandatory for access-control changes; confirmed the fix aligns with A01 remediation
- `supabase` — used for understanding the service client pattern

## 6. Gates
- `tsc --noEmit`: ✅ Passed
- `vitest run` (59 files, 973 tests): ✅ Passed
- `qa-intel`: ✅ No regressions (baseline-comparison mode)

## 7. Files Changed
- `web/app/api/analyses/[id]/export/route.ts` — added admin bypass (lines 81–87, 104–106)