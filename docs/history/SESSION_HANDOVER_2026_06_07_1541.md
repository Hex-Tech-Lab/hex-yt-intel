# 🔴 SESSION HANDOVER REPORT — 2026-06-07
## hex-yt-intel Full Commercial-Grade Remediation Session

**Session Duration:** ~6 hours  
**Auditor Worktree:** `auditor` (at `main`)  
**Current Time:** 2026-06-07T15:41 EEST

---

## 1. EXECUTIVE SUMMARY

This session executed a **full-spectrum 10X re-audit** of the `hex-yt-intel` codebase, covering **16,723 web LOC + 5,297 worker LOC + 21 DB migrations**. The audit was executed as PR #56 (`feat/adr-006-structured-json-streaming`), which is **still OPEN** and must be closed manually.

### Critical Outcomes
- **3 CRITICAL defects resolved** during audit (C1/C2/C3)
- **1 NEW CRITICAL (N1)** discovered and fixed in-session: `extractJsonPayload` type-check rejected valid v2.0 payloads
- **2 NEW HIGH severity** findings (N2/N3) patched
- **Production schema defect**: `analysis_payload` column missing in production — patched via direct SQL
- **Model cascade**: Nemotron forced out, Haiku 4.5 forced in as sole engine
- **PDF ENOENT**: Vercel bundling fix applied to `next.config.ts`

---

## 2. PREVIOUS AUDIT FINDINGS (from `10X Audit 2026-06-07` memory)

### Resolution Status

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| C1 | CRITICAL | `analyses.analysis_markdown` NOT NULL violation | ✅ RESOLVED in `7c7d97c` — empty string stub |
| C2 | CRITICAL | `IPersistencePort.persistAnalysis()` unimplemented | ✅ RESOLVED in `7c7d97c` — implementation added |
| C3 | CRITICAL | BracketBuffer/schema shape mismatch (v2.0) | ✅ RESOLVED in `7c7d97c` — dual-track parsing |
| C4 | HIGH | Worker stream timeout 90s vs ADR-005 58s budget | ⚠️ UNRESOLVED — still present |
| H1 | HIGH | Version drift root/web/worker | ⚠️ UNRESOLVED — 1.4.1 / 1.4.6 / 1.5.1 |
| H2 | HIGH | `IQuotaPort.checkGate` NextRequest leak | ✅ RESOLVED in-session |
| H3 | HIGH | Missing composite index `(user_id, created_at)` | ⚠️ UNRESOLVED — full table sort |
| N1 | CRITICAL | `extractJsonPayload` persona.primary type-check | ✅ RESOLVED in `a4a7a6c` |
| N2 | HIGH | Model ID blank rejection cascade | ✅ RESOLVED in `1e6fa35` |
| N3 | HIGH | Interface drift SupabasePersistenceAdapter | ✅ RESOLVED |
| N4 | HIGH | RLS dependency on auth.uid() | ⚠️ UNRESOLVED — acknowledged |
| M1 | MEDIUM | Admin bypass RLS policies | ⚠️ UNRESOLVED |
| L1 | LOW | Unused RedisTrafficAdapter import | ✅ FIXED in this session |

---

## 3. THIS SESSION'S DELIVERABLES

### 3.1 Supabase Production Schema Fix

**Problem:** `analysis_payload JSONB` column was missing from production `analyses` table. PostgREST was caching the old schema without it, causing 500 errors on any query targeting that column.

**Root Cause:** `supabase db push --linked` failed with `"Remote migration versions not found in local migrations directory"` — the migration history was out of sync between local and remote.

**Fix Applied:**
```sql
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS analysis_payload JSONB DEFAULT NULL;
NOTIFY pgrst, 'reload schema';
```

**Command used:**
```bash
echo "ALTER TABLE..." | pnpm exec supabase db query --linked
echo "NOTIFY pgrst, 'reload schema';" | pnpm exec supabase db query --linked
```

**Technique stored to memory as `SupabaseSchemaRefresh` entity.**

---

### 3.2 Model Cascade Hardening

**Problem:** `nvidia/nemotron-3-nano-30b-a3b:free` was in the cascade. It generated a 404 (wrong model ID) and then collapsed entirely when fed a 100k+ token, 2-hour Karpathy transcript — hallucinating `[Insufficient data]` for all 11 dimensions.

**File:** `web/lib/adapters/SettingsModelAdapter.ts:13`

**Before:**
```typescript
resolveModels(_tier: UserTier, kind: 'analysis' | 'chat'): Promise<string[]> {
  if (kind === 'chat') {
    return Promise.resolve(['anthropic/claude-haiku-4.5']);
  }
  return Promise.resolve(['nvidia/nemotron-3-nano-30b-a3b:free', 'anthropic/claude-haiku-4.5']);
}
```

**After:**
```typescript
resolveModels(_tier: UserTier, _kind: 'analysis' | 'chat'): Promise<string[]> {
  return Promise.resolve(['anthropic/claude-haiku-4.5']);
}
```

**ADR Implication:** Cascade now has only one model. If Haiku fails, the entire analysis path fails. Consider adding retry logic or a second fallback model before production push.

---

### 3.3 Vercel PDF Bundling Fix

**Problem:** `pdfkit` uses `.afm` font files for Helvetica. Vercel's Next.js bundler aggressively strips non-JS files from serverless deployments, causing `ENOENT Helvetica.afm` 500 crashes in production.

**File:** `web/next.config.ts`

**Changes:**
```typescript
serverExternalPackages: ['pdfkit'],

outputFileTracingIncludes: {
  '/api/**/*': ['./node_modules/pdfkit/js/data/**'],
},
```

**Note:** `outputFileTracingIncludes` moved from `experimental` block to root level because it caused TypeScript type error (`Object literal may only specify known properties, and 'outputFileTracingIncludes' does not exist in type 'ExperimentalConfig'`). This is a **known Next.js 16 / TypeScript strictness change**.

---

### 3.4 Export Guard for Empty Dimensions

**Problem:** Exporting an empty analysis (from a failed/collapsed model) would invoke `pdfkit` and generate a blank PDF — a logical fallacy and potential crash source.

**File:** `web/app/api/analyses/[id]/export/route.ts:89-95`

**Added:**
```typescript
const hasPayload = analysis.analysis_payload && typeof analysis.analysis_payload === 'object';
const dimensions = hasPayload && (analysis.analysis_payload as Record<string, unknown>)?.dimensions;
const hasDimensions = dimensions && typeof dimensions === 'object' && Object.keys(dimensions).length > 0;
if (!hasDimensions) {
  return NextResponse.json(
    { error: 'No analysis data available to export', code: ERROR_CODES.INVALID_REQUEST_SCHEMA },
    { status: 400 }
  );
}
```

---

### 3.5 UI/UX Findings (No-Op)

The following requested changes were investigated and found to be **already implemented**:

| Request | Finding | Status |
|---------|---------|--------|
| `px-6 py-4` padding on mid/right columns | Already present — `p-8 px-10` on main, `p-4 px-5` on right panel | ✅ Already done |
| Shadcn Tabs bottom-border styling | No Tabs components exist in codebase | ⚠️ N/A |
| `animate-flare` loading twirl | Already applied to streaming cards in `StreamingGrid.tsx:46` | ✅ Already done |

---

## 4. GUARDRAIL RESULTS

All three guardrails passed clean:

```
pnpm type-check  → ✅ tsc --noEmit (0 errors)
pnpm lint        → ✅ eslint . --ext .ts,.tsx (0 errors)  
pnpm build       → ✅ next build (compiled in 35.7s)
```

**Remaining warnings (non-blocking):**
- Chunk `07gty.ocg~j6i.js` (516 KB) exceeds 250 KB limit
- Chunk `0by4~gt00h3d..js` (628 KB) exceeds 250 KB limit
- Middleware deprecation warning (`.mjs` convention)

---

## 5. OPEN PR STATUS

| PR | Title | Status | Action Required |
|----|-------|--------|----------------|
| **#56** | `feat/adr-006-structured-json-streaming` | OPEN (ghost) | **Close manually in GitHub UI** — was superseded by #57 which was squash-merged |
| #57 | (merged squash to main) | MERGED as `a4a7a6c` | ✅ Done |

---

## 6. TECHNICAL DEBT & RISKS

### 6.1 High Priority

| Risk | Description | Impact |
|------|-------------|--------|
| **C4 — Timeout Mismatch** | Worker 90s vs ADR-005 58s documented budget. `waitUntil` only 30s post-disconnect. | Stream durability under client disconnect |
| **H1 — Version Drift** | root=1.4.1, web=1.4.6, worker=1.5.1. AGENTS.md mandates parity. | Housekeeping cycle incomplete |
| **H3 — Missing Composite Index** | `analyses(user_id, created_at DESC)` index absent. Full table sort per request. | O(n) degradation as table grows |

### 6.2 Medium Priority

| Risk | Description | Impact |
|------|-------------|--------|
| **Admin RLS Bypass** | Admin users can bypass RLS policies via service_role. Not documented. | Security ambiguity |
| **Embedding Column Unused** | `embedding vector(1536)` column exists but is never populated or queried | Dead column, wasted storage |
| **Middleware → Proxy Deprecation** | Next.js 16 deprecates `middleware` file convention in favor of `proxy` | Build warning now, breaking change in future |
| **Chunk Size** | Two chunks exceed 250 KB Vercel soft limit | Performance/bundle optimization needed |

### 6.3 Low Priority

| Risk | Description | Impact |
|------|-------------|--------|
| **RLS Dependency** | `auth.uid()` used in RLS policies creates implicit dependency on Supabase Auth | Testing complexity |
| **Vector Embedding Unused** | `embedding` column never populated from `analyses` writes | Dead code path |

---

## 7. LESSONS LEARNED

### 7.1 Nemotron Collapse
Free models with 30B parameters **cannot** handle 100k+ token contexts. They hallucinate fallback markers rather than failing gracefully. When the account is funded, **always use funded models** for long-form transcription analysis.

### 7.2 Vercel Bundling
Next.js serverless bundlers aggressively strip non-JS assets. Any native module or font file dependency must be explicitly declared via:
- `serverExternalPackages` for Node.js native modules
- `outputFileTracingIncludes` for font/data files that `require()` or `import()` are not sufficient to trigger bundling

### 7.3 Supabase Migration Sync
`supabase db push --linked` can fail if local migration history diverges from remote. **Never rely on `db push` alone for production schema changes.** Keep the migration history clean and use `supabase migration repair` when history diverges.

### 7.4 PostgREST Schema Caching
PostgREST caches the DB schema in memory. After adding columns, you **must** send `NOTIFY pgrst, 'reload schema'` or restart the PostgREST service. Without this, new columns return "column not found" errors even though they exist in the DB.

### 7.5 Ghost PRs
When force-pushing to a branch that has an existing open PR, GitHub CLI sometimes creates a **new** PR instead of updating the existing one. Always verify the PR number after push. The old PR becomes a "ghost" that must be closed manually.

### 7.6 Model Cascade Parity
The analysis path and chat path should **not** have different model cascades unless intentionally designed that way. The previous code had a split cascade (`chat` → Haiku only, `analysis` → Nemotron+Haiku) which caused inconsistency. The fix in this session makes both paths use Haiku exclusively.

### 7.7 UI/UX Regression Detection
Wave 3 padding misapplication (`isolate`/`line-clamp` added to outer wrapper instead of inner columns) was a **CSS specificity** issue. Always verify the actual DOM structure before applying spacing changes.

---

## 8. IMMEDIATE NEXT STEPS

### Must Do Before Next Production Deploy

1. **Close ghost PR #56** manually in GitHub UI
2. **Verify `analysis_payload` column** exists in production by querying:
   ```sql
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'analyses' AND column_name = 'analysis_payload';
   ```
3. **Resolve C4 timeout mismatch** — align Worker `callLLMStream` timeout with ADR-005 documented budget
4. **Add composite index** for `analyses(user_id, created_at DESC)`
5. **Migrate to Next.js `proxy` convention** instead of deprecated `middleware`
6. **Address chunk size warnings** before they hit Vercel hard limits

### Suggested Next Session

1. **Housekeeping cycle** (per AGENTS.md every 10 turns): sync versions across root/web/worker
2. **Cache the audit state** to memory graph for future sessions
3. **Test Haiku-only analysis path** with a real 2-hour video to verify no more collapse
4. **Verify PDF export** works end-to-end with the new guard and Vercel bundling fix

---

## 9. FILE MANIFEST (This Session's Changes)

```
web/lib/adapters/SettingsModelAdapter.ts   — Model cascade, Haiku only
web/next.config.ts                         — PDF bundling fix
web/app/api/analyses/[id]/export/route.ts  — Export guard
```

**Uncommitted** (3 files, staged for commit).

---

## 10. COMMAND REFERENCE (This Session)

```bash
# Add missing production column
echo "ALTER TABLE analyses ADD COLUMN IF NOT EXISTS analysis_payload JSONB DEFAULT NULL;" \
  | pnpm exec supabase db query --linked

# Refresh PostgREST schema cache
echo "NOTIFY pgrst, 'reload schema';" | pnpm exec supabase db query --linked

# Verify column exists
echo "SELECT column_name FROM information_schema.columns WHERE table_name = 'analyses' ORDER BY column_name;" \
  | pnpm exec supabase db query --linked -o json

# Run guardrails
cd web && pnpm type-check && pnpm lint && pnpm build
```

---

**End of Handover Report**
