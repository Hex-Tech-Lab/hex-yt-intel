# 10X COMBINED RE-AUDIT III — POST-SESSION DELTA
**Date**: 2026-06-07T15:52 EEST | **Baseline**: `7c7d97c` (Re-Audit II) | **HEAD**: `a4a7a6c` + 3 unstaged
**Delta**: 1 commit (`a4a7a6c`) + 3 unstaged files | **Skills**: code-reviewer · code-simplifier · vercel-composition-patterns · vercel-react-best-practices
**Directive**: REPORT ONLY — NO FIXES

---

## P0 — DELTA SNAPSHOT (Re-Audit II → Re-Audit III)

| Item | Re-Audit II (`7c7d97c`) | Re-Audit III (`a4a7a6c` + unstaged) | Δ |
|---|---|---|---|
| Branch | `main` | `main` | — |
| Commits since baseline | 1 (`7c7d97c`) | 2 (`7c7d97c`, `a4a7a6c`) | +1 |
| Unstaged changes | 0 | 3 files | +3 |
| Untracked | 0 | 1 (handover report) | +1 |
| Files changed (committed) | 29 | 4 (+2 audit docs, +2 source) | +4 |
| Files changed (unstaged) | 0 | 3 (export, SettingsModel, next.config) | +3 |

### Commit `a4a7a6c` — "fix: N1/N2/N3 critical runtime bombs from re-audit"
- `SettingsModelAdapter.ts`: Fixed model ID `'nemotron-3-nano'` → `'nvidia/nemotron-3-nano-30b-a3b:free'` (N2)
- `MarkdownReconstructor.ts`: Fixed `extractJsonPayload` type check (N1) + added `researcher`/`productManager` fields (N3)
- 2 audit report files added

### Unstaged Changes (from handover session)
- `SettingsModelAdapter.ts`: **Haiku-only cascade** — removed Nemotron entirely, both `analysis` and `chat` paths now use `['anthropic/claude-haiku-4.5']` only
- `export/route.ts`: Added dimension guard — rejects export when `analysis_payload.dimensions` is empty
- `next.config.ts`: Added `serverExternalPackages: ['pdfkit']` + `outputFileTracingIncludes` for Vercel bundling fix

---

## P1 — BEFORE/AFTER CHECKLIST (from Re-Audit II findings)

### CRITICAL (4 items from Re-Audit II)

| ID | Finding | Re-Audit II Status | Re-Audit III Status | Verdict |
|---|---|---|---|---|
| **C1** | `analyses.analysis_markdown NOT NULL` vs stub upsert | ✅ RESOLVED | ✅ STILL RESOLVED — stub sets `analysis_markdown: ''` | ✅ DONE |
| **C2** | `IPersistencePort.persistAnalysis()` unimplemented | ✅ RESOLVED | ✅ STILL RESOLVED — implementation present | ✅ DONE |
| **C3** | BracketBuffer shape mismatch | ✅ RESOLVED | ✅ STILL RESOLVED — dual-track parsing active | ✅ DONE |
| **C4** | Worker timeout 90s vs ADR-005 58s | 🔴 OPEN | 🔴 **STILL OPEN** — `LLMCascade.ts` unchanged | 🔴 OPEN |

### NEW FINDINGS from Re-Audit II → Re-Audit III

| ID | Finding | Re-Audit II Status | Re-Audit III Status | Verdict |
|---|---|---|---|---|
| **N1** | `extractJsonPayload` persona.primary type-check | 🔴 CRITICAL | ✅ **RESOLVED** in `a4a7a6c` — now checks `typeof !== 'object' \|\| !('id' in ...)` | ✅ DONE |
| **N2** | Invalid OpenRouter model ID | 🔴 HIGH | ✅ **RESOLVED** in `a4a7a6c` (full ID) → then **SUPERSEDED** in unstaged (Nemotron removed entirely, Haiku-only) | ✅ DONE |
| **N3** | `MarkdownReconstructor.ts` missing fields | 🔴 HIGH | ✅ **RESOLVED** in `a4a7a6c` — `researcher` + `productManager` added | ✅ DONE |
| **N4** | `GET /api/analyses` RLS dependency | ⚠️ MEDIUM | ⚠️ **UNCHANGED** — still uses `getSupabaseClientWithAuth()` | ⚠️ OPEN |

### HIGH (7 items from Re-Audit II)

| ID | Finding | Re-Audit II | Re-Audit III | Verdict |
|---|---|---|---|---|
| **H1** | Composite index `analyses(user_id, created_at DESC)` | ✅ RESOLVED | ✅ STILL RESOLVED | ✅ DONE |
| **H2** | `users.id` FK to `auth.users` | ✅ RESOLVED | ✅ STILL RESOLVED | ✅ DONE |
| **H3** | `persistAnalysis()` implementation | ✅ RESOLVED | ✅ STILL RESOLVED | ✅ DONE |
| **H4** | `NextRequest` leaked into `IQuotaPort` | ✅ RESOLVED | ✅ STILL RESOLVED | ✅ DONE |
| **H5** | `usage_logs` unbounded growth | 🔴 OPEN | 🔴 **STILL OPEN** | 🔴 OPEN |
| **H6** | Version drift | 🔴 OPEN | 🔴 **STILL OPEN** — no version bump | 🔴 OPEN |
| **H7** | `embedding` column undocumented | 🔴 OPEN | 🔴 **STILL OPEN** | 🔴 OPEN |

### MEDIUM (6 items from Re-Audit II)

| ID | Finding | Re-Audit II | Re-Audit III | Verdict |
|---|---|---|---|---|
| **M1** | `env.ts` monolithic | 🔴 OPEN | 🔴 **STILL OPEN** | 🔴 OPEN |
| **M2** | No UseCase layer | 🔴 OPEN | 🔴 **STILL OPEN** | 🔴 OPEN |
| **M3** | Dead fixed-window rate limiter | 🔴 OPEN | 🔴 **STILL OPEN** | 🔴 OPEN |
| **M4** | Empty stub files | 🔴 OPEN | 🔴 **STILL OPEN** | 🔴 OPEN |
| **M5** | No request body size limit | 🔴 OPEN | 🔴 **STILL OPEN** | 🔴 OPEN |
| **M6** | `/chat-stream` not audited | 🔴 OPEN | 🔴 **STILL OPEN** | 🔴 OPEN |

### LOW (4 items from Re-Audit II)

| ID | Finding | Re-Audit II | Re-Audit III | Verdict |
|---|---|---|---|---|
| **L1** | `embedding` column unused | 🔴 OPEN | 🔴 **STILL OPEN** | 🔴 OPEN |
| **L2** | Snyk scan stale | 🔴 OPEN | 🔴 **STILL OPEN** | 🔴 OPEN |
| **L3** | Memory graph empty | ✅ RESOLVED | ✅ STILL RESOLVED | ✅ DONE |
| **L4** | Prompt file consolidation | 🔴 OPEN | 🔴 **STILL OPEN** | 🔴 OPEN |

---

## OVERALL REMEDIATION SCORE (Cumulative)

| Severity | Total | Resolved | Remaining | % Done | Δ from Re-Audit II |
|---|---|---|---|---|---|
| CRITICAL | 4 | 3 | 1 | 75% | — |
| HIGH (original) | 7 | 4 | 3 | 57% | — |
| NEW (N1-N4) | 4 | 3 | 1 | 75% | +3 resolved |
| MEDIUM | 6 | 0 | 6 | 0% | — |
| LOW | 4 | 1 | 3 | 25% | — |
| **TOTAL** | **25** | **11** | **14** | **44%** | **+3 (38% → 44%)** |

---

## P2 — CODE REVIEWER: DEEP ANALYSIS OF NEW CHANGES

### 2.1 SettingsModelAdapter — Haiku-Only Cascade

**File**: `web/lib/adapters/SettingsModelAdapter.ts` (unstaged)

**Change**: Removed the Nemotron model entirely. Both `analysis` and `chat` paths now resolve to `['anthropic/claude-haiku-4.5']` only.

**Assessment**:
- ✅ **Correct decision**: Nemotron was producing hallucinated `[Insufficient data]` markers on long transcripts and returning 404s with abbreviated IDs. Removing it eliminates both failure modes.
- ⚠️ **Single point of failure**: The cascade now has ONE model. If Haiku 4.5 is rate-limited, down, or the OpenRouter account is overdrawn (402), ALL analyses fail. No fallback.
- ⚠️ **`_kind` parameter unused**: The method signature accepts `'analysis' | 'chat'` but ignores it. This is correct (unified cascade) but the ISP violation from `IIngestionPort` remains — `SettingsModelAdapter` still implements `fetch()`, `detectPersona()`, `signToken()`, `buildJobMetadata()` which all throw.
- 🔴 **`_tier` parameter unused**: Per-tier model cascade from `app_settings` DB table is completely bypassed. The DB-backed cascade feature from PR #54 is dead code.

**Risk**: HIGH — single-model cascade with no fallback. If OpenRouter Haiku goes down, the entire platform is non-functional.

**Recommendation**: Add at minimum a second fallback model (e.g., `google/gemma-4-26b-a4b-it:free` or `anthropic/claude-sonnet-4.5` as paid fallback).

### 2.2 Export Dimension Guard

**File**: `web/app/api/analyses/[id]/export/route.ts` (unstaged, lines 89-97)

**Change**: Added guard that checks `analysis_payload.dimensions` exists and is non-empty before proceeding to PDF generation.

**Assessment**:
- ✅ **Correct guard**: Prevents blank PDF generation from collapsed/failed analyses.
- ⚠️ **Type assertion**: `(analysis.analysis_payload as Record<string, unknown>)?.dimensions` — uses `as` cast instead of runtime validation. If `analysis_payload` is a non-object truthy value (e.g., a string), this would throw.
- ⚠️ **Markdown fallback ignored**: The guard checks `analysis_payload.dimensions` but the PDF generators (`exportSummaryPDF`, `exportFullPDF`) use `analysis.analysis_markdown`. A valid markdown-only analysis (legacy, pre-ADR-006) with empty `analysis_payload` would be REJECTED by this guard even though it has valid content to export.
- 🔴 **Backward compatibility break**: Legacy analyses (before ADR-006) have `analysis_payload = {}` (empty object from stub) and valid `analysis_markdown`. This guard would reject them.

**Risk**: MEDIUM — legacy analyses become un-exportable.

**Recommendation**: Fall through to `analysis_markdown` check if `analysis_payload.dimensions` is empty:
```typescript
const hasPayloadDimensions = hasDimensions;
const hasMarkdown = analysis.analysis_markdown && analysis.analysis_markdown.trim().length > 0;
if (!hasPayloadDimensions && !hasMarkdown) {
  return NextResponse.json({ error: 'No analysis data available...' }, { status: 400 });
}
```

### 2.3 Vercel PDF Bundling Fix

**File**: `web/next.config.ts` (unstaged)

**Changes**:
1. `serverExternalPackages: ['pdfkit']` — prevents Next.js from bundling pdfkit (which has native `.afm` font files)
2. `outputFileTracingIncludes: { '/api/**/*': ['./node_modules/pdfkit/js/data/**'] }` — ensures font data files are included in the serverless deployment

**Assessment**:
- ✅ **Correct approach**: `serverExternalPackages` is the right mechanism for Node.js packages with native assets.
- ✅ **`outputFileTracingIncludes` at root level**: Correct for Next.js 16 (moved out of `experimental`).
- ⚠️ **Glob pattern**: `'/api/**/*'` matches ALL API routes, not just the export route. This means every API route's serverless function will include pdfkit font data, increasing bundle size for routes that don't need it.
- ℹ️ **Alternative**: Could scope to `'/api/analyses/[id]/export'` only, but the `/**/*` pattern is safer if more export routes are added later.

**Risk**: LOW — slight bundle size increase for non-export routes.

### 2.4 N1 Fix Verification

**File**: `worker/src/services/MarkdownReconstructor.ts:118`

**Change**: `typeof parsed.persona.primary !== 'string'` → `typeof parsed.persona.primary !== 'object' || !('id' in parsed.persona.primary)`

**Assessment**:
- ✅ **Correct fix**: Now properly validates that `persona.primary` is an object with an `id` property.
- ⚠️ **Edge case**: If `persona.primary` is `null` (typeof returns `'object'`), `'id' in null` throws `TypeError`. The `!parsed.persona?.primary` guard catches `null` before this line, so it's safe.
- ✅ **Dual-write now functional**: v2.0 payloads will be correctly extracted and persisted to `analysis_payload` JSONB.

**Risk**: NONE — fix is correct.

### 2.5 N3 Fix Verification

**File**: `worker/src/services/MarkdownReconstructor.ts:52-53`

**Change**: Added `researcher: string` and `productManager: string` to `monetizationVerdict` interface.

**Assessment**:
- ✅ **Interface now matches Zod schema**: `MonetizationVerdictSchema` requires both fields.
- ⚠️ **`reconstructMarkdown` doesn't emit them**: Lines 99-104 only output `creator`, `indieMaker`, `consultant` — the new `researcher` and `productManager` fields are in the interface but NOT rendered in the markdown reconstruction. This means the dual-write markdown will be missing these verdicts.
- ℹ️ **Low impact**: The markdown is the backward-compat column; the JSONB payload has the full data. PDF export uses markdown, so these verdicts won't appear in PDFs.

**Risk**: LOW — cosmetic omission in markdown reconstruction.

---

## P3 — VERCEL COMPOSITION PATTERNS ANALYSIS

### 3.1 Boolean Prop Proliferation

**Rule**: `architecture-avoid-boolean-props`

| Component | Boolean Props | Assessment |
|---|---|---|
| `DimensionCard` | `interactive` (derived), `streaming` (derived) | ✅ GOOD — derived from `status` enum, not passed as props |
| `StreamingGrid` | None | ✅ CLEAN |
| `ChatDock` | `open` (state), `showThreads` (state) | ✅ ACCEPTABLE — internal state, not API props |
| `KnowledgeGraphCanvas` | `compact` (boolean prop) | ⚠️ **MINOR** — `compact` controls 6+ visual properties. Consider a `variant` prop or compound component. |
| `DashboardLayout` | None (uses slot composition) | ✅ EXCELLENT — pure composition via `sidebar`, `topbar`, `children`, `rightPanel`, `dock` slots |

### 3.2 Compound Components

**Rule**: `architecture-compound-components`

| Component | Pattern | Assessment |
|---|---|---|
| `DashboardLayout` | Slot composition (`sidebar`, `topbar`, `children`, `rightPanel`, `dock`) | ✅ **TEXTBOOK** — clean slot-based layout with no boolean mode switches |
| `ChatDock` | Monolithic (collapsed/expanded in one component) | ⚠️ **CANDIDATE** — 313 LOC with two distinct visual modes. Could split into `ChatDock.Collapsed` + `ChatDock.Expanded` with shared context. |
| `DimensionCard` | Status-driven rendering | ✅ GOOD — single component with status-based conditional rendering |
| `KnowledgeGraphCanvas` | Single component with `compact` variant | ⚠️ **CANDIDATE** — `compact` toggles 6+ style values. Consider `KnowledgeGraphCanvas` + `KnowledgeGraphCanvas.Compact` explicit variant. |

### 3.3 State Management

**Rule**: `state-context-interface` + `state-lift-state`

| Store | Pattern | Assessment |
|---|---|---|
| `useAnalysisStore` (Zustand) | Global singleton store | ✅ GOOD — flat state, no nested subscriptions |
| `useChatStore` (Zustand) | Global singleton store with outbox pattern | ✅ **EXCELLENT** — optimistic UI with idempotent replay. Well-designed offline-first architecture. |
| `useSynthesisNucleus` (Zustand) | Global singleton with persona projection | ✅ GOOD — immutable analysis + mutable persona selector + computed projection |
| `ChatDock` local state | `useState` for `open`, `showThreads`, `input` | ✅ CORRECT — ephemeral UI state stays local |

### 3.4 Children Over Render Props

**Rule**: `patterns-children-over-render-props`

- ✅ **No render props found** in any component. All composition uses `children` or named slots.

### 3.5 React 19 Compliance

**Rule**: `react19-no-forwardref`

- ✅ **No `forwardRef` usage** found in any component. All refs use `useRef` directly.
- ℹ️ React 19.2.6 is the active version — compatible with all patterns used.

---

## P4 — VERCEL REACT BEST PRACTICES ANALYSIS

### 4.1 Eliminating Waterfalls (CRITICAL)

| Rule | Location | Assessment |
|---|---|---|
| `async-parallel` | `WorkerIngestionAdapter.fetch()` | ✅ **EXCELLENT** — `Promise.allSettled([fetchWorkerMetadata, fetchSubtitles])` runs metadata + transcript in parallel |
| `async-parallel` | `route.ts` POST | ⚠️ **SEQUENTIAL** — auth → cache → traffic → billing → ingestion → stub → token. Auth + cache could run in parallel. Traffic + billing could run in parallel after auth. |
| `async-parallel` | `route.ts` GET | ⚠️ **DYNAMIC IMPORT** — `await import('@/lib/supabase')` inside handler. Should be static import (module-level). |
| `async-suspense-boundaries` | Dashboard pages | ℹ️ Not inspected (page components not in scope). |

### 4.2 Bundle Size (CRITICAL)

| Rule | Location | Assessment |
|---|---|---|
| `bundle-barrel-imports` | `@/lib/adapters` | ⚠️ **BARREL IMPORT** — `route.ts` imports all 7 adapters from `@/lib/adapters` barrel. Tree-shaking may not eliminate unused adapters. |
| `bundle-barrel-imports` | `@/lib/ports` | ✅ OK — type-only imports, eliminated at compile time |
| `bundle-dynamic-imports` | `KnowledgeGraphCanvas` | ✅ **EXCELLENT** — `dynamic(() => import('react-force-graph-2d'), { ssr: false })` correctly lazy-loads the heavy canvas library |
| `bundle-defer-third-party` | Sentry | ⚠️ Sentry is imported synchronously in every route handler. `@sentry/nextjs` auto-instruments, so this is managed by the SDK. |
| **Build warnings** | Chunks | 🔴 Two chunks exceed 250 KB: `07gty.ocg~j6i.js` (516 KB) and `0by4~gt00h3d..js` (628 KB). Need `next/dynamic` or code splitting. |

### 4.3 Server-Side Performance (HIGH)

| Rule | Location | Assessment |
|---|---|---|
| `server-no-shared-module-state` | `route.ts` module-level adapters | ⚠️ **FLAGGED** — 7 adapter singletons at module level. Currently stateless (safe), but violates the rule. If any adapter gains mutable state, concurrent requests would race. |
| `server-auth-actions` | All route handlers | ✅ GOOD — every handler calls `authAdapter.authenticate()` or `getSupabaseClientWithAuth()` before data access |
| `server-cache-react` | Not used | ℹ️ No `React.cache()` usage found. Could deduplicate `getUserTier()` calls within a single request. |
| `server-hoist-static-io` | `next.config.ts` | ✅ GOOD — `outputFileTracingIncludes` hoists pdfkit font data |

### 4.4 Re-render Optimization (MEDIUM)

| Rule | Location | Assessment |
|---|---|---|
| `rerender-no-inline-components` | `ChatDock` | ✅ GOOD — no components defined inside other components |
| `rerender-functional-setstate` | `useChatStore` | ✅ **EXCELLENT** — uses functional `set((s) => ...)` pattern throughout |
| `rerender-memo` | `StreamingGrid` | ⚠️ `DimensionCard` is not memoized. Each `StreamingGrid` re-render re-creates all cards. With 11 dimensions streaming, this could cause unnecessary renders. |
| `rerender-dependencies` | `ChatDock` useEffect | ✅ GOOD — dependencies are primitive values (`open`, `activeId`, `analysisId`) |
| `rerender-derived-state` | `ChatDock` | ✅ GOOD — `messages` and `activeConv` are `useMemo` derived from store state |
| `rerender-split-combined-hooks` | `ChatDock` | ⚠️ The `useEffect` at line 60-67 combines auto-scroll logic with `messages`, `sending`, AND `open` dependencies. The `open` dependency triggers scroll on chat open even if messages haven't changed. |

### 4.5 Rendering Performance (MEDIUM)

| Rule | Location | Assessment |
|---|---|---|
| `rendering-hoist-jsx` | `ChatDock` | ✅ GOOD — `iconBtn` and `turnIconBtn` CSS objects are hoisted to module level |
| `rendering-conditional-render` | `StreamingGrid` | ✅ GOOD — uses ternary for status-based rendering (not `&&`) |
| `rendering-content-visibility` | `ChatDock` messages | ⚠️ Long message lists could benefit from `content-visibility: auto` on the message container |
| `rendering-animate-svg-wrapper` | N/A | ✅ No SVG animation issues found |

### 4.6 JavaScript Performance (LOW-MEDIUM)

| Rule | Location | Assessment |
|---|---|---|
| `js-hoist-regexp` | `hallucination-filter.ts` | ✅ GOOD — regex `/\n{3,}/g` is inline but only called once per export |
| `js-set-map-lookups` | `BracketBuffer` | ✅ **EXCELLENT** — uses `Set<number>` for `emittedDimensions` deduplication |
| `js-early-exit` | All route handlers | ✅ GOOD — early returns on auth failure, validation failure, etc. |
| `js-combine-iterations` | `hallucination-filter.ts` | ⚠️ Two-pass: `.map()` then `.filter()`. Could combine into single pass (flagged in Code Simplifier report). |

---

## P5 — NEW FINDINGS (Discovered in Re-Audit III)

### 🔴 NEW CRITICAL

None.

### 🟡 NEW HIGH

| ID | Finding | Severity | Details |
|---|---|---|---|
| **N15** | Single-model cascade (no fallback) | **HIGH** | `SettingsModelAdapter` returns only `['anthropic/claude-haiku-4.5']`. If OpenRouter Haiku is unavailable (429/402/503), ALL analyses fail with no fallback. The entire platform has a single point of failure for its core feature. |
| **N16** | Export guard breaks backward compatibility | **HIGH** | `export/route.ts` dimension guard rejects analyses with empty `analysis_payload.dimensions`, which includes ALL legacy (pre-ADR-006) analyses that have valid `analysis_markdown` but `{}` payload. Legacy users cannot export their existing analyses. |

### 🟢 NEW MEDIUM

| ID | Finding | Severity | Details |
|---|---|---|---|
| **N17** | `reconstructMarkdown` omits new monetization fields | **MEDIUM** | `researcher` and `productManager` verdicts are in the interface but not rendered in markdown output. PDF exports will be missing these fields. |
| **N18** | `route.ts` GET uses dynamic import | **MEDIUM** | `await import('@/lib/supabase')` inside the GET handler adds unnecessary latency. Should be a static import. |
| **N19** | `outputFileTracingIncludes` glob too broad | **LOW** | `'/api/**/*'` includes pdfkit fonts in ALL API route bundles, not just the export route. Minor bundle bloat. |

### ℹ️ NEW INFO

| ID | Finding | Details |
|---|---|---|
| **N20** | `ChatDock` scroll race fix is well-implemented | `cancelled` flag + `requestAnimationFrame` + cleanup function. Correct React lifecycle management. |
| **N21** | `DashboardLayout` `isolate` class is correct | Creates a new stacking context for the main column, preventing z-index conflicts with the dock. |
| **N22** | `KnowledgeGraphCanvas` uses `ResizeObserver` correctly | Properly disconnects on unmount. Responsive canvas sizing. |
| **N23** | `useChatStore` outbox pattern is production-grade | Idempotent replay, client-side dedup, SSE streaming. Well-designed offline-first chat. |

---

## P6 — TANGENTS & BLIND SPOTS

### Tangent 1: The Haiku-Only Gambit
The decision to go Haiku-only is pragmatic (Nemotron was unreliable) but creates a **business continuity risk**. OpenRouter's Haiku 4.5 pricing is ~$0.25/1M input tokens. A 2-hour transcript (~100K tokens) costs ~$0.025 per analysis. At 3 analyses/month (free tier), the cost is $0.075/user/month. At scale (1000 free users), that's $75/month in LLM costs with zero revenue. **Recommendation**: Implement a cost circuit breaker — if monthly LLM spend exceeds a threshold, switch to a cheaper model or enforce stricter rate limits.

### Tangent 2: The Legacy Export Gap
The export guard creates a **data accessibility gap**: users who ran analyses before ADR-006 (markdown-only) cannot export their results. This is a user-facing regression. The fix is simple (fall through to markdown check) but must be done before the next production deploy.

### Tangent 3: The `app_settings` Ghost Table
The `app_settings` table (migration `20260605120000`) was created for DB-backed per-tier model cascade. With the Haiku-only change, this table is completely unused. It's a **dead schema artifact** — the feature it was designed for has been bypassed by operational necessity. Document this decision or remove the table.

### Blind Spot 1: Worker `chat-stream.ts`
Still not audited. The chat path uses HMAC tokens (`signChatToken`/`verifyChatToken`) but the worker-side verification logic has not been inspected. With the model cascade changes, the chat path may reference stale model IDs.

### Blind Spot 2: `parseUcisDimensions` (Legacy Regex Parser)
The cache-hit path in `SupabasePersistenceAdapter.findCachedAnalysis()` falls through to `parseUcisDimensions()` for markdown-only analyses. This regex parser has not been inspected in this audit cycle. If it's the old deprecated parser, it may have known issues.

### Blind Spot 3: Sentry Source Maps
`next.config.ts` has `sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN }`. If `SENTRY_AUTH_TOKEN` is not set in the Vercel environment, source maps are disabled — making production error debugging significantly harder. Verify this env var is set.

---

## P7 — REMAINING ITEMS (Priority Order, Updated)

### Must Fix Before Next Deploy
1. **N16**: Fix export guard backward compatibility — add markdown fallback check
2. **N15**: Add at least one fallback model to the cascade
3. **N17**: Add `researcher`/`productManager` rendering to `reconstructMarkdown`
4. **C4**: Reconcile worker timeout (90s) with ADR-005 documentation (58s)

### Should Fix This Sprint
5. **N18**: Change `route.ts` GET to static import
6. **N4**: Verify RLS policies for auth-scoped queries
7. **H5**: Add `usage_logs` retention policy
8. **H6**: Unify monorepo versions
9. **M6**: Audit `/chat-stream` endpoint

### Can Wait
10. **H7/L1**: Decide fate of `embedding` column
11. **N19**: Scope `outputFileTracingIncludes` to export route only
12. **M1-M5**: Structural refactors
13. **L2/L4**: Snyk refresh + prompt consolidation

---

## P8 — COVERAGE GUARANTEE

✅ **100% coverage maintained** — all committed + unstaged changes inspected, all 4 skill lenses applied.

**New files inspected this cycle**:
- `web/next.config.ts` (115 LOC) — Vercel config + Sentry + PDF bundling
- `web/app/api/analyses/[id]/export/route.ts` (238 LOC) — PDF export with guards
- `web/lib/adapters/SettingsModelAdapter.ts` (24 LOC) — Haiku-only cascade
- `worker/src/services/MarkdownReconstructor.ts` (127 LOC) — N1/N3 fixes verified
- `web/components/templates/console/StreamingGrid.tsx` (140 LOC) — dimension cards
- `web/components/templates/console/ChatDock.tsx` (313 LOC) — chat dock
- `web/components/templates/console/KnowledgeGraphCanvas.tsx` (250 LOC) — force graph
- `web/components/templates/console/DashboardLayout.tsx` (45 LOC) — layout shell
- `web/store/useAnalysisStore.ts` (110 LOC) — analysis state
- `web/store/useChatStore.ts` (311 LOC) — chat state with outbox
- `web/lib/adapters/WorkerIngestionAdapter.ts` (71 LOC) — ingestion adapter

**Skills applied**: code-reviewer · code-simplifier · vercel-composition-patterns · vercel-react-best-practices

---

**RE-AUDIT III COMPLETE** | 11/25 items resolved (44%) | 2 new HIGH | 3 new MEDIUM | Report ONLY — NO FIXES
