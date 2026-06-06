# DEEP STRUCTURAL AUDIT — hex-yt-intel
## Codebase Investigator + DB 10x Optimizer | Full Coverage Report

**Date**: 2026-06-06
**Branch**: `main` (commit `531dd5d`)
**Auditor**: Kilo Code (Codebase Investigator + DB 10x Optimizer)
**Coverage**: 100% — all source files, all migrations, all API routes, all worker modules
**Scope**: READ-ONLY — no fixes applied

---

## 0. PREFLIGHT — SITUATIONAL AWARENESS

### Current State Snapshot

| Dimension | Value |
|-----------|-------|
| **Root version** | `1.4.1` (package.json) |
| **Web version** | `1.4.6` (web/package.json) |
| **Worker version** | `1.5.1` (worker/package.json) |
| **pnpm** | `11.5.1` (packageManager field) |
| **Node** | `>=24.0.0` (engines) |
| **Next.js** | `16.2.6` |
| **TypeScript** | `5.6.2` |
| **React** | `19.2.6` |
| **Zustand** | `5.0.13` |
| **Zod** | `4.4.3` |
| **Supabase project** | `adnmbikaqnxivalqoild` (eu-west-3) |
| **Worker deploy** | `yt-intel.hex-tech-lab.workers.dev` |
| **Vercel deploy** | `hex-yt-intel.vercel.app` |
| **Working tree** | DIRTY — 6 modified + 9 untracked files |
| **Open PRs** | 2 (#54, #53) |
| **Total commits (main)** | 30+ since Phase 1 |
| **Last commit** | 2026-06-05 20:55 UTC |

### Version Drift — ADR: HOUSEKEEPING VIOLATION

| Package | Declared | AGENTS.md says | GEMINI.md says | Drift |
|---------|----------|----------------|----------------|-------|
| root | `1.4.1` | `1.4.1` ✅ | — | — |
| web | `1.4.6` | `1.4.1` ❌ | — | **+5 patches** |
| worker | `1.5.1` | `1.4.1` ❌ | — | **+1 minor, +10 patches** |
| pnpm | `11.5.1` | — | `11.1.3` ❌ | **+0.4.2** |

**Finding**: AGENTS.md §3 Housekeeping Protocol mandates "Verify version parity across root/web/worker." This has NOT been executed since the MVP 2.0 sprint began. The worker is a full minor version ahead of root. GEMINI.md still references pnpm 11.1.3 which was superseded by PR #50.

### Working Tree Status (DIRTY)

**Modified (unstaged)**:
- `pnpm-lock.yaml`
- `web/app/api/admin/stats/route.ts`
- `web/app/api/chat/conversations/[id]/messages/route.ts`
- `web/lib/stream-token.ts`
- `web/package.json`

**Untracked**:
- `.blackboxcli/` (agent config)
- `BLACKBOX.md`, `CHAT_AUTH_GUARD_COMPLETE.md`, `SETUP_REQUIRED.md`, `STATS_HARDENING_COMPLETE.md`, `TASKS_COMPLETED_SUMMARY.md`, `TODO.md`
- `install_bbt.sh`
- `web/lib/services/settings.ts` (new service, part of PR #54)

**Finding**: 6 root-level markdown files violate GEMINI.md §2 "MAXIMUM 4 Markdown elements in root directory." The untracked files appear to be artifacts from a BlackBox agent session that were never committed or cleaned.

---

## 1. ROADMAP VARIANCE ANALYSIS

### Roadmap Documents Compared

| Document | Date | Status Claim | Reality |
|----------|------|-------------|---------|
| `ROADMAP.md` | 2026-05-21 | "Phase 2 READY TO START" | **STALE** — Phase 2 massively executed but doc never updated |
| `ROADMAP_MVP_2_0_TO_3_5.md` | 2026-06-03 | "MVP 2.0 target: 2026-06-07" | **1 day before target** — most features shipped |
| `PRD.md` | 2026-05-24 | "PRD v2.0 FINAL, LOCKED" | **Partially stale** — pricing model changed, AI chat shipped early |

### MVP 2.0 Feature Checklist (vs ROADMAP_MVP_2_0_TO_3_5.md)

| Feature | Specified | Shipped | Variance |
|---------|-----------|---------|----------|
| 11-dimension UCIS synthesis | ✅ | ✅ | ON TARGET |
| Persona detection (5 personas) | ✅ | ✅ | ON TARGET |
| Timezone-aware synthesis | ✅ | ✅ | ON TARGET |
| **Structured JSON Streaming** | ✅ | ❌ | **BEHIND** — still regex parser |
| PDF export | ✅ | ✅ | ON TARGET |
| Copy-to-clipboard | ✅ | ✅ | ON TARGET |
| Streaming edge architecture | ✅ | ✅ | ON TARGET |
| Landing page | ✅ | ✅ | ON TARGET |
| Dashboard (URL input, quota) | ✅ | ✅ | ON TARGET |
| Analysis detail view | ✅ | ✅ | ON TARGET |
| Settings page | ✅ | ⚠️ | PARTIAL — basic settings exist |
| OAuth via Supabase | ✅ | ✅ | ON TARGET |
| Freemium pricing (Free/Pro/Enterprise) | ✅ | ✅ | ON TARGET |
| **Chat with analysis** | MVP 3.0 | ✅ | **AHEAD** — shipped in MVP 2.0 |
| **Knowledge graph intelligence** | MVP 2.5 | ✅ | **AHEAD** — shipped in MVP 2.0 |
| **Analysis history** | MVP 2.5 | ✅ | **AHEAD** — shipped in MVP 2.0 |
| **Intelligence rail + dimension cards** | Not specified | ✅ | **SCOPE ADDITION** |
| **Dimension drawer** | Not specified | ✅ | **SCOPE ADDITION** |
| **Relations engine (SSE)** | Not specified | ✅ | **SCOPE ADDITION** |

### Variance Summary

| Metric | Assessment |
|--------|------------|
| **Schedule** | ON TARGET (1 day before MVP 2.0 launch date) |
| **Feature completeness** | **+15% AHEAD** — chat, knowledge graph, history all shipped early |
| **Scope discipline** | **NEGATIVE** — 4 scope additions without PRD update |
| **Documentation** | **BEHIND** — ROADMAP.md stale by 2 weeks, PRD partially stale |
| **Structured JSON Streaming** | **BEHIND** — the single biggest MVP 2.0 spec item NOT implemented |

### Key ADR: Structured JSON Streaming Gap

The ROADMAP explicitly calls out "Structured JSON Streaming (kills Regex parser)" as a core MVP 2.0 feature. The current implementation still uses regex-based dimension parsing (`parse-ucis-dimensions.ts`, `dimension-parser.ts`). This is the **single largest roadmap gap** — the regex parser is the root cause of the "Parsing..." spinner and fragile dimension extraction.

---

## 2. OPEN PRs REVIEW

### PR #54: `feat(models): DB-backed per-tier model cascade (chat + analysis) + Haiku toggle`

| Field | Value |
|-------|-------|
| **Status** | CHANGES_REQUESTED |
| **Branch** | `feat/model-config-cascade` → `main` |
| **Size** | +257 / -30 |
| **Created** | 2026-06-05 |

**What it does**:
- Creates `app_settings` table (generic key/value JSONB store)
- Seeds `model_config` row with per-tier LLM cascades (free/pro/enterprise)
- Adds `web/lib/services/settings.ts` (resolveModelCascade + TTL cache)
- Wires model cascade into `signStreamToken` and `signChatToken`
- Adds `testOverride` toggle for Haiku 4.5 testing

**Review findings**:
- ✅ Good SoC: generic key/value table, not model-specific
- ✅ RLS enabled with NO permissive policy = service_role only (correct)
- ✅ Fallback pattern: DB outage degrades to hardcoded defaults (resilient)
- ⚠️ `testOverride.enabled = true` in seed — this ships with Haiku override ON
- ⚠️ DashboardContainer change removes `store.status !== 'idle'` guard (Sourcery flagged)
- ⚠️ `@types/react` override pins to `19.0.0` but PR #52 already set `^19.2.0` — conflict
- ❌ Migration `20260605120000` not in main yet — if merged, needs rebase

**Recommendation**: Resolve the `@types/react` version conflict with main (PR #52 set `^19.2.0`, this PR sets `19.0.0`). Decide on `testOverride.enabled` default before merge.

### PR #53: `fix(robustness): Sourcery defensive patches`

| Field | Value |
|-------|-------|
| **Status** | No review decision (CI passing) |
| **Branch** | `fix/sourcery-robustness` → `main` |
| **Size** | +54 / -26 |
| **Created** | 2026-06-05 |

**What it does**:
- Widens parser input types to `string | null | undefined`
- Relaxes dimension header regex to tolerate `**bold**` wrapping
- Adds `Number.isFinite` guards to admin stats calculations
- Pins `@types/react` to `19.0.0` via workspace overrides

**Review findings**:
- ✅ Low-risk defensive hardening
- ✅ CI green (type-check + lint + build)
- ⚠️ Sourcery flagged: regex `$` anchor may miss headers with trailing inline content
- ⚠️ Sourcery flagged: DashboardContainer always shows "Preparing..." even when idle
- ⚠️ Same `@types/react` conflict as PR #54

**Recommendation**: Address Sourcery's regex concern (drop `$` anchor or allow trailing content). Restore `store.status !== 'idle'` guard in DashboardContainer.

### PR Conflict Matrix

| File | PR #53 | PR #54 | Conflict? |
|------|--------|--------|-----------|
| `pnpm-workspace.yaml` | Adds overrides | Adds overrides | **YES** — both add `@types/react` overrides with different values |
| `DashboardContainer.tsx` | Removes idle guard | Removes idle guard | **YES** — identical change, will merge conflict |
| `pnpm-lock.yaml` | Modified | Modified | **YES** — lockfile divergence |

**Recommendation**: Merge #53 first (smaller, lower risk), then rebase #54 on top.

---

## 3. LOC BREAKDOWN BY COMPONENT

### Aggregate Totals

| Component | LOC | Files | Avg LOC/File | Classification |
|-----------|-----|-------|-------------|----------------|
| `web/lib` | 7,318 | 55 | 133 | **HEAVY** — business logic + infrastructure |
| `web/app` | 5,156 | 39 | 132 | **HEAVY** — API routes + pages |
| `web/components` | 3,613 | 27 | 134 | **MODERATE** — UI components |
| `worker/src` | 1,860 | 18 | 103 | **LEAN** — well-decomposed |
| `supabase/migrations` | 1,273 | 18 | 71 | **MODERATE** — 18 migrations |
| `web/hooks` | 679 | 6 | 113 | **LEAN** — clean hooks |
| `web/lib/types` | 525 | 5 | 105 | **LEAN** — type definitions |
| `web/lib/intelligence` | 494 | 3 | 165 | **MODERATE** — graph + similarity |
| `web/lib/prompts` | 983 | 3 | 328 | **BLOATED** — 913 LOC of prompt text |
| `web/lib/auth` | 159 | 7 | 23 | **OVER-ENGINEERED** — 7 files, 159 LOC |
| **TOTAL** | **~19,900** | **~180** | **~110** | — |

### Top 10 Largest Files (Bloat Candidates)

| LOC | File | Concerns |
|-----|------|----------|
| 520 | `web/lib/prompts/ucis-v5.1.ts` | Pure prompt text — 127 LOC duplicated from v5.0 |
| 516 | `web/app/api/stripe/webhook/route.ts` | **DUPLICATE** — overlaps with billing/webhook |
| 393 | `web/lib/prompts/ucis-v5.ts` | Legacy prompt — should be deprecated |
| 378 | `web/lib/services/traffic.ts` | **SoC violation** — mixes Redis + Supabase + Sentry |
| 365 | `web/lib/ucis-v5-validator.ts` | Large but single-responsibility |
| 349 | `web/lib/env.ts` | Env validation — justified size |
| 336 | `web/components/containers/DashboardContainer.tsx` | **SoC violation** — 4 concerns mixed |
| 327 | `web/app/admin/dashboards/page.tsx` | Admin UI — acceptable |
| 304 | `web/app/search/page.tsx` | Search page — acceptable |
| 299 | `web/lib/stores/synthesis-nucleus-store.ts` | Store — borderline, could decompose |

### Bloat Classification

| Category | LOC | % of Total | Action |
|----------|-----|-----------|--------|
| **Duplicate prompts** | 127 | 0.6% | Merge v5.0 + v5.1 |
| **Duplicate Stripe handlers** | ~260 | 1.3% | Consolidate |
| **Dead code** (Vercel auth stub, UCIS v3.2) | ~100 | 0.5% | Delete |
| **Over-engineered auth** (4 files → 1) | ~80 | 0.4% | Simplify |
| **Total recoverable** | ~567 | 2.8% | — |

---

## 4. FINDINGS — DESCENDING BLAST RADIUS

### TIER 0: CRITICAL (System-wide / Data Loss / Security Breach)

#### C-1: `usage.ts` Uses Anon Key for RLS-Protected Table Insert
- **File**: `web/lib/usage.ts`
- **Blast radius**: ALL usage logging silently fails for authenticated users
- **Mechanism**: `getSupabaseClient()` returns anon-key client → `auth.uid() = NULL` → RLS rejects INSERT
- **Impact**: Zero usage data collected. Quota tracking, rate-limit metrics, admin stats all blind.
- **Evidence**: `traffic.ts:153` correctly uses `getSupabaseServiceClient()` but `usage.ts` does not.
- **Severity**: CRITICAL — observability blackout

#### C-2: `/api/sentry-test` — Unauthenticated Error-Throwing Endpoint
- **File**: `web/app/api/sentry-test/route.ts`
- **Blast radius**: Any anonymous user can trigger server errors
- **Mechanism**: `GET /api/sentry-test` throws `new Error("Sentry Test")` with zero auth
- **Impact**: Sentry quota exhaustion, error noise masking real issues, potential DDoS amplification
- **Severity**: CRITICAL — security + observability

#### C-3: Duplicate Stripe Webhook Handlers
- **Files**: `web/app/api/billing/webhook/route.ts` (130 LOC) + `web/app/api/stripe/webhook/route.ts` (516 LOC)
- **Blast radius**: Double-processing of payment events, inconsistent state
- **Mechanism**: Two separate endpoints handling overlapping Stripe events with different logic
- **Impact**: `billing/webhook` handles `checkout.session.completed` with simple metadata lookup; `stripe/webhook` handles subscription lifecycle with customer email lookup + ownership verification. If Stripe sends to both, user gets double-provisioned.
- **Severity**: CRITICAL — financial integrity

#### C-4: Test Token Bypass in Middleware
- **File**: `web/middleware.ts:67-71`
- **Blast radius**: Auth bypass in non-production deployments
- **Mechanism**: Any token starting with `test-token-` or `user-` bypasses auth when `NODE_ENV !== 'production'`
- **Impact**: Preview deployments (Vercel previews) are fully unauthenticated. Anyone with the URL has full access.
- **Severity**: CRITICAL — security (preview environments are internet-accessible)

### TIER 1: HIGH (Feature Breakage / Architectural Debt)

#### H-1: Version Drift — Housekeeping Protocol Violation
- **Files**: `package.json` (1.4.1), `web/package.json` (1.4.6), `worker/package.json` (1.5.1)
- **Blast radius**: Deployment confusion, stale documentation
- **Evidence**: AGENTS.md §3 mandates parity verification. Last housekeeping cycle: unknown.
- **Severity**: HIGH

#### H-2: 6 Missing Hexagonal Ports
- **Blast radius**: Untestable infrastructure coupling
- **Missing ports**:
  1. `IHttpClient` — LLMCascade, TranscriptExtractor, MetadataScraper all use raw `fetch()`
  2. `IMetadataProvider` — worker.ts directly instantiates MetadataScraper
  3. `IValidationService` — ValidationService has no port interface
  4. `IHmacSigner` — HMAC logic duplicated across 3 files (stream-token.ts, worker.ts, chat-stream.ts)
  5. `IChatCascade` — chat-stream.ts implements cascade directly in handler
  6. `IWorkerGateway` — worker-llm.ts makes direct HTTP to Cloudflare Worker
- **Severity**: HIGH — prevents unit testing, couples to infrastructure

#### H-3: Cross-Package Coupling (Worker → Web)
- **Files**: `worker/src/services/PromptBuilder.ts:9`, `worker/src/services/KnowledgeGraphSynthesizer.ts:1-10`
- **Blast radius**: Worker cannot be tested or deployed independently
- **Mechanism**: Worker imports `getUCISPrompt` from `web/lib/prompts/factory` and re-exports `KnowledgeGraphSynthesizer` from `web/lib/intelligence/knowledge-graph`
- **Impact**: Any web/lib refactor can break the worker. The esbuild bundle hides this coupling.
- **Severity**: HIGH — violates hexagonal dependency rule (dependencies point inward)

#### H-4: DashboardContainer SoC Violation (336 LOC, 4 Concerns)
- **File**: `web/components/containers/DashboardContainer.tsx`
- **Concerns mixed**:
  1. UI state management (nav, tab, node selection)
  2. Business logic (cleanDimensionContent, getUserTimezone, handleAnalyze)
  3. Export functionality (PDF/markdown download)
  4. Dimension configuration (DIMENSION_LABELS, ICONS, SPANS hardcoded inline)
- **Severity**: HIGH — god component, difficult to test or extend

#### H-5: Duplicate UCIS Prompts (913 LOC Combined)
- **Files**: `web/lib/prompts/ucis-v5.1.ts` (520 LOC) + `web/lib/prompts/ucis-v5.ts` (393 LOC)
- **Blast radius**: Prompt drift, maintenance burden
- **Mechanism**: v5.1 is v5.0 + Dimension 11 (Monetization). 127 LOC of identical structure.
- **Severity**: HIGH — single source of truth violation

#### H-6: Multiple Routes Missing Rate Limiting
- **Unprotected endpoints**:
  - `/api/analyses/[id]/export` — PDF export
  - `/api/analyses/[id]/relations` — SSE streaming
  - `/api/analyses/[id]/share` — share token generation
  - `/api/chat/conversations/*` — all conversation operations
  - `/api/chat/conversations/[id]/messages` — chat messages
  - `/api/admin/stats` — admin stats
  - `/api/pdf` — PDF generation
- **Severity**: HIGH — resource exhaustion vector

#### H-7: Raw Error Message Leakage
- **Affected routes**: analyses, analyses/persist, analyses/check, chat/conversations, chat/persist, metadata
- **Mechanism**: `catch (error) { return NextResponse.json({ error: error.message }) }`
- **Impact**: Internal error details (DB errors, API keys in stack traces) exposed to clients
- **Severity**: HIGH — information disclosure

### TIER 2: MEDIUM (Single Component / Code Quality)

#### M-1: `stripe_events` Has No INSERT Policy
- **Blast radius**: Relies on service_role bypass; fragile if role changes
- **Severity**: MEDIUM

#### M-2: Auth Module Over-Engineering (7 Files, 159 LOC)
- **Files**: `auth/index.ts` (3 LOC), `auth/provider-factory.ts` (38 LOC), `auth/providers/supabase.ts` (12 LOC), `auth/providers/vercel.ts` (42 LOC — DEAD STUB), `auth/config.ts` (27 LOC), `auth/env-validator.ts` (25 LOC), `auth/types.ts` (12 LOC)
- **Issue**: VercelAuthProvider is completely stubbed (all methods return null/throw). Provider factory only ever uses Supabase. 7 files where 2 could suffice.
- **Severity**: MEDIUM

#### M-3: Traffic Service Mixes Supabase User Tier Lookup
- **File**: `web/lib/services/traffic.ts:306-332`
- **Issue**: `getUserTier()` queries Supabase `users` table — this is billing/tier data, not traffic shaping
- **Severity**: MEDIUM — SoC violation

#### M-4: No Zod Validation on S2S Persist Endpoints
- **Files**: `web/app/api/analyses/persist/route.ts`, `web/app/api/chat/persist/route.ts`
- **Issue**: Manual field checking instead of Zod schemas
- **Severity**: MEDIUM

#### M-5: PDF Generation Without Ownership Check
- **File**: `web/app/api/pdf/route.ts`
- **Issue**: Authenticated user can generate PDF from any markdown, not just their own analysis
- **Severity**: MEDIUM — tenant isolation gap

#### M-6: Missing Security Headers
- **Missing on all endpoints**: `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security`
- **Severity**: MEDIUM

#### M-7: `increment_user_quota_atomic` Auth Check Allows NULL uid
- **File**: `supabase/migrations/20260521210000_hardening_wave_4_fixes.sql`
- **Issue**: `IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id` — if uid is NULL, no exception raised
- **Mitigation**: Function EXECUTE granted to service_role only, so effectively mitigated but fragile
- **Severity**: MEDIUM

#### M-8: Relations Engine Bypasses Hexagonal Pattern
- **File**: `web/lib/intelligence/relations-engine.ts:64`
- **Issue**: Direct `fetch('https://openrouter.ai/api/v1/chat/completions')` — should go through a service adapter
- **Severity**: MEDIUM

#### M-9: ITranscriptProvider Re-exports Type From Adapter
- **File**: `worker/src/ports/ITranscriptProvider.ts:12`
- **Issue**: Port imports `TranscriptResult` from `TranscriptExtractor` (adapter) — inverts dependency rule
- **Severity**: MEDIUM — port should define types, not import from implementations

### TIER 3: LOW (Cosmetic / Minor Cleanup)

#### L-1: Dead Code — Vercel Auth Provider Stub
- **File**: `web/lib/auth/providers/vercel.ts` (42 LOC, all methods throw/return null)
- **Severity**: LOW

#### L-2: Dead Code — UCIS v3.2 Export
- **File**: `web/lib/config/prompts.ts:37-60` — `UCIS_V3_2_SYSTEM` exported but never imported
- **Severity**: LOW

#### L-3: Hardcoded Values Duplicated Across Files
- User agent strings: `metadata.ts:15-20` duplicated in `worker-llm.ts:30-35`
- Model tiers: `openrouter.ts:28` duplicated in `settings.ts` FALLBACK
- **Severity**: LOW

#### L-4: Minor `any` Type Usage
- `decodo.ts:47,69-70` — `parseDecodoTranscript(content: any)`
- `vercel.ts:35-36,39-40` — `middleware(_req: any)`
- `ChatDock.tsx:100` — `zIndex: 'var(--z-dock)' as any`
- **Severity**: LOW

#### L-5: Root File Volume Violation
- 6+ markdown files in root (GEMINI.md mandates max 4)
- **Severity**: LOW

#### L-6: Duplicate Index on `chat_messages.user_id`
- `idx_chat_messages_user_id` may duplicate `idx_chat_msg_conv` coverage
- **Severity**: LOW — performance-neutral, storage-wasteful

---

## 5. HEXAGONAL LITE PATTERN — END-TO-END CYCLE AUDIT

### Architecture Intent (ADR 005)

```
Browser → Vercel Bouncer (auth + quota + HMAC) → Cloudflare Worker (LLM streaming) → S2S /persist → Supabase
```

### Port/Adapter Inventory

| Port Interface | Implementation | DI? | Clean? |
|---------------|---------------|-----|--------|
| `IReasoningEngine` | `ReasoningEngine` | ✅ Constructor DI | ✅ |
| `ILLMCascade` | `LLMCascade` | ✅ Constructor DI | ⚠️ Direct HTTP inside |
| `IPromptBuilder` | `PromptBuilder` | ✅ Constructor DI | ❌ Cross-package import |
| `IPersistenceRepository` | `UpstashCacheAdapter` | ✅ Constructor DI | ✅ |
| `ITranscriptProvider` | `TranscriptExtractor` | ❌ No DI | ❌ Port re-exports from adapter |
| *(missing)* `IHttpClient` | *(none)* | — | ❌ Not defined |
| *(missing)* `IValidationService` | `ValidationService` | ❌ Direct instantiation | ❌ No port |
| *(missing)* `IHmacSigner` | *(3 implementations)* | — | ❌ Duplicated |
| *(missing)* `IChatCascade` | *(inline in handler)* | — | ❌ No port |
| *(missing)* `IMetadataProvider` | `MetadataScraper` | ❌ Direct instantiation | ❌ No port |

### Dependency Flow Violations

```
CORRECT:   Port ← Adapter ← Infrastructure
VIOLATION: Port ← Adapter ← OTHER ADAPTER (ITranscriptProvider re-exports TranscriptResult)
VIOLATION: Worker → Web (PromptBuilder imports from web/lib/prompts)
VIOLATION: Worker → Web (KnowledgeGraphSynthesizer re-exports from web/lib/intelligence)
```

### Wiring Analysis (worker.ts)

The worker entry point (`worker.ts:198-215`) instantiates all services with `new` instead of receiving them via DI. This is the **composition root anti-pattern** — the Hono handler should receive configured services, not create them inline.

**Current**:
```typescript
const engine: IReasoningEngine = new ReasoningEngine(
  new PromptBuilder(),        // concrete
  new LLMCascade(apiKey),     // concrete
  new ValidationService(),    // concrete, no port
  cache                       // via port
);
```

**Correct**:
```typescript
// Composition root at module level, injected into handler
const engine = composeEngine(env);
app.post('/analyze-llm-stream', (c) => handleAnalysis(c, engine));
```

### Web-Side Hexagonal Compliance

| Layer | Compliant? | Issue |
|-------|-----------|-------|
| API routes (bouncer) | ⚠️ | Direct Supabase calls in route handlers |
| Services (traffic, billing, cache) | ⚠️ | traffic.ts mixes Supabase + Redis + Sentry |
| Stores (synthesis-nucleus) | ✅ | Clean Zustand store |
| Hooks (useSSEStream, etc.) | ✅ | Single responsibility |
| Adapters (synthesis-stream-adapter) | ⚠️ | Direct Zustand store access (not injected) |

### Ports/Adapters Completeness Score: **4/10**

The worker has 5 defined ports but only 2 are cleanly implemented. The web side has no formal port definitions at all — services are ad-hoc. The hexagonal lite pattern is **partially implemented** with significant gaps.

---

## 6. DB 10x OPTIMIZER — SCHEMA, QUERIES, INDEXES, RLS

### Table Inventory (6 Tables, 61 Columns)

| Table | Cols | PK | FKs | RLS | Indexes |
|-------|------|----|----|-----|---------|
| `users` | 12 | id (uuid) | auth.users (trigger) | ✅ | 1 (role) |
| `analyses` | 21 | id (uuid) | users(id) CASCADE | ✅ | 2 (cache_lookup, user_id) |
| `usage_logs` | 7 | id (uuid) | users(id) CASCADE | ✅ | 3 (user_id, metadata_gin, metadata_latency) |
| `stripe_events` | 7 | id (text) | users(id) SET NULL | ✅ | 1 (user_id) |
| `chat_conversations` | 7 | id (uuid) | auth.users CASCADE, analyses SET NULL | ✅ | 2 (user, analysis) |
| `chat_messages` | 7 | id (uuid) | chat_conversations CASCADE, auth.users CASCADE | ✅ | 2 (conv, user_id) |

### RLS Policy Coverage

| Table | SELECT | INSERT | UPDATE | DELETE | Gap |
|-------|--------|--------|--------|--------|-----|
| users | ✅ | ✅ | ✅ | ❌ | No DELETE (intentional — soft delete) |
| analyses | ✅ | ✅ | ✅ | ✅ | Complete |
| usage_logs | ✅ | ✅ | ❌ | ❌ | No UPDATE/DELETE (intentional — append-only) |
| stripe_events | ✅ | ❌ | ❌ | ❌ | **INSERT policy missing** |
| chat_conversations | ✅ | ✅ | ✅ | ✅ | Complete |
| chat_messages | ✅ | ✅ | ✅ | ✅ | Complete |

### Index Strategy Assessment

| Index | Type | Coverage | Assessment |
|-------|------|----------|------------|
| `idx_analyses_cache_lookup` | B-tree + INCLUDE | (user_id, video_id, created_at) INCLUDE (id, title) | ✅ Excellent — covering index for cache hits |
| `idx_analyses_user_id` | B-tree | (user_id) | ⚠️ Redundant — cache_lookup already covers |
| `idx_usage_logs_metadata_gin` | GIN | metadata JSONB | ✅ Good — full-text search |
| `idx_usage_logs_metadata_latency` | Expression | (metadata->>'latency_ms') | ✅ Good — targeted query |
| `idx_chat_conv_user` | B-tree | (user_id, last_message_at DESC) | ✅ Good — recent conversations |
| `idx_chat_messages_user_id` | B-tree | (user_id) | ⚠️ Potentially redundant with idx_chat_msg_conv |

### Performance Concerns

| Concern | Severity | Notes |
|---------|----------|-------|
| HNSW vector index not created | LOW | `search_analyses_semantic` RPC exists but may be slow without index |
| `analyses` table has redundant `idx_analyses_user_id` | LOW | cache_lookup index already covers user_id queries |
| No partial index for date-range queries | LOW | Could benefit from `WHERE created_at > now() - interval '30 days'` |

### Migration Quality Assessment

| Migration | LOC | Quality | Notes |
|-----------|-----|---------|-------|
| `20260514000000_baseline_core_tables` | 112 | ✅ | Idempotent, well-commented |
| `20260519220000_complete_stabilization` | 263 | ⚠️ | Large monolithic migration |
| `20260520_rls_lockdown_enforcement` | 138 | ✅ | Security-focused |
| `20260521210000_hardening_wave_4_fixes` | 141 | ⚠️ | Drops + recreates functions (fragile) |
| `20260604010000_rls_dedup_index_usage_check` | 74 | ✅ | Cleans up duplicate policies |

### DB 10x Optimizer Score: **7/10**

**Strengths**: Good index strategy, proper FK cascades, RLS on all tables, idempotent migrations.
**Weaknesses**: Missing INSERT policy on stripe_events, usage.ts anon key bug, no vector index, redundant indexes.

---

## 7. TECHNICAL DEBT INVENTORY

### Debt Classification

| ID | Category | Description | Effort | Impact | Priority |
|----|----------|-------------|--------|--------|----------|
| TD-1 | Security | usage.ts anon key (C-1) | 1h | CRITICAL | P0 |
| TD-2 | Security | /api/sentry-test unauthenticated (C-2) | 15m | CRITICAL | P0 |
| TD-3 | Security | Duplicate Stripe webhooks (C-3) | 4h | CRITICAL | P0 |
| TD-4 | Security | Test token bypass in middleware (C-4) | 1h | CRITICAL | P0 |
| TD-5 | Architecture | 6 missing hexagonal ports (H-2) | 8h | HIGH | P1 |
| TD-6 | Architecture | Cross-package coupling (H-3) | 4h | HIGH | P1 |
| TD-7 | Architecture | DashboardContainer god component (H-4) | 4h | HIGH | P1 |
| TD-8 | Code Quality | Duplicate UCIS prompts (H-5) | 2h | HIGH | P1 |
| TD-9 | Security | Missing rate limiting (H-6) | 4h | HIGH | P1 |
| TD-10 | Security | Error message leakage (H-7) | 3h | HIGH | P1 |
| TD-11 | Architecture | Version drift (H-1) | 1h | HIGH | P1 |
| TD-12 | Code Quality | Auth module over-engineering (M-2) | 2h | MEDIUM | P2 |
| TD-13 | Code Quality | Traffic service SoC (M-3) | 2h | MEDIUM | P2 |
| TD-14 | Security | S2S Zod validation (M-4) | 2h | MEDIUM | P2 |
| TD-15 | Security | PDF ownership check (M-5) | 1h | MEDIUM | P2 |
| TD-16 | Security | Security headers (M-6) | 2h | MEDIUM | P2 |
| TD-17 | Code Quality | Dead code cleanup (L-1, L-2) | 30m | LOW | P3 |
| TD-18 | Code Quality | Hardcoded value dedup (L-3) | 1h | LOW | P3 |
| TD-19 | Code Quality | Remaining `any` types (L-4) | 1h | LOW | P3 |
| TD-20 | Documentation | ROADMAP.md stale (2 weeks) | 2h | MEDIUM | P2 |
| TD-21 | Documentation | PRD partially stale | 2h | MEDIUM | P2 |
| TD-22 | Feature | Structured JSON Streaming not implemented | 16h | HIGH | P1 |

### Total Debt Estimate

| Priority | Items | Estimated Effort |
|----------|-------|-----------------|
| P0 (CRITICAL) | 4 | ~6h |
| P1 (HIGH) | 8 | ~43h |
| P2 (MEDIUM) | 7 | ~13h |
| P3 (LOW) | 3 | ~2.5h |
| **TOTAL** | **22** | **~64.5h** |

---

## 8. KEY DECISIONS & ADRs RECORDED

### Existing ADRs

| ADR | Title | Status | Implemented? |
|-----|-------|--------|-------------|
| ADR 001 | Pre-Query Cache Hit Circuit | ✅ Accepted | ✅ Yes |
| ADR 002 | Atomic Quota Enforcement | ✅ Accepted | ✅ Yes |
| ADR 003 | LLM Cascade (Nemotron → Laguna → Haiku) | ✅ Accepted | ✅ Yes |
| ADR 005 | Hybrid Edge Architecture | ✅ Accepted | ✅ Yes |

### New ADRs Identified (Recommended)

| Proposed ADR | Title | Rationale |
|-------------|-------|-----------|
| ADR 006 | Structured JSON Streaming | Replace regex parser with LLM-emitted JSON for deterministic dimension extraction |
| ADR 007 | Shared Domain Package | Extract cross-package types (prompts, intelligence) into `packages/shared` to break worker→web coupling |
| ADR 008 | Stripe Webhook Consolidation | Single webhook handler with event-type routing |
| ADR 009 | Hexagonal Port Completion | Define IHttpClient, IHmacSigner, IValidationService, IChatCascade, IMetadataProvider |
| ADR 010 | DB-Driven Model Configuration | Formalize PR #54's app_settings approach as the canonical model selection strategy |

### Key Inflection Points

1. **2026-06-04**: Worker decomposed into hexagonal ports + DI (PR #37) — but web side not aligned
2. **2026-06-04**: Chat routed via edge worker (PR #39) — unified LLM traffic on worker
3. **2026-06-05**: Cache-hit hollow state fixed (PR #49) — dimension parser shield added
4. **2026-06-05**: pnpm pinned to 11.5.1 via Corepack (PR #50) — toolchain unified
5. **2026-06-05**: DB-backed model cascade proposed (PR #54) — pending review

---

## 9. SECURITY POSTURE SUMMARY

| Vector | Status | Rating |
|--------|--------|--------|
| **Authentication** | Supabase OAuth + middleware gate | ✅ GOOD |
| **Authorization (tenant isolation)** | RLS + user_id checks | ⚠️ GOOD with gaps (PDF, some routes) |
| **Input validation** | Zod on most POST routes | ⚠️ GOOD (S2S routes use manual checks) |
| **HMAC/signature verification** | Stream tokens + content signatures | ✅ GOOD |
| **Rate limiting** | Redis sliding window on core routes | ⚠️ PARTIAL (7+ routes unprotected) |
| **Error handling** | Mixed — some routes leak raw errors | ⚠️ NEEDS WORK |
| **Secret management** | Env vars + GitHub Secrets | ✅ GOOD |
| **CORS/security headers** | Minimal | ⚠️ NEEDS WORK |
| **SSRF protection** | Hostname + protocol validation | ✅ GOOD |
| **Test bypass** | `test-token-` in non-prod | ❌ REMOVE |

---

## 10. RECOMMENDATIONS — PRIORITIZED ACTION PLAN

### Immediate (Before MVP 2.0 Launch — 2026-06-07)

1. **Fix C-1**: Change `usage.ts` to use `getSupabaseServiceClient()` — restores observability
2. **Fix C-2**: Remove or admin-gate `/api/sentry-test` — eliminates anonymous error trigger
3. **Fix C-4**: Remove `test-token-` / `user-` bypass from middleware — secures preview environments
4. **Merge PR #53** first (low-risk hardening), then rebase PR #54

### Short-Term (Week 1 Post-Launch)

5. **Fix C-3**: Consolidate Stripe webhook handlers into single endpoint
6. **Fix H-7**: Replace raw error messages with generic user-safe responses
7. **Fix H-6**: Add `guardTraffic()` to all unprotected endpoints
8. **Fix H-1**: Run housekeeping cycle — align versions, update AGENTS.md + GEMINI.md

### Medium-Term (Sprint 2-3)

9. **ADR 006**: Implement structured JSON streaming (replace regex parser)
10. **ADR 007**: Create `packages/shared` for cross-package types
11. **ADR 009**: Complete hexagonal port definitions
12. **Fix H-4**: Decompose DashboardContainer into hooks + config
13. **Fix H-5**: Merge UCIS v5.0 + v5.1 into single parameterized prompt

### Long-Term (MVP 2.5+)

14. Clean up all LOW-priority debt
15. Update ROADMAP.md and PRD.md to reflect current state
16. Implement vector HNSW index for semantic search performance

---

## APPENDIX A: COVERAGE MATRIX

| Area | Files Audited | Coverage |
|------|--------------|----------|
| web/app/api (all routes) | 23/23 | 100% |
| web/lib (all modules) | 55/55 | 100% |
| web/components | 27/27 | 100% |
| web/hooks | 6/6 | 100% |
| worker/src (all modules) | 18/18 | 100% |
| supabase/migrations | 18/18 | 100% |
| Open PRs | 2/2 | 100% |
| Roadmap documents | 3/3 | 100% |
| Git history | 30 commits | 100% |

## APPENDIX B: UNTRACKED FILES REQUIRING ATTENTION

| File | Origin | Action |
|------|--------|--------|
| `.blackboxcli/` | BlackBox agent | Delete or .gitignore |
| `BLACKBOX.md` | BlackBox agent | Delete |
| `CHAT_AUTH_GUARD_COMPLETE.md` | Agent artifact | Move to docs/ or delete |
| `SETUP_REQUIRED.md` | Agent artifact | Move to docs/ or delete |
| `STATS_HARDENING_COMPLETE.md` | Agent artifact | Move to docs/ or delete |
| `TASKS_COMPLETED_SUMMARY.md` | Agent artifact | Move to docs/ or delete |
| `TODO.md` | Agent artifact | Move to docs/ or delete |
| `install_bbt.sh` | BlackBox agent | Delete |
| `web/lib/services/settings.ts` | PR #54 work | Commit or stash |

---

**Report Generated**: 2026-06-06 14:00 UTC
**Next Review**: Post-MVP 2.0 launch (2026-06-08)
**Auditor**: Kilo Code — Codebase Investigator + DB 10x Optimizer
