# Sprint 1 P0 — verifyResourceOwnership OOM Risk

## 1. RCA
The `verifyResourceOwnership` function in `web/lib/services/ownership.ts` defaults `select` to `'*'`, which issues `SELECT *` on the `analyses` table. The `analyses` table contains large JSONB columns (`analysis_payload` up to 100K+ bytes, `validation_report`, `analysis_markdown`). In the Vercel Edge runtime (~1MB function memory limit), a `SELECT *` on a row with a full UCIS payload would cause an OOM crash. The OOM risk exists at two levels:

1. **`ownership.ts:18`**: `select: string = '*'` — any future caller omitting `select` gets `SELECT *`
2. **`SupabaseAnalysisAdapter.ts:729`**: `params.select || '*'` — same fallback at the adapter level
3. **`SupabaseChatAdapter.ts:401`**: `params.select || '*'` — same fallback for chat conversations

Current callers all pass explicit columns, so no production OOM is happening today. But the default is a ticking bomb for any new route.

## 2. Contract
- Change the default `select` from `'*'` to a safe minimal set (`'id, user_id'`)
- Update both adapter fallbacks to match
- All current callers must continue to work unchanged (they all pass explicit columns)
- Must pass `tsc --noEmit` and existing test suite

## 3. Fix
- `ownership.ts:18`: Changed default from `'*'` to `'id, user_id'`
- `SupabaseAnalysisAdapter.ts:729`: Changed fallback from `'*'` to `'id, user_id'`
- `SupabaseChatAdapter.ts:401`: Changed fallback from `'*'` to `'id, user_id'`

All 4 current callers pass explicit columns and are unaffected.

## 4. Tangents
- Discovered that the `select` parameter is also optional in both adapter interfaces (`select?: string`), creating a second OOM vector at the adapter level
- The `chat_conversations` table is less risky (smaller rows) but the same defense-in-depth applies
- The `analyses/[id]/graph/route.ts` caller passes `'id'` — the minimal possible select, which is the ideal pattern for ownership-only checks
- Checked for `raw_result` column on `analyses` — not referenced in any current select lists, but would be the biggest OOM risk if added

## 5. Skills Run
- `owasp-top-10` — checked A01 (Broken Access Control) to ensure the ownership check pattern is sound; the fix doesn't change the auth logic, only the data projection
- `supabase-postgres-best-practices` — consulted for query projection optimization
- `build-graph` — updated code review knowledge graph

## 6. Gates
- `tsc --noEmit`: ✅ Passed
- `vitest run` (59 files, 973 tests): ✅ Passed
- `qa-intel`: ✅ No regressions

## 7. Files Changed
- `web/lib/services/ownership.ts` — changed default from `'*'` to `'id, user_id'` (line 18)
- `web/lib/adapters/SupabaseAnalysisAdapter.ts` — changed fallback from `'*'` to `'id, user_id'` (line 729)
- `web/lib/adapters/SupabaseChatAdapter.ts` — changed fallback from `'*'` to `'id, user_id'` (line 401)