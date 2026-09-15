# 10x Re-Audit — Lane C: Database / Supabase (2026-09-05)

Scope: 6 new migrations in `ba94b9bf..HEAD` + Supabase-touching code. Skills invoked: db-arch-10x (structural), database-sentinel (security), supabase-postgres-best-practices (query/schema). Supabase MCP requires OAuth (needs user browser interaction, not available to a one-shot fork) — **not reachable**; local CLI (`pnpm exec supabase migration list`) also fails (`LegacyInvalidAccessTokenError`, no valid access token configured in this sandbox). **ADR 018 live cross-check against `list_migrations` could NOT be performed** — flag for the user to run `pnpm exec supabase db push --dry-run` with a real token before trusting migration state.

All 6 in-window migration files read directly (not trusted from skill narrative alone, per project's known fabrication-history rule): `20260818000000_digest_max_output_tokens.sql`, `20260821120000_highlights_segment_duration_clamps.sql`, `20260821120100_analysis_highlights_takeaway_idx_verbatim_excerpt.sql`, `20260825150000_adr028_temporal_sqlgraph_simhash.sql`, `20260826020000_create_user_subscriptions.sql`, `20260829011500_admin_list_users_activity_grant_authenticated.sql`. Note: the ADR 026 `kg_entity_mentions` normalization migrations (`20260809165422`, `20260809165932`, `20260809173831`, `20260812234150`) all predate the window boundary (`ba94b9bf`, 08-20) — the schema itself shipped earlier; this window's KG/taxonomy work (part of the original master report) was application-layer remediation on top of an already-migrated schema, not new DDL. Correcting that association for the record.

## Findings

### CRITICAL — IDOR via `auth.uid() IS NULL` fail-open in `get_temporal_subgraph` (ADR 028)
**File:** `supabase/migrations/20260825150000_adr028_temporal_sqlgraph_simhash.sql:34-40`

```sql
IF NOT EXISTS (
    SELECT 1 FROM analyses a 
    WHERE a.id = p_analysis_id 
      AND (a.user_id = auth.uid() OR auth.uid() IS NULL) -- Allow service role or owner
) THEN
    RAISE EXCEPTION 'Unauthorized';
END IF;
```
combined with:
```sql
GRANT EXECUTE ON FUNCTION get_temporal_subgraph(UUID) TO authenticated, service_role;
```

**Problem:** `auth.uid() IS NULL` is used as a proxy for "this is the service role" — but EXECUTE is granted to `authenticated` too, and `auth.uid()` can legitimately be NULL for an authenticated-role session in edge cases (a JWT missing/malformed `sub` claim, an anonymous-sign-in-then-upgrade flow, a misconfigured session, or a bug elsewhere in the auth chain). The correct way to detect service-role context in a `SECURITY DEFINER` function is `auth.jwt() ->> 'role' = 'service_role'` (or checking `current_setting('role')`), not "uid happens to be null."

**Failure scenario:** any authenticated user whose JWT resolves `auth.uid()` to NULL (any of the edge cases above) can call `get_temporal_subgraph(p_analysis_id)` for *any* `analysis_id` in the table — not just their own — and receive that analysis's full temporal SimHash anchor mesh (`salient_claim`, `verbatim_anchor` text, i.e. actual transcript content) belonging to another user. This is a cross-tenant data leak (IDOR), the same failure class ADR 009 (Chat Conversation↔Analysis Ownership Binding) was written to prevent elsewhere in this codebase — this new function doesn't follow that established pattern.

**Compounding factor (db-arch-10x × database-sentinel):** the function is also `SECURITY DEFINER`, so it runs with the definer's privileges regardless of caller RLS — meaning RLS on `analyses`/`analysis_simhash_anchors` provides zero backstop here even if it exists elsewhere. This function is the sole authorization boundary, and it's the fail-open kind.

**Fix direction (report only, not applied):** replace the `OR auth.uid() IS NULL` clause with an explicit `OR auth.jwt() ->> 'role' = 'service_role'`, or simply drop `authenticated` from the GRANT if only service-role callers are intended, and have the app call it via a service client with an explicit ownership check in TypeScript instead.

### HIGH — `user_subscriptions` RLS: no INSERT/UPDATE/DELETE policy (verified intentional, but undocumented)
**File:** `supabase/migrations/20260826020000_create_user_subscriptions.sql:18-23`

RLS is enabled with exactly one policy (owner SELECT). No policy exists for INSERT/UPDATE/DELETE, which means those default-deny for `anon`/`authenticated` — writes can only happen via a service-role client that bypasses RLS. **Verified this is actually how it's used**: `web/lib/adapters/PaddleBillingAdapter.ts` imports `getSupabaseServiceClient` (service role) for all 4 `user_subscriptions` table operations found (lines 132, 149, 242, 261). So the *current* code is safe. Downgrading from a would-be Critical to **High-as-a-latent-risk**: there is nothing in the schema or a comment preventing a future PR from adding a client-side write path against this table using the anon/authenticated client and assuming RLS will do something — it silently does nothing for writes. Recommend a comment in the migration stating "writes are service-role-only by design, no INSERT/UPDATE/DELETE policy is intentional" so a future contributor doesn't "fix" the missing policies by adding a permissive one.

### MEDIUM — `get_temporal_subgraph`'s recursive CTE has a bound but the base case ignores `window_start`/`window_end` topology entirely
**File:** same migration, lines 42-74. The recursive step joins `analysis_simhash_anchors a` back to itself via `a.analysis_id = p_analysis_id` (not `a.id != sg.anchor_id` or any exclusion), meaning every recursion re-scans the *entire* anchor set for the analysis, filtered only by the window-adjacency predicate — this is a correctness/perf smell, not a security one: at `depth < 3` and `LIMIT 24` it's bounded and won't runaway, but the query does redundant work (db-arch-10x flag, not urgent — Medium, not blocking).

### LOW — informational
- `admin_list_users_activity` grant migration (`20260829011500`) is a **good pattern** by contrast: explicit `security definer` + internal `users.role='admin'` check (not `auth.uid() IS NULL`), matches this codebase's own documented safe pattern elsewhere. No issue found; the RCA comment in the file itself is accurate and matches the actual SQL (verified, not just trusted).
- `20260821120100`'s `replace_analysis_highlights` and `set_executive_digest_reconciliation` are `security invoker` with EXECUTE revoked from `anon`/`authenticated`/`public` — correctly scoped to service-role-only callers.
- Settings-registry migrations (`digest.maxOutputTokens`, `highlights.min/maxSegmentDurationSeconds`) are clean, idempotent (`on conflict do nothing`), well-commented with real RCA — no findings.

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 1 |
| Medium | 1 |
| Low/informational | 3 |

**MCP cross-check:** did not work — Supabase MCP needs interactive OAuth (unavailable to this fork), and the local CLI has no valid access token in this sandbox. **The user must independently run `pnpm exec supabase db push --dry-run` (with real credentials) before trusting that these 6 migrations are what's actually live** — per ADR 018's addendum, a raw Management API apply can silently desync from local files, and this fork could not verify that risk away.

**Verdict on the admin RPC grant claim** (`20260829011500`): the migration's own RCA comment is accurate and the SQL does what it says (idempotent GRANT + SECURITY DEFINER re-assert) — this part checks out structurally. Whether it's actually *live* on production is the same unverifiable-from-here gap as above.

**Top 3 issues:**
1. **`get_temporal_subgraph` fail-open IDOR** (Critical) — cross-tenant read of analysis transcript content via `auth.uid() IS NULL` escape hatch, granted to `authenticated`.
2. **`user_subscriptions` missing write policies** are safe today but undocumented-as-intentional (High-as-latent-risk).
3. **No live migration-state verification possible** from this sandbox — both remaining lanes/user should treat "6 migrations shipped cleanly" as unconfirmed until a real `db push --dry-run` runs.
